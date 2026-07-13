import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink';
import { Writable, Readable } from 'node:stream';
import { Console } from 'node:console';
import { WatchDashboard } from '../ui/WatchDashboard';
import { getRunningPods, getK8sClusterStats } from '../kubernetes/pods';
import { getRunningContainers, getDockerSystemStats } from '../docker/containers';

if (!(console as any).Console) {
  (console as any).Console = Console;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForFrameToContain = async (mockStdout: MockWritable, substring: string, timeout = 1000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const output = mockStdout.frames.join('\n');
    if (output.includes(substring)) {
      return;
    }
    await sleep(20);
  }
  console.error("TIMED OUT WAITING FOR: " + substring);
  console.error("FRAMES: " + JSON.stringify(mockStdout.frames));
  throw new Error(`Timed out waiting for "${substring}" to appear in stdout.`);
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

class MockReadable extends Readable {
  _read() {}
  isTTY = true;
  setRawMode = vi.fn();
  ref = vi.fn();
  unref = vi.fn();
}

vi.mock('../kubernetes/pods', async () => {
  const actual = await vi.importActual<typeof import('../kubernetes/pods')>('../kubernetes/pods');
  return {
    ...actual,
    getRunningPods: vi.fn(),
    getK8sClusterStats: vi.fn(),
  };
});

vi.mock('../docker/containers', async () => {
  const actual = await vi.importActual<typeof import('../docker/containers')>('../docker/containers');
  return {
    ...actual,
    getRunningContainers: vi.fn(),
    getDockerSystemStats: vi.fn(),
  };
});

describe('WatchDashboard', () => {
  let mockStdout: MockWritable;
  let mockStdin: MockReadable;

  beforeEach(() => {
    mockStdout = new MockWritable();
    mockStdin = new MockReadable();
    vi.clearAllMocks();
  });

  it('renders loading states and then displays pods and containers', async () => {
    vi.mocked(getRunningPods).mockResolvedValue([
      { name: 'pod-1', namespace: 'default', status: 'Running', restarts: 0, node: 'node-1' },
    ]);
    vi.mocked(getK8sClusterStats).mockResolvedValue({
      cpu: '250m',
      memory: '512MiB',
      source: 'metrics-server',
    });
    vi.mocked(getRunningContainers).mockResolvedValue([
      { id: 'c1', name: 'container-1', image: 'nginx', state: 'running', status: 'Up 2 hours' },
    ]);
    vi.mocked(getDockerSystemStats).mockResolvedValue({
      cpu: 15.5,
      memoryUsage: 2000000000,
      memoryLimit: 8000000000,
    });

    const { unmount } = render(<WatchDashboard />, { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true });

    await waitForFrameToContain(mockStdout, 'pod-1');

    const output = mockStdout.frames.join('\n');
    expect(output).toContain('Kubernetes Pods');
    expect(output).toContain('pod-1');
    expect(output).toContain('container-1');

    unmount();
  });

  it.each([
    {
      description: 'handles K8s API errors gracefully',
      mockSetup: () => {
        vi.mocked(getRunningPods).mockRejectedValue(new Error('K8s error'));
        vi.mocked(getK8sClusterStats).mockRejectedValue(new Error('K8s stats error'));
        vi.mocked(getRunningContainers).mockResolvedValue([]);
        vi.mocked(getDockerSystemStats).mockResolvedValue(null);
      },
      errorMsg: 'ERROR: K8S - K8s error',
      outputMsg: 'k8s Stats: CPU: N/A | Mem: N/A',
    },
    {
      description: 'handles Docker API errors gracefully',
      mockSetup: () => {
        vi.mocked(getRunningPods).mockResolvedValue([]);
        vi.mocked(getK8sClusterStats).mockResolvedValue({ cpu: 'N/A', memory: 'N/A', source: 'N/A' });
        vi.mocked(getRunningContainers).mockRejectedValue(new Error('Docker error'));
        vi.mocked(getDockerSystemStats).mockRejectedValue(new Error('Docker stats error'));
      },
      errorMsg: 'ERROR: DOCKER - Docker error',
      outputMsg: 'Docker Stats: CPU: N/A | Mem: N/A',
    },
  ])('$description', async ({ mockSetup, errorMsg, outputMsg }) => {
    mockSetup();

    const { unmount } = render(<WatchDashboard />, { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true });

    await waitForFrameToContain(mockStdout, errorMsg);

    const output = mockStdout.frames.join('\n');
    expect(output).toContain(outputMsg);

    unmount();
  });

  it('handles terminal resize events dynamically', async () => {
    vi.mocked(getRunningPods).mockResolvedValue([]);
    vi.mocked(getK8sClusterStats).mockResolvedValue({ cpu: 'N/A', memory: 'N/A', source: 'N/A' });
    vi.mocked(getRunningContainers).mockResolvedValue([]);
    vi.mocked(getDockerSystemStats).mockResolvedValue(null);

    const originalColumns = process.stdout.columns;
    
    Object.defineProperty(process.stdout, 'columns', {
      value: 40,
      writable: true,
      configurable: true,
    });

    const { unmount } = render(<WatchDashboard />, { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true });
    
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
