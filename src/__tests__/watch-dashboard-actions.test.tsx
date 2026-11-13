import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink';
import { Readable, Writable } from 'node:stream';
import { WatchDashboard } from '../ui/WatchDashboard';
import { getK8sApi } from '../kubernetes/client';

vi.mock('../kubernetes/pods', () => ({
  getRunningPods: vi.fn(async () => [{ name: 'api-pod', namespace: 'default', status: 'Running', restarts: 0, node: 'node-1' }]),
  getK8sClusterStats: vi.fn(async () => null),
}));
vi.mock('../docker/containers', () => ({
  getRunningContainers: vi.fn(async () => []),
  getDockerSystemStats: vi.fn(async () => null),
  formatDockerBytes: vi.fn(() => '0 B'),
}));
vi.mock('../kubernetes/client', () => ({
  getK8sApi: vi.fn(() => ({
    deleteNamespacedPod: vi.fn(async () => undefined),
    readNamespacedPodLog: vi.fn(async () => 'sample log'),
  })),
}));

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
const wait = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('WatchDashboard actions', () => {
  let app: ReturnType<typeof render> | undefined;
  let stdin: TestStdin | undefined;

  afterEach(() => {
    app?.unmount();
    stdin?.push(null);
    app = undefined;
    stdin = undefined;
    vi.clearAllMocks();
  });

  it('confirms Pod deletion and lets b close the log snapshot', async () => {
    const stdout = new TestStdout();
    stdin = new TestStdin();
    const api = getK8sApi() as any;
    app = render(<WatchDashboard />, { stdin, stdout, debug: true });
    await wait();

    stdin.send('r');
    await wait();
    expect(stdout.output).toContain('Press Y to confirm');
    expect(api.deleteNamespacedPod).not.toHaveBeenCalled();
    stdin.send('n');
    await wait();
    expect(api.deleteNamespacedPod).not.toHaveBeenCalled();

    stdin.send('r');
    await wait();
    stdin.send('y');
    await wait();
    expect(api.deleteNamespacedPod).toHaveBeenCalledWith({ name: 'api-pod', namespace: 'default' });

    stdin.send('l');
    await wait();
    expect(stdout.output).toContain('[SNAPSHOT]');
    expect(stdout.output).toContain('sample log');
    stdin.send('b');
    await wait();
    expect(stdout.output).toContain('KDM Split-Pane Monitoring Dashboard');

  });
});
