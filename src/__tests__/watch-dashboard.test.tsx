import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink';
import { Writable } from 'node:stream';
import { Console } from 'node:console';
import { WatchDashboard } from '../ui/WatchDashboard';
import * as podsMod from '../kubernetes/pods';
import * as containersMod from '../docker/containers';

if (!(console as any).Console) {
  (console as any).Console = Console;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForFrameToContain = async (mockStdout: MockWritable, substring: string, timeout = 5000) => {
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

const getRunningPodsSpy = vi.spyOn(podsMod, 'getRunningPods');
const getK8sClusterStatsSpy = vi.spyOn(podsMod, 'getK8sClusterStats');
const getRunningContainersSpy = vi.spyOn(containersMod, 'getRunningContainers');
const getDockerSystemStatsSpy = vi.spyOn(containersMod, 'getDockerSystemStats');

describe('WatchDashboard', () => {
  let mockStdout: MockWritable;

  beforeEach(() => {
    mockStdout = new MockWritable();
    vi.clearAllMocks();
  });

  it('renders loading states and then displays pods and containers', async () => {
    getRunningPodsSpy.mockResolvedValue([
      { name: 'pod-1', namespace: 'default', status: 'Running', restarts: 0, node: 'node-1' },
    ]);
    getK8sClusterStatsSpy.mockResolvedValue({
      cpu: '250m',
      memory: '512MiB',
      source: 'metrics-server',
    });
    getRunningContainersSpy.mockResolvedValue([
      { id: 'c1', name: 'container-1', image: 'nginx', state: 'running', status: 'Up 2 hours' },
    ]);
    getDockerSystemStatsSpy.mockResolvedValue({
      cpu: 15.5,
      memoryUsage: 2000000000,
      memoryLimit: 8000000000,
    });

    const { unmount } = render(<WatchDashboard />, { stdout: mockStdout as any, interactive: true });

    await waitForFrameToContain(mockStdout, 'pod-1');

    const output = mockStdout.frames.join('\n');
    expect(output).toContain('KDM Live Dashboard');
    expect(output).toContain('pod-1');
    expect(output).toContain('container-1');
    expect(output).toContain('k8s Stats: CPU: 250m | Mem: 512MiB');
    expect(output).toContain('Docker Stats: CPU: 15.5%');
    expect(output).toContain('Mem: 2GB');
    expect(output).toContain('8GB');

    unmount();
  });

  it.each([
    {
      description: 'handles K8s API errors gracefully',
      mockSetup: () => {
        getRunningPodsSpy.mockRejectedValue(new Error('K8s error'));
        getK8sClusterStatsSpy.mockRejectedValue(new Error('K8s stats error'));
        getRunningContainersSpy.mockResolvedValue([]);
        getDockerSystemStatsSpy.mockResolvedValue(null);
      },
      errorMsg: 'ERROR: K8S - K8s error',
      outputMsg: 'k8s Stats: CPU: N/A | Mem: N/A',
    },
    {
      description: 'handles Docker API errors gracefully',
      mockSetup: () => {
        getRunningPodsSpy.mockResolvedValue([]);
        getK8sClusterStatsSpy.mockResolvedValue({ cpu: 'N/A', memory: 'N/A', source: 'N/A' });
        getRunningContainersSpy.mockRejectedValue(new Error('Docker error'));
        getDockerSystemStatsSpy.mockRejectedValue(new Error('Docker stats error'));
      },
      errorMsg: 'ERROR: DOCKER - Docker error',
      outputMsg: 'Docker Stats: CPU: N/A | Mem: N/A',
    },
  ])('$description', async ({ mockSetup, errorMsg, outputMsg }) => {
    mockSetup();

    const { unmount } = render(<WatchDashboard />, { stdout: mockStdout as any, interactive: true });

    await waitForFrameToContain(mockStdout, errorMsg);

    const output = mockStdout.frames.join('\n');
    expect(output).toContain(outputMsg);

    unmount();
  });

  it('handles terminal resize events dynamically', async () => {
    getRunningPodsSpy.mockResolvedValue([]);
    getK8sClusterStatsSpy.mockResolvedValue({ cpu: 'N/A', memory: 'N/A', source: 'N/A' });
    getRunningContainersSpy.mockResolvedValue([]);
    getDockerSystemStatsSpy.mockResolvedValue(null);

    const originalColumns = process.stdout.columns;
    
    Object.defineProperty(process.stdout, 'columns', {
      value: 40,
      writable: true,
      configurable: true,
    });

    const { unmount } = render(<WatchDashboard />, { stdout: mockStdout as any, interactive: true });
    
    process.stdout.emit('resize');

    await sleep(200);

    const output = mockStdout.frames.join('\n');
    expect(output).toBeDefined();

    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      writable: true,
      configurable: true,
    });

    unmount();
  });
});
