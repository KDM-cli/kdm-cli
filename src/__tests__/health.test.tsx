import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommand } from '../commands/health';
import { HealthDashboard } from '../ui/HealthDashboard';
import { getRunningPods, getK8sClusterStats } from '../kubernetes/pods';
import { getRunningContainers, getDockerSystemStats } from '../docker/containers';
import { render } from 'ink';
import { Writable, Readable } from 'node:stream';
import { Console } from 'node:console';

if (!(console as any).Console) {
  (console as any).Console = Console;
}

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
  throw new Error(`Timed out waiting for "${substring}" to appear in stdout.`);
};

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

describe('health command', () => {
  let program: Command;
  let mockStdout: MockWritable;
  let mockStdin: MockReadable;

  beforeEach(() => {
    mockStdout = new MockWritable();
    mockStdin = new MockReadable();
    vi.clearAllMocks();
    program = new Command();
    registerHealthCommand(program);
  });

  it('should register the health command', () => {
    const healthCmd = program.commands.find((c) => c.name() === 'health');
    expect(healthCmd).toBeDefined();
  });

  it('renders loading states and then displays health dashboard metrics', async () => {
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

    const { unmount } = render(
      <HealthDashboard initialTarget="all" initialWatch={false} initialInterval={5} />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );

    await waitForFrameToContain(mockStdout, 'pod-1');

    const output = mockStdout.frames.join('\n');
    expect(output).toContain('Health Score');
    expect(output).toContain('pod-1');
    expect(output).toContain('container-1');

    unmount();
  });
});