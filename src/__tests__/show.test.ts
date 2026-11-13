import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { Readable, Writable } from 'node:stream';
import { render } from 'ink';
import { getRunningContainers } from '../docker/containers';
import { getRunningPods } from '../kubernetes/pods';
import { logger } from '../utils/logger';
import { showRunners, showPods } from '../commands/show';
import { createSpinner } from '../ui/spinner';
import * as tableUtils from '../ui/table';
import { ShowDashboard } from '../ui/show/ShowDashboard';

// Mock dependencies
vi.mock('../docker/containers', () => ({
  getRunningContainers: vi.fn(),
  getDockerSystemStats: vi.fn(async () => null),
  formatDockerBytes: vi.fn(() => '0 B'),
}));
vi.mock('../kubernetes/pods', () => ({
  getRunningPods: vi.fn(),
  getK8sClusterStats: vi.fn(async () => null),
}));
vi.mock('../kubernetes/resources', () => ({ listNodes: vi.fn(async () => []) }));
vi.mock('../minikube/client', () => ({ getMinikubeStatus: vi.fn(async () => []) }));
vi.mock('../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock('../ui/spinner', () => ({
  createSpinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  })),
}));
vi.mock('../ui/table', () => ({
  renderTable: vi.fn(),
}));

describe('show command runners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle Kubernetes connection failure gracefully in showRunners', async () => {
    // Setup: Docker succeeds, Kubernetes fails
    (getRunningContainers as any).mockResolvedValue([{ id: '123', name: 'web', image: 'nginx', state: 'running', status: 'Up' }]);
    (getRunningPods as any).mockRejectedValue(new Error('EHOSTUNREACH'));

    await showRunners();

    // Verify: Warning was logged for Kubernetes, but no crash
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Kubernetes is unreachable'));
    
    // Verify spinner lifecycle
    expect(createSpinner).toHaveBeenCalled();
    const spinnerInstance = vi.mocked(createSpinner).mock.results[0].value;
    expect(spinnerInstance.start).toHaveBeenCalled();
    expect(spinnerInstance.warn).toHaveBeenCalledWith(expect.stringContaining('Some runners could not be fetched'));
    
    // Verify: Table still rendered with Docker data
    expect(tableUtils.renderTable).toHaveBeenCalled();
  });

  it('should handle both services failing gracefully in showRunners', async () => {
    (getRunningContainers as any).mockRejectedValue(new Error('Docker down'));
    (getRunningPods as any).mockRejectedValue(new Error('K8s down'));

    await showRunners();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Docker is unreachable'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Kubernetes is unreachable'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No running containers or pods found'));

    // Verify spinner lifecycle
    const spinnerInstance = vi.mocked(createSpinner).mock.results[0].value;
    expect(spinnerInstance.warn).toHaveBeenCalledWith(expect.stringContaining('Some runners could not be fetched'));
  });

  it('should handle Kubernetes connection failure gracefully in showPods', async () => {
    (getRunningPods as any).mockRejectedValue(new Error('EHOSTUNREACH'));

    // Should not throw
    await expect(showPods()).resolves.not.toThrow();

    // Verify spinner lifecycle
    const spinnerInstance = vi.mocked(createSpinner).mock.results[0].value;
    expect(spinnerInstance.fail).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch Kubernetes pods'));
  });
});

class DashboardStdout extends Writable {
  output = '';
  isTTY = true;
  columns = 100;
  rows = 30;
  _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void) {
    this.output += chunk.toString();
    callback();
  }
}
class DashboardStdin extends Readable {
  isTTY = true;
  setRawMode = vi.fn();
  setEncoding = vi.fn();
  ref = vi.fn();
  unref = vi.fn();
  _read() {}
  send(value: string) { this.push(Buffer.from(value)); }
}

describe('ShowDashboard filtered search', () => {
  it('blurs search without losing the query and navigates filtered rows', async () => {
    vi.mocked(getRunningPods).mockResolvedValue([
      { name: 'api-server', namespace: 'default', status: 'Running', restarts: 0, node: 'node-1' } as any,
      { name: 'worker', namespace: 'default', status: 'Running', restarts: 0, node: 'node-1' } as any,
    ]);
    vi.mocked(getRunningContainers).mockResolvedValue([]);
    const stdout = new DashboardStdout();
    const stdin = new DashboardStdin();
    const app = render(React.createElement(ShowDashboard), { stdin, stdout, debug: true });
    const wait = () => new Promise((resolve) => setTimeout(resolve, 60));
    await wait();
    stdin.send('/');
    await wait();
    stdin.send('api');
    await wait();
    stdin.send('\r');
    await wait();
    expect(stdout.output).toContain('Search: api');
    stdin.send('\u001b[B');
    await wait();
    stdin.send('\r');
    await wait();
    expect(stdout.output).toContain('Pod: api-server');
    app.unmount();
    stdin.push(null);
  });

  it('clears a blurred search filter on Escape', async () => {
    vi.mocked(getRunningPods).mockResolvedValue([
      { name: 'api-server', namespace: 'default', status: 'Running', restarts: 0, node: 'node-1' } as any,
      { name: 'worker', namespace: 'default', status: 'Running', restarts: 0, node: 'node-1' } as any,
    ]);
    vi.mocked(getRunningContainers).mockResolvedValue([]);
    const stdout = new DashboardStdout();
    const stdin = new DashboardStdin();
    const app = render(React.createElement(ShowDashboard), { stdin, stdout, debug: true });
    const wait = () => new Promise((resolve) => setTimeout(resolve, 60));
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
    app.unmount();
    stdin.push(null);
  });
});
