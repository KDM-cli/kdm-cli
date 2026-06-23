import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink';
import { Writable, Readable } from 'node:stream';
import { Console } from 'node:console';
import { AuthDashboard } from '../ui/AuthDashboard';

if (!(console as any).Console) {
  (console as any).Console = Console;
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

  const setupDashboardTest = async (initialProviders?: any[], defaultProvider?: string) => {
    if (initialProviders) {
      mockStore.providers = initialProviders;
    }
    if (defaultProvider !== undefined) {
      mockStore.defaultProvider = defaultProvider;
    }

    const renderResult = render(<AuthDashboard />, {
      stdout: mockStdout as any,
      stdin: mockStdin as any,
      interactive: true,
    });

    await waitForFrameToContain(mockStdout, 'OpenAI');
    await sleep(50);

    return renderResult;
  };

  it('renders configured and unconfigured providers list correctly', async () => {
    const { unmount } = await setupDashboardTest(
      [{ name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 }],
      'openai'
    );

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
    const { unmount } = await setupDashboardTest();

    mockStdin.sendKey('down');
    await sleep(50);
    mockStdin.sendKey('down');
    await sleep(50);
    mockStdin.sendKey('up');
    await sleep(50);

    mockStdin.sendChar('q');
    await sleep(50);
    expect(exitSpy).toHaveBeenCalledWith(0);

    unmount();
    await sleep(50);
  });

  it('performs Add Provider Wizard flow successfully', async () => {
    const { unmount } = await setupDashboardTest();

    mockStdin.sendChar('a');
    await waitForFrameToContain(mockStdout, 'Step 1/4 — Provider:');
    await sleep(50);

    mockStdin.sendKey('return');
    await sleep(50);

    mockStdin.sendKey('return');
    await sleep(50);

    mockStdin.sendStr('secret-api-key');
    await sleep(50);
    mockStdin.sendKey('return');
    await sleep(50);

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
    const { unmount } = await setupDashboardTest([
      { name: 'openai', model: 'gpt-4o', password: 'old-key', temperature: 0.7 },
      { name: 'ollama', model: 'llama3.1', password: 'ollama-key', temperature: 0.7 },
    ]);

    mockStdin.sendChar('e');
    await waitForFrameToContain(mockStdout, 'Edit AI Provider: OpenAI');
    await sleep(50);

    mockStdin.sendKey('backspace');
    await sleep(20);
    mockStdin.sendStr('-turbo');
    await sleep(50);
    mockStdin.sendKey('return');
    await sleep(50);

    mockStdin.sendStr('new-key');
    await sleep(50);
    mockStdin.sendKey('return');
    await sleep(50);

    mockStdin.sendKey('return');
    await waitForFrameToContain(mockStdout, 'Successfully updated AI provider "OpenAI"');

    expect(mockStore.providers[0].model).toBe('gpt-4-turbo');
    expect(mockStore.providers[0].password).toBe('new-key');

    unmount();
    await sleep(50);
  });

  it('sets a provider as default', async () => {
    const { unmount } = await setupDashboardTest(
      [
        { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
        { name: 'ollama', model: 'llama3.1', password: 'key', temperature: 0.7 },
      ],
      'openai'
    );

    mockStdin.sendKey('down');
    await sleep(50);

    mockStdin.sendChar('d');
    await waitForFrameToContain(mockStdout, 'Successfully set default AI provider to "Ollama"');

    expect(mockStore.defaultProvider).toBe('ollama');

    unmount();
    await sleep(50);
  });

  it('removes a provider', async () => {
    const { unmount } = await setupDashboardTest([
      { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
    ]);

    mockStdin.sendChar('r');
    await waitForFrameToContain(mockStdout, 'Are you sure you want to remove "OpenAI"');
    await sleep(50);

    mockStdin.sendChar('y');
    await waitForFrameToContain(mockStdout, 'Successfully removed AI provider "OpenAI"');

    expect(mockStore.providers).toHaveLength(0);

    unmount();
    await sleep(50);
  });

  it('rejects invalid temperature in Add Wizard', async () => {
    const { unmount } = await setupDashboardTest();

    mockStdin.sendChar('a');
    await waitForFrameToContain(mockStdout, 'Step 1/4 — Provider:');
    await sleep(50);

    mockStdin.sendKey('return');
    await sleep(50);

    mockStdin.sendKey('return');
    await sleep(50);

    mockStdin.sendStr('secret-key');
    await sleep(50);
    mockStdin.sendKey('return');
    await sleep(50);

    mockStdin.sendKey('backspace');
    await sleep(20);
    mockStdin.sendKey('backspace');
    await sleep(20);
    mockStdin.sendKey('backspace');
    await sleep(20);
    mockStdin.sendStr('0.7abc');
    await sleep(50);
    mockStdin.sendKey('return');
    await waitForFrameToContain(mockStdout, 'Temperature must be a valid number.');

    unmount();
    await sleep(50);
  });

  it('rejects invalid provider name in Add Wizard', async () => {
    const { unmount } = await setupDashboardTest();

    mockStdin.sendChar('a');
    await waitForFrameToContain(mockStdout, 'Step 1/4 — Provider:');
    await sleep(50);

    for (let i = 0; i < 6; i++) {
      mockStdin.sendKey('backspace');
      await sleep(20);
    }
    mockStdin.sendStr('invalidprov');
    await sleep(50);
    mockStdin.sendKey('return');
    await waitForFrameToContain(mockStdout, 'Unsupported provider "invalidprov".');

    unmount();
    await sleep(50);
  });

  it('rejects adding an already configured provider', async () => {
    const { unmount } = await setupDashboardTest([
      { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
    ]);

    mockStdin.sendChar('a');
    await waitForFrameToContain(mockStdout, 'Step 1/4 — Provider:');
    await sleep(50);

    mockStdin.sendKey('return');
    await sleep(50);
    mockStdin.sendKey('return');
    await sleep(50);
    mockStdin.sendKey('return');
    await sleep(50);
    mockStdin.sendKey('return');
    await waitForFrameToContain(mockStdout, 'Provider "openai" is already configured. Use edit (E) instead.');

    unmount();
    await sleep(50);
  });

  it('rejects invalid temperature in Edit Wizard', async () => {
    const { unmount } = await setupDashboardTest([
      { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
    ]);

    mockStdin.sendChar('e');
    await waitForFrameToContain(mockStdout, 'Edit AI Provider: OpenAI');
    await sleep(50);

    mockStdin.sendKey('return');
    await sleep(50);
    mockStdin.sendKey('return');
    await sleep(50);

    mockStdin.sendKey('backspace');
    await sleep(20);
    mockStdin.sendKey('backspace');
    await sleep(20);
    mockStdin.sendKey('backspace');
    await sleep(20);
    mockStdin.sendStr('invalidtemp');
    await sleep(50);
    mockStdin.sendKey('return');
    await waitForFrameToContain(mockStdout, 'Temperature must be a valid number.');

    unmount();
    await sleep(50);
  });

  it('rejects editing an unconfigured provider', async () => {
    const { unmount } = await setupDashboardTest();

    mockStdin.sendKey('down');
    await sleep(50);

    mockStdin.sendChar('e');
    await waitForFrameToContain(mockStdout, 'Provider "Ollama" is not configured. Press \'A\' to add.');

    unmount();
    await sleep(50);
  });

  it('rejects setting an unconfigured provider as default', async () => {
    const { unmount } = await setupDashboardTest();

    mockStdin.sendKey('down');
    await sleep(50);

    mockStdin.sendChar('d');
    await waitForFrameToContain(mockStdout, 'Cannot set unconfigured provider "Ollama" as default.');

    unmount();
    await sleep(50);
  });

  it('rejects removing an unconfigured provider', async () => {
    const { unmount } = await setupDashboardTest();

    mockStdin.sendKey('down');
    await sleep(50);

    mockStdin.sendChar('r');
    await waitForFrameToContain(mockStdout, 'Provider "Ollama" is not configured.');

    unmount();
    await sleep(50);
  });

  it('cancels Add Wizard on Escape', async () => {
    const { unmount } = await setupDashboardTest();

    mockStdin.sendChar('a');
    await waitForFrameToContain(mockStdout, 'Step 1/4 — Provider:');
    await sleep(50);

    mockStdin.sendKey('escape');
    await sleep(50);

    const lastRendered = [...mockStdout.frames].reverse().find((f) => f.includes('AI Provider Manager'));
    expect(lastRendered).toBeDefined();
    expect(lastRendered).not.toContain('Step 1/4');

    unmount();
    await sleep(50);
  });

  it('navigates fields inside Add Wizard with up/down arrows', async () => {
    const { unmount } = await setupDashboardTest();

    mockStdin.sendChar('a');
    await waitForFrameToContain(mockStdout, 'Step 1/4 — Provider:');
    await sleep(50);

    mockStdin.sendKey('down');
    await sleep(50);
    mockStdin.sendKey('down');
    await sleep(50);
    mockStdin.sendKey('up');
    await sleep(50);

    unmount();
    await sleep(50);
  });

  it('cancels Edit Wizard on Escape', async () => {
    const { unmount } = await setupDashboardTest([
      { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
    ]);

    mockStdin.sendChar('e');
    await waitForFrameToContain(mockStdout, 'Edit AI Provider: OpenAI');
    await sleep(50);

    mockStdin.sendKey('escape');
    await sleep(50);

    const lastRendered = [...mockStdout.frames].reverse().find((f) => f.includes('AI Provider Manager'));
    expect(lastRendered).toBeDefined();
    expect(lastRendered).not.toContain('Edit AI Provider: OpenAI');

    unmount();
    await sleep(50);
  });

  it('navigates fields inside Edit Wizard with up/down arrows', async () => {
    const { unmount } = await setupDashboardTest([
      { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
    ]);

    mockStdin.sendChar('e');
    await waitForFrameToContain(mockStdout, 'Edit AI Provider: OpenAI');
    await sleep(50);

    mockStdin.sendKey('down');
    await sleep(50);
    mockStdin.sendKey('down');
    await sleep(50);
    mockStdin.sendKey('up');
    await sleep(50);

    unmount();
    await sleep(50);
  });

  it('selects the next available provider as default when the default provider is removed', async () => {
    const { unmount } = await setupDashboardTest(
      [
        { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
        { name: 'ollama', model: 'llama3.1', password: 'key', temperature: 0.7 },
      ],
      'openai'
    );

    mockStdin.sendChar('r');
    await waitForFrameToContain(mockStdout, 'Are you sure you want to remove "OpenAI"');
    await sleep(50);

    mockStdin.sendChar('y');
    await waitForFrameToContain(mockStdout, 'Successfully removed AI provider "OpenAI"');

    expect(mockStore.defaultProvider).toBe('ollama');

    unmount();
    await sleep(50);
  });

  it('cancels removal of a provider on N or Escape', async () => {
    const { unmount } = await setupDashboardTest([
      { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
    ]);

    mockStdin.sendChar('r');
    await waitForFrameToContain(mockStdout, 'Are you sure you want to remove "OpenAI"');
    await sleep(50);

    mockStdin.sendChar('n');
    await waitForFrameToContain(mockStdout, 'AI Provider Manager');
    await sleep(50);

    mockStdin.sendChar('r');
    await waitForFrameToContain(mockStdout, 'Are you sure you want to remove "OpenAI"');
    await sleep(50);

    mockStdin.sendKey('escape');
    await waitForFrameToContain(mockStdout, 'AI Provider Manager');

    unmount();
    await sleep(50);
  });
});
