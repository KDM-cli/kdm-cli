import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink';
import { Writable, Readable } from 'node:stream';
import { Console } from 'node:console';
import { AuthDashboard } from '../ui/AuthDashboard';

if (!console.Console) {
  console.Console = Console;
}

const { mockStore } = vi.hoisted(() => ({
  mockStore: { providers: [] as any[], defaultProvider: undefined as string | undefined },
}));

vi.mock('../config/store', () => ({
  getAIConfig: vi.fn(() => mockStore),
  setAIConfig: vi.fn((config) => {
    mockStore.providers = config.providers;
    mockStore.defaultProvider = config.defaultProvider;
  }),
}));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class MockWritable extends Writable {
  frames: string[] = [];
  isTTY = true;
  columns = 80;
  rows = 24;
  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void) {
    this.frames.push(chunk.toString());
    callback();
  }
}

class MockStdin extends Readable {
  _read() {}
  isTTY = true;
  setRawMode = vi.fn();
  setEncoding = vi.fn();
  ref = vi.fn();
  unref = vi.fn();
  write(data: string) {
    this.push(Buffer.from(data));
  }
  sendKey(name: string) {
    const sequences: Record<string, string> = {
      up: '\u001b[A',
      down: '\u001b[B',
      return: '\r',
      enter: '\r',
      escape: '\u001b',
      backspace: '\u007f',
    };
    const seq = sequences[name];
    if (seq) {
      this.write(seq);
    }
  }
  sendChar(char: string) {
    this.write(char);
  }
  sendStr(str: string) {
    this.write(str);
  }
}

const waitForFrameToContain = async (mockStdout: MockWritable, substring: string, timeout = 3000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const output = mockStdout.frames.join('\n');
    if (output.includes(substring)) {
      return;
    }
    await sleep(20);
  }
  throw new Error(`Timed out waiting for "${substring}" to appear in stdout. Output was:\n${mockStdout.frames.join('\n')}`);
};

describe('AuthDashboard', () => {
  let mockStdout: MockWritable;
  let mockStdin: MockStdin;
  let exitSpy: any;

  beforeEach(() => {
    mockStdout = new MockWritable();
    mockStdin = new MockStdin();
    mockStore.providers = [];
    mockStore.defaultProvider = undefined;
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('renders configured and unconfigured providers list correctly', async () => {
    mockStore.providers = [
      { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
    ];
    mockStore.defaultProvider = 'openai';

    const { unmount } = render(<AuthDashboard />, {
      stdout: mockStdout as any,
      stdin: mockStdin as any,
    });

    await waitForFrameToContain(mockStdout, 'OpenAI');
    const output = mockStdout.frames.join('\n');
    expect(output).toContain('AI Provider Manager');
    expect(output).toContain('OpenAI');
    expect(output).toContain('gpt-4o');
    expect(output).toContain('✔ Default');
    expect(output).toContain('✖ Not configured');

    unmount();
    await sleep(50);
  });

  it('navigates list with arrow keys and exits on Q', async () => {
    const { unmount } = render(<AuthDashboard />, {
      stdout: mockStdout as any,
      stdin: mockStdin as any,
    });

    await waitForFrameToContain(mockStdout, 'OpenAI');

    // Arrow down
    mockStdin.sendKey('down');
    await sleep(50);
    // Arrow down again
    mockStdin.sendKey('down');
    await sleep(50);
    // Arrow up
    mockStdin.sendKey('up');
    await sleep(50);

    // Press Q
    mockStdin.sendChar('q');
    await sleep(50);
    expect(exitSpy).toHaveBeenCalledWith(0);

    unmount();
    await sleep(50);
  });

  it('performs Add Provider Wizard flow successfully', async () => {
    const { unmount } = render(<AuthDashboard />, {
      stdout: mockStdout as any,
      stdin: mockStdin as any,
    });

    await waitForFrameToContain(mockStdout, 'OpenAI');

    // Press A to open Add wizard
    mockStdin.sendChar('a');
    await waitForFrameToContain(mockStdout, 'Step 1/4 — Provider:');
    await sleep(50);

    // Step 1: Provider name (defaults to openai) -> Enter
    mockStdin.sendKey('return');
    await sleep(50);

    // Step 2: Model (defaults to gpt-4o) -> Enter
    mockStdin.sendKey('return');
    await sleep(50);

    // Step 3: API Key (secret key)
    mockStdin.sendStr('secret-api-key');
    await sleep(50);
    mockStdin.sendKey('return');
    await sleep(50);

    // Step 4: Temp (0.7) -> Enter to submit
    mockStdin.sendKey('return');
    await waitForFrameToContain(mockStdout, 'Successfully added AI provider "OpenAI"');

    expect(mockStore.providers).toHaveLength(1);
    expect(mockStore.providers[0].name).toBe('openai');
    expect(mockStore.providers[0].model).toBe('gpt-4o');
    expect(mockStore.providers[0].password).toBe('secret-api-key');

    unmount();
    await sleep(50);
  });

  it('performs Edit Provider Wizard flow successfully', async () => {
    mockStore.providers = [
      { name: 'openai', model: 'gpt-4o', password: 'old-key', temperature: 0.7 },
    ];

    const { unmount } = render(<AuthDashboard />, {
      stdout: mockStdout as any,
      stdin: mockStdin as any,
    });

    await waitForFrameToContain(mockStdout, 'OpenAI');

    // Press E to open Edit wizard
    mockStdin.sendChar('e');
    await waitForFrameToContain(mockStdout, 'Edit AI Provider: OpenAI');
    await sleep(50);

    // Step 1: Model (delete 2 chars, add '-turbo')
    mockStdin.sendKey('backspace');
    await sleep(20);
    mockStdin.sendKey('backspace');
    await sleep(20);
    mockStdin.sendStr('-turbo');
    await sleep(50);
    mockStdin.sendKey('return');
    await sleep(50);

    // Step 2: API Key (add 'new-key')
    mockStdin.sendStr('new-key');
    await sleep(50);
    mockStdin.sendKey('return');
    await sleep(50);

    // Step 3: Temp -> Enter to submit
    mockStdin.sendKey('return');
    await waitForFrameToContain(mockStdout, 'Successfully updated AI provider "OpenAI"');

    expect(mockStore.providers[0].model).toBe('gpt--turbo');
    expect(mockStore.providers[0].password).toBe('new-key');

    unmount();
    await sleep(50);
  });

  it('sets a provider as default', async () => {
    mockStore.providers = [
      { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
      { name: 'ollama', model: 'llama3.1', password: 'key', temperature: 0.7 },
    ];
    mockStore.defaultProvider = 'openai';

    const { unmount } = render(<AuthDashboard />, {
      stdout: mockStdout as any,
      stdin: mockStdin as any,
    });

    await waitForFrameToContain(mockStdout, 'Ollama');

    // Press arrow down to select Ollama (which is at index 1)
    mockStdin.sendKey('down');
    await sleep(50);

    // Press D to set default
    mockStdin.sendChar('d');
    await waitForFrameToContain(mockStdout, 'Successfully set default AI provider to "Ollama"');

    expect(mockStore.defaultProvider).toBe('ollama');

    unmount();
    await sleep(50);
  });

  it('removes a provider', async () => {
    mockStore.providers = [
      { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
    ];

    const { unmount } = render(<AuthDashboard />, {
      stdout: mockStdout as any,
      stdin: mockStdin as any,
    });

    await waitForFrameToContain(mockStdout, 'OpenAI');

    // Press R to delete
    mockStdin.sendChar('r');
    await waitForFrameToContain(mockStdout, 'Are you sure you want to remove "OpenAI"');
    await sleep(50);

    // Press Y to confirm
    mockStdin.sendChar('y');
    await waitForFrameToContain(mockStdout, 'Successfully removed AI provider "OpenAI"');

    expect(mockStore.providers).toHaveLength(0);

    unmount();
    await sleep(50);
  });
});
