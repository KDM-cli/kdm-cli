import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink';
import { Writable, Readable } from 'node:stream';
import { Console } from 'node:console';
import { CacheDashboard } from '../ui/CacheDashboard';
import * as cacheModule from '../cache';

if (!(console as any).Console) {
  (console as any).Console = Console;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class MockStdout extends Writable {
  frames: string[] = [];
  isTTY = true;
  columns = 120;
  rows = 40;
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
  sendKey(name: string) {
    const sequences: Record<string, string> = {
      escape: '\u001b',
    };
    const seq = sequences[name];
    if (seq) {
      this.write(seq);
    }
  }
  sendChar(char: string) {
    this.write(char);
  }
}

const waitForFrame = async (mockStdout: MockStdout, substring: string, timeout = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const output = mockStdout.frames.join('\n');
    if (output.includes(substring)) {
      return;
    }
    await sleep(20);
  }
  throw new Error(`Timed out waiting for "${substring}" in stdout frames.`);
};

describe('CacheDashboard', () => {
  let mockStdout: MockStdout;
  let mockStdin: MockStdin;

  beforeEach(() => {
    mockStdout = new MockStdout();
    mockStdin = new MockStdin();
    vi.spyOn(cacheModule, 'createCacheProvider').mockReturnValue({
      init: vi.fn(async () => {}),
      store: vi.fn(async () => {}),
      load: vi.fn(async () => 'cached analysis details'),
      remove: vi.fn(async () => {}),
      purge: vi.fn(async () => {}),
      list: vi.fn(async () => [
        {
          key: 'pod-default-crashloop',
          createdAt: new Date().toISOString(),
          sizeBytes: 1024,
        },
      ]),
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: 'renders [Esc/Q] Back in embedded mode',
      navigationProp: 'onBack' as const,
      expectedText: ['[Esc/Q]', 'Back'],
      unexpectedText: 'Quit',
    },
    {
      name: 'renders Q Quit in standalone mode',
      navigationProp: 'onExit' as const,
      expectedText: ['Q', 'Quit'],
    },
  ])('$name and invokes its navigation callback', async ({ navigationProp, expectedText, unexpectedText }) => {
    const onNavigate = vi.fn();
    const dashboardProps = navigationProp === 'onBack'
      ? { onBack: onNavigate }
      : { onExit: onNavigate };
    const { unmount } = render(
      <CacheDashboard {...dashboardProps} />,
      { stdout: mockStdout as any, stdin: mockStdin as any, debug: true }
    );

    await waitForFrame(mockStdout, 'Cache Browser');
    const output = mockStdout.frames.join('\n');
    expectedText.forEach((text) => expect(output).toContain(text));
    if (unexpectedText) expect(output).not.toContain(unexpectedText);

    mockStdin.sendChar('q');
    await sleep(50);
    expect(onNavigate).toHaveBeenCalled();

    unmount();
  });
});
