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

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForOutput = async (stdout: MockStdout, text: string, timeout = 1500) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (stdout.output.includes(text)) return;
    await wait(20);
  }
};

describe('CustomAnalyzerDashboard', () => {
  let stdin: any;
  let stdout: any;
  let app: ReturnType<typeof render> | undefined;

  afterEach(() => {
    app?.unmount();
    stdin?.push(null);
    app = undefined;
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
    app = render(
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
    await waitForOutput(stdout, 'keda-check');
    expect(stdout.output).toContain('keda-check');

    stdin.send('d');
    await wait();
    expect(onRemove).not.toHaveBeenCalled();
    stdin.send('y');
    await wait();
    expect(onRemove).toHaveBeenCalledWith('keda-check');
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
    app = render(
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
  });

  it('navigates and removes analyzers with keyboard controls', async () => {
    stdin = new MockStdin();
    stdout = new MockStdout();
    const onRemove = vi.fn();
    app = render(
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
    expect(onRemove).not.toHaveBeenCalled();
    stdin.send('n');
    await wait();
    expect(onRemove).not.toHaveBeenCalled();
    stdin.send('d');
    await wait();
    stdin.send('y');
    await wait();
    expect(onRemove).toHaveBeenCalledWith('second');
    stdin.send('d');
    await wait();
    stdin.send('y');
    await wait();
    expect(onRemove).toHaveBeenCalledWith('first');
    stdin.send('q');
    await wait();
  });

  it('rejects duplicate names and cancels the wizard with Esc', async () => {
    stdin = new MockStdin();
    stdout = new MockStdout();
    app = render(
      <CustomAnalyzerDashboard
        analyzers={[{ name: 'existing', command: 'echo existing' }]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
      { stdin, stdout, interactive: true },
    );

    stdin.send('a');
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const character of 'existing') stdin.send(character);
    await new Promise((resolve) => setTimeout(resolve, 100));
    stdin.send('\r');
    await wait();
    expect(stdout.output).toContain('already exists');
    stdin.send('\u001b');
    await wait();
    expect(stdout.output).toContain('Custom Analyzers');
  });

  it('adds a valid HTTPS webhook and rejects an invalid URL', async () => {
    stdin = new MockStdin();
    stdout = new MockStdout();
    const onAdd = vi.fn();
    app = render(
      <CustomAnalyzerDashboard analyzers={[]} onAdd={onAdd} onRemove={vi.fn()} />,
      { stdin, stdout, interactive: true },
    );

    stdin.send('a');
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const character of 'webhook') stdin.send(character);
    await new Promise((resolve) => setTimeout(resolve, 100));
    stdin.send('\r');
    await wait();
    stdin.send('\u001b[B');
    await wait();
    stdin.send('\r');
    await wait();
    for (const character of 'not-a-url') stdin.send(character);
    await new Promise((resolve) => setTimeout(resolve, 100));
    stdin.send('\r');
    await wait();
    expect(stdout.output).toContain('valid HTTP or HTTPS URL');
    stdin.send('\u001b');
    await wait();

    stdin.send('a');
    await wait();
    for (const character of 'webhook') stdin.send(character);
    await wait();
    stdin.send('\r');
    await wait();
    stdin.send('\u001b[B');
    await wait();
    stdin.send('\r');
    await wait();
    for (const character of 'https://example.com/hook') stdin.send(character);
    await wait();
    stdin.send('\r');
    await wait();
    expect(onAdd).toHaveBeenCalledWith({ name: 'webhook', url: 'https://example.com/hook' });
  });
});
