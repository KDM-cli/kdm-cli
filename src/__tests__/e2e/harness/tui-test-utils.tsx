import React from 'react';
import { render, type Instance } from 'ink';
import { Readable, Writable } from 'node:stream';
import { vi } from 'vitest';

/**
 * Removes ANSI escape codes, terminal cursor controls, and alternate screen sequences.
 */
export function stripAnsi(str: string): string {
  return str
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '')
    .replace(/\u001bc/g, '');
}

export class TestStdout extends Writable {
  output = '';
  frames: string[] = [];
  isTTY = true;
  columns = 120;
  rows = 40;

  _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const text = chunk.toString();
    this.output += text;
    this.frames.push(text);
    callback();
  }

  clear(): void {
    this.output = '';
    this.frames = [];
  }

  getLastFrame(): string {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1] : this.output;
  }
}

export class TestStdin extends Readable {
  isTTY = true;
  setRawMode = vi.fn();
  setEncoding = vi.fn();
  ref = vi.fn();
  unref = vi.fn();

  _read(): void {}

  send(val: string): void {
    this.push(Buffer.from(val));
  }

  sendEnter(): void {
    this.send('\r');
  }

  sendEscape(): void {
    this.send('\u001b');
  }

  sendUp(): void {
    this.send('\u001b[A');
  }

  sendDown(): void {
    this.send('\u001b[B');
  }

  sendRight(): void {
    this.send('\u001b[C');
  }

  sendLeft(): void {
    this.send('\u001b[D');
  }

  sendTab(): void {
    this.send('\t');
  }

  sendCtrlC(): void {
    this.send('\u0003');
  }
}

export interface RenderTUIOptions {
  columns?: number;
  rows?: number;
}

export interface TUIRenderResult {
  instance: Instance;
  stdin: TestStdin;
  stdout: TestStdout;
  sendKey: (key: string) => void;
  wait: (ms?: number) => Promise<void>;
  unmount: () => void;
  getCleanOutput: () => string;
  getFrames: () => string[];
  getLastFrame: () => string;
}

export function renderTUI(
  element: React.ReactElement,
  options: RenderTUIOptions = {}
): TUIRenderResult {
  const stdin = new TestStdin();
  const stdout = new TestStdout();

  if (options.columns) stdout.columns = options.columns;
  if (options.rows) stdout.rows = options.rows;

  const instance = render(element, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
  });

  return {
    instance,
    stdin,
    stdout,
    sendKey: (key: string) => stdin.send(key),
    wait: (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms)),
    unmount: () => {
      try {
        instance.unmount();
      } catch {
        // ignore already unmounted
      }
      stdin.push(null);
    },
    getCleanOutput: () => stripAnsi(stdout.output),
    getFrames: () => stdout.frames.map(stripAnsi),
    getLastFrame: () => stripAnsi(stdout.getLastFrame()),
  };
}
