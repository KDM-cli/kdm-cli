import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink';
import { Readable, Writable } from 'node:stream';
import { ShowDashboard } from '../ui/show/ShowDashboard';

vi.mock('../kubernetes/pods', () => ({
  getRunningPods: vi.fn(async () => [
    { name: 'api-server', namespace: 'default', status: 'Running', restarts: 0, node: 'node-1' },
    { name: 'worker', namespace: 'default', status: 'Running', restarts: 0, node: 'node-1' },
  ]),
  getK8sClusterStats: vi.fn(async () => null),
}));
vi.mock('../docker/containers', () => ({
  getRunningContainers: vi.fn(async () => []),
  getDockerSystemStats: vi.fn(async () => null),
  formatDockerBytes: vi.fn(() => '0 B'),
}));
vi.mock('../kubernetes/resources', () => ({ listNodes: vi.fn(async () => []) }));
vi.mock('../minikube/client', () => ({ getMinikubeStatus: vi.fn(async () => []) }));

class TestStdout extends Writable {
  output = '';
  isTTY = true;
  columns = 100;
  rows = 30;
  _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void) {
    this.output += chunk.toString();
    callback();
  }
}
class TestStdin extends Readable {
  isTTY = true;
  setRawMode = vi.fn();
  setEncoding = vi.fn();
  ref = vi.fn();
  unref = vi.fn();
  _read() {}
  send(value: string) { this.push(Buffer.from(value)); }
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 60));

describe('ShowDashboard search', () => {
  let app: ReturnType<typeof render> | undefined;
  let stdin: TestStdin | undefined;

  afterEach(() => {
    app?.unmount();
    stdin?.push(null);
    app = undefined;
    stdin = undefined;
  });

  it('preserves the query when Enter leaves search mode and opens a filtered resource', async () => {
    const stdout = new TestStdout();
    stdin = new TestStdin();
    app = render(<ShowDashboard />, { stdin, stdout, debug: true });
    await wait();
    stdin.send('/');
    await wait();
    stdin.send('api');
    await wait();
    stdin.send('\r');
    await wait();
    expect(stdout.output).toContain('Search: api');
    expect(stdout.output).toContain('api-server');
    stdin.send('\u001b[B');
    await wait();
    stdin.send('\r');
    await wait();
    expect(stdout.output).toContain('Pod: api-server');
  });

  it('preserves the query when Escape blurs the search input', async () => {
    const stdout = new TestStdout();
    stdin = new TestStdin();
    app = render(<ShowDashboard />, { stdin, stdout, debug: true });
    await wait();
    stdin.send('/');
    await wait();
    stdin.send('api');
    await wait();
    stdin.send('\u001b');
    await wait();
    expect(stdout.output).toContain('Search: api');
    expect(stdout.output).toContain('api-server');
  });

  it('clears a preserved filter when Escape is pressed after search is blurred', async () => {
    const stdout = new TestStdout();
    stdin = new TestStdin();
    app = render(<ShowDashboard />, { stdin, stdout, debug: true });
    await wait();
    stdin.send('/');
    await wait();
    stdin.send('api');
    await wait();
    stdin.send('\r');
    await wait();
    stdin.send('\u001b');
    await wait();
    expect(stdout.output.slice(-500)).toContain('worker');
  });
});
