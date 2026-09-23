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
  _write(chunk: any, encoding: any, callback: (error?: Error | null) => void) {
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
  write(data: any) {
    this.push(Buffer.from(data));
  }
  sendKey({ name }: { name: string }) {
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
  sendChar({ char }: { char: string }) {
    this.write(char);
  }
  sendStr({ str }: { str: string }) {
    this.write(str);
  }
}

const waitForFrameToContain = async ({
  mockStdout,
  substring,
  timeout = 3000,
}: {
  mockStdout: MockWritable;
  substring: string;
  timeout?: number;
}) => {
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

  const setupDashboardTest = async ({
    initialProviders,
    defaultProvider,
  }: {
    initialProviders?: any[];
    defaultProvider?: string;
  } = {}) => {
    if (initialProviders) {
      mockStore.providers = initialProviders;
    }
    if (defaultProvider !== undefined) {
      mockStore.defaultProvider = defaultProvider;
    }

    const renderResult = render(<AuthDashboard />, {
      stdout: mockStdout as any,
      stdin: mockStdin as any,
      debug: true,
    });

    await waitForFrameToContain({ mockStdout, substring: 'OpenAI' });
    await sleep(50);

    return renderResult;
  };

  const sendInputs = async (inputs: (string | { key: string })[]) => {
    for (const inp of inputs) {
      if (typeof inp === 'string') {
        mockStdin.sendChar({ char: inp });
      } else {
        mockStdin.sendKey({ name: inp.key });
      }
      await sleep(50);
    }
  };

  const cleanupTest = async (unmount: () => void) => {
    unmount();
    await sleep(50);
  };

  const enterAddWizard = async () => {
    await sendInputs(['a']);
    await waitForFrameToContain({ mockStdout, substring: 'Step 1/4 — Provider:' });
    await sleep(50);
  };

  const enterEditWizard = async () => {
    await sendInputs(['e']);
    await waitForFrameToContain({ mockStdout, substring: 'Edit AI Provider: OpenAI' });
    await sleep(50);
  };

  const enterRemoveWizard = async () => {
    await sendInputs(['r']);
    await waitForFrameToContain({ mockStdout, substring: 'Are you sure you want to remove "OpenAI"' });
    await sleep(50);
  };

  it('renders configured and unconfigured providers list correctly', async () => {
    const { unmount } = await setupDashboardTest({
      initialProviders: [{ name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 }],
      defaultProvider: 'openai',
    });

    const output = mockStdout.frames.join('\n');
    expect(output).toContain('AI Provider Manager');
    expect(output).toContain('OpenAI');
    expect(output).toContain('gpt-4o');
    expect(output).toContain('✔ Default');
    expect(output).toContain('✖ Not configured');

    await cleanupTest(unmount);
  });

  it('navigates list with arrow keys and exits on Q', async () => {
    const { unmount } = await setupDashboardTest();

    await sendInputs([{ key: 'down' }, { key: 'down' }, { key: 'up' }, 'q']);
    expect(exitSpy).toHaveBeenCalledWith(0);

    await cleanupTest(unmount);
  });

  it('performs Add Provider Wizard flow successfully', async () => {
    const { unmount } = await setupDashboardTest();

    await enterAddWizard();

    await sendInputs([{ key: 'return' }, { key: 'return' }, 'secret-api-key', { key: 'return' }, { key: 'return' }]);
    await waitForFrameToContain({ mockStdout, substring: 'Successfully added AI provider "OpenAI"' });

    expect(mockStore.providers).toHaveLength(1);
    expect(mockStore.providers[0].name).toBe('openai');
    expect(mockStore.providers[0].model).toBe('gpt-4o');
    expect(mockStore.providers[0].password).toBe('secret-api-key');

    await cleanupTest(unmount);
  });

  it('performs Edit Provider Wizard flow successfully', async () => {
    const { unmount } = await setupDashboardTest({
      initialProviders: [
        { name: 'openai', model: 'gpt-4o', password: 'old-key', temperature: 0.7 },
        { name: 'ollama', model: 'llama3.1', password: 'ollama-key', temperature: 0.7 },
      ],
    });

    await enterEditWizard();

    await sendInputs([{ key: 'backspace' }, '-turbo', { key: 'return' }, 'new-key', { key: 'return' }, { key: 'return' }]);
    await waitForFrameToContain({ mockStdout, substring: 'Successfully updated AI provider "OpenAI"' });

    expect(mockStore.providers[0].model).toBe('gpt-4-turbo');
    expect(mockStore.providers[0].password).toBe('new-key');

    await cleanupTest(unmount);
  });

  it('manages default provider status (setting default and auto-fallback on removal)', async () => {
    const { unmount } = await setupDashboardTest({
      initialProviders: [
        { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
        { name: 'ollama', model: 'llama3.1', password: 'key', temperature: 0.7 },
      ],
      defaultProvider: 'openai',
    });

    // 1. Manually set Ollama as default
    await sendInputs([{ key: 'down' }, 'd']);
    await waitForFrameToContain({ mockStdout, substring: 'Successfully set default AI provider to "Ollama"' });
    expect(mockStore.defaultProvider).toBe('ollama');

    // 2. Set default back to OpenAI
    await sendInputs([{ key: 'up' }, 'd']);
    await waitForFrameToContain({ mockStdout, substring: 'Successfully set default AI provider to "OpenAI"' });
    expect(mockStore.defaultProvider).toBe('openai');

    // 3. Remove default provider (OpenAI) and check if Ollama becomes the default automatically
    await enterRemoveWizard();
    await sendInputs(['y']);
    await waitForFrameToContain({ mockStdout, substring: 'Successfully removed AI provider "OpenAI"' });
    expect(mockStore.defaultProvider).toBe('ollama');

    await cleanupTest(unmount);
  });

  it('removes a provider', async () => {
    const { unmount } = await setupDashboardTest({
      initialProviders: [
        { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
      ],
    });

    await enterRemoveWizard();

    await sendInputs(['y']);
    await waitForFrameToContain({ mockStdout, substring: 'Successfully removed AI provider "OpenAI"' });

    expect(mockStore.providers).toHaveLength(0);

    await cleanupTest(unmount);
  });

  it('validates provider name and temperature inputs in Add Wizard', async () => {
    const { unmount } = await setupDashboardTest();

    // 1. Test invalid provider name
    await enterAddWizard();
    await sendInputs([
      { key: 'backspace' },
      { key: 'backspace' },
      { key: 'backspace' },
      { key: 'backspace' },
      { key: 'backspace' },
      { key: 'backspace' },
      'invalidprov',
      { key: 'return' }
    ]);
    await waitForFrameToContain({ mockStdout, substring: 'Unsupported provider "invalidprov".' });
    
    // Exit wizard to reset state
    await sendInputs([{ key: 'escape' }]);
    
    // 2. Test invalid temperature
    await enterAddWizard();
    await sendInputs([
      { key: 'return' },
      { key: 'return' },
      'secret-key',
      { key: 'return' },
      { key: 'backspace' },
      { key: 'backspace' },
      { key: 'backspace' },
      '0.7abc',
      { key: 'return' }
    ]);
    await waitForFrameToContain({ mockStdout, substring: 'Temperature must be a valid number.' });

    await cleanupTest(unmount);
  });

  it('rejects adding an already configured provider', async () => {
    const { unmount } = await setupDashboardTest({
      initialProviders: [
        { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
      ],
    });

    await enterAddWizard();

    await sendInputs([{ key: 'return' }, { key: 'return' }, { key: 'return' }, { key: 'return' }]);
    await waitForFrameToContain({ mockStdout, substring: 'Provider "openai" is already configured. Use edit (E) instead.' });

    await cleanupTest(unmount);
  });

  it('rejects invalid temperature in Edit Wizard', async () => {
    const { unmount } = await setupDashboardTest({
      initialProviders: [
        { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
      ],
    });

    await enterEditWizard();

    await sendInputs([
      { key: 'return' },
      { key: 'return' },
      { key: 'backspace' },
      { key: 'backspace' },
      { key: 'backspace' },
      'invalidtemp',
      { key: 'return' }
    ]);
    await waitForFrameToContain({ mockStdout, substring: 'Temperature must be a valid number.' });

    await cleanupTest(unmount);
  });

  it('rejects edit, default, and remove operations on unconfigured providers', async () => {
    const { unmount } = await setupDashboardTest();

    // 1. Reject edit
    await sendInputs([{ key: 'down' }, 'e']);
    await waitForFrameToContain({ mockStdout, substring: 'Provider "Ollama" is not configured. Press \'A\' to add.' });

    // 2. Reject default
    await sendInputs(['d']);
    await waitForFrameToContain({ mockStdout, substring: 'Cannot set unconfigured provider "Ollama" as default.' });

    // 3. Reject remove
    await sendInputs(['r']);
    await waitForFrameToContain({ mockStdout, substring: 'Provider "Ollama" is not configured.' });

    await cleanupTest(unmount);
  });

  it('cancels and navigates inside Add Wizard', async () => {
    const { unmount } = await setupDashboardTest();

    // 1. Test navigation
    await enterAddWizard();
    await sendInputs([{ key: 'down' }, { key: 'down' }, { key: 'up' }]);

    // 2. Test cancel on Escape
    await sendInputs([{ key: 'escape' }]);
    const lastRendered = [...mockStdout.frames].reverse().find((f) => f.includes('AI Provider Manager'));
    expect(lastRendered).toBeDefined();
    expect(lastRendered).not.toContain('Step 1/4');

    await cleanupTest(unmount);
  });

  it('cancels and navigates inside Edit Wizard', async () => {
    const { unmount } = await setupDashboardTest({
      initialProviders: [
        { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
      ],
    });

    // 1. Test navigation
    await enterEditWizard();
    await sendInputs([{ key: 'down' }, { key: 'down' }, { key: 'up' }]);

    // 2. Test cancel on Escape
    await sendInputs([{ key: 'escape' }]);
    const lastRendered = [...mockStdout.frames].reverse().find((f) => f.includes('AI Provider Manager'));
    expect(lastRendered).toBeDefined();
    expect(lastRendered).not.toContain('Edit AI Provider: OpenAI');

    await cleanupTest(unmount);
  });

  it('cancels removal of a provider on N or Escape', async () => {
    const { unmount } = await setupDashboardTest({
      initialProviders: [
        { name: 'openai', model: 'gpt-4o', password: 'key', temperature: 0.7 },
      ],
    });

    await enterRemoveWizard();

    await sendInputs(['n', 'r', { key: 'escape' }]);
    await waitForFrameToContain({ mockStdout, substring: 'AI Provider Manager' });

    await cleanupTest(unmount);
  });
});
