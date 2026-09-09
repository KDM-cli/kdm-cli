import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink';
import { Readable, Writable } from 'node:stream';
import { Console } from 'node:console';
import { CustomAnalyzerDashboard, isValidUrl } from '../ui/CustomAnalyzerDashboard';

if (!(console as any).Console) {
  (console as any).Console = Console;
}

class MockStdout extends Writable {
  output = '';
  isTTY = true;
  columns = 80;
  rows = 24;

  _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void) {
    this.output += chunk.toString();
    callback();
  }
}

class MockStdin extends Readable {
  isTTY = true;
  setRawMode = vi.fn();
  setEncoding = vi.fn();
  ref = vi.fn();
  unref = vi.fn();

  _read() {}

  send(value: string) {
    this.push(Buffer.from(value));
  }
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('CustomAnalyzerDashboard', () => {
  let stdin: MockStdin;
  let stdout: MockStdout;

  afterEach(() => {
    stdin?.push(null);
  });

  it('adds a command rule through the wizard and removes the selected rule', async () => {
    stdin = new MockStdin();
    stdout = new MockStdout();
    const analyzers: { name: string; command?: string }[] = [];
    const onAdd = vi.fn((config) => analyzers.push(config));
    const onRemove = vi.fn((name: string) => {
      analyzers.splice(
        analyzers.findIndex((analyzer) => analyzer.name === name),
        1,
      );
    });
    const app = render(
      <CustomAnalyzerDashboard analyzers={analyzers} onAdd={onAdd} onRemove={onRemove} />,
      { stdin, stdout, interactive: true },
    );

    stdin.send('a');
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const character of 'keda-check') stdin.send(character);
    await wait();
    stdin.send('\r');
    await wait();
    stdin.send('\r');
    await wait();
    for (const character of 'kubectl get scaledobjects -A -o json') stdin.send(character);
    await wait();
    stdin.send('\r');
    await wait();

    expect(onAdd).toHaveBeenCalledWith({
      name: 'keda-check',
      command: 'kubectl get scaledobjects -A -o json',
    });
    expect(stdout.output).toContain('keda-check');

    stdin.send('d');
    await wait();
    expect(onRemove).toHaveBeenCalledWith('keda-check');

    app.unmount();
  });

  it('validates webhook URLs', () => {
    expect(isValidUrl('https://example.com/hook')).toBe(true);
    expect(isValidUrl('http://localhost:8080')).toBe(true);
    expect(isValidUrl('not-a-url')).toBe(false);
    expect(isValidUrl('ftp://example.com')).toBe(false);
  });

  it('shows a validation error for an empty rule name', async () => {
    stdin = new MockStdin();
    stdout = new MockStdout();
    const app = render(
      <CustomAnalyzerDashboard
        analyzers={[{ name: 'existing', command: 'echo existing' }]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
      { stdin, stdout, interactive: true },
    );

    stdin.send('a');
    await new Promise((resolve) => setTimeout(resolve, 100));
    stdin.send('\r');
    await wait();
    expect(stdout.output).toContain('Rule name is required');
    stdin.send('\u001b');
    await wait();
    stdin.send('\u001b');
    await wait();
    app.unmount();
  });

  it('navigates and removes analyzers with keyboard controls', async () => {
    stdin = new MockStdin();
    stdout = new MockStdout();
    const onRemove = vi.fn();
    const app = render(
      <CustomAnalyzerDashboard
        analyzers={[
          { name: 'first', command: 'echo first' },
          { name: 'second', url: 'https://example.com' },
        ]}
        onAdd={vi.fn()}
        onRemove={onRemove}
      />,
      { stdin, stdout, interactive: true },
    );

    stdin.send('\u001b[B');
    await wait();
    stdin.send('d');
    await wait();
    expect(onRemove).toHaveBeenCalledWith('second');
    stdin.send('\u001b[3~');
    await wait();
    expect(onRemove).toHaveBeenCalledWith('first');
    stdin.send('q');
    await wait();
    app.unmount();
  });
});
