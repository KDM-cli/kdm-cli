import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink';
import { Writable, Readable } from 'node:stream';
import { Console } from 'node:console';
import { InitialDashboard } from '../ui/InitialDashboard';
import * as dockerClient from '../docker/client';
import * as k8sClient from '../kubernetes/client';
import * as minikubeClient from '../minikube/client';

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
      up: '\u001b[A',
      down: '\u001b[B',
      return: '\r',
      enter: '\r',
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

describe('InitialDashboard', () => {
  let mockStdout: MockStdout;
  let mockStdin: MockStdin;

  const mockDockerConnected = { connected: true, containerCount: 5 };
  const mockK8sConnected = { connected: true, podCount: 12 };
  const mockMinikubeRunning = { installed: true, running: true };

  beforeEach(() => {
    mockStdout = new MockStdout();
    mockStdin = new MockStdin();
    vi.clearAllMocks();
  });

  const renderDashboard = (props: Partial<React.ComponentProps<typeof InitialDashboard>> = {}) => {
    return render(
      <InitialDashboard
        version="2.0.1"
        initialDocker={mockDockerConnected}
        initialK8s={mockK8sConnected}
        initialMinikube={mockMinikubeRunning}
        {...props}
      />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );
  };

  it('renders banner, version, connection status, and command list', async () => {
    const { unmount } = renderDashboard();

    await waitForFrame(mockStdout, 'Kubernetes & Docker Monitor v2.0.1');
    const output = mockStdout.frames.join('\n');
    expect(output).toContain('Docker:');
    expect(output).toContain('5 containers');
    expect(output).toContain('Kubernetes:');
    expect(output).toContain('12 pods');
    expect(output).toContain('Minikube:');
    expect(output).toContain('RUNNING');
    expect(output).toContain('Analyze Cluster');
    expect(output).toContain('Show Resources');
    unmount();
  });

  it('navigates through menu items with arrow keys and updates preview', async () => {
    const { unmount } = renderDashboard();

    await waitForFrame(mockStdout, '> 🔍 Analyze Cluster');
    mockStdin.sendKey('down');
    await waitForFrame(mockStdout, '> 📊 Show Resources');

    const output = mockStdout.frames.join('\n');
    expect(output).toContain('Command: kdm show runners');
    unmount();
  });

  it('launches selected action on Enter', async () => {
    const selectSpy = vi.fn();

    const { unmount } = renderDashboard({ onSelect: selectSpy });

    await waitForFrame(mockStdout, '> 🔍 Analyze Cluster');
    mockStdin.sendKey('return');
    await sleep(50);

    expect(selectSpy).toHaveBeenCalledWith(['analyze']);
    unmount();
  });

  it('launches action directly via shortcut hotkey', async () => {
    const selectSpy = vi.fn();

    const { unmount } = renderDashboard({ onSelect: selectSpy });

    await waitForFrame(mockStdout, 'Kubernetes & Docker Monitor');
    mockStdin.sendChar('w');
    await sleep(50);

    expect(selectSpy).toHaveBeenCalledWith(['watch']);
    unmount();
  });

  it('refreshes connections when r is pressed', async () => {
    const dockerSpy = vi.spyOn(dockerClient, 'checkDockerConnection').mockResolvedValue({
      connected: true,
      containerCount: 8,
    });
    const k8sSpy = vi.spyOn(k8sClient, 'checkK8sConnection').mockResolvedValue({
      connected: true,
      podCount: 15,
    });
    const minikubeSpy = vi.spyOn(minikubeClient, 'checkMinikubeConnection').mockResolvedValue({
      installed: true,
      running: true,
    });

    const { unmount } = renderDashboard();

    await waitForFrame(mockStdout, 'Kubernetes & Docker Monitor');
    mockStdin.sendChar('r');

    await sleep(50);
    expect(dockerSpy).toHaveBeenCalled();
    expect(k8sSpy).toHaveBeenCalled();
    expect(minikubeSpy).toHaveBeenCalled();
    unmount();
  });

  it('triggers onExit when q or escape is pressed', async () => {
    const exitSpy = vi.fn();

    const { unmount } = renderDashboard({ onExit: exitSpy });

    await waitForFrame(mockStdout, 'Kubernetes & Docker Monitor');
    mockStdin.sendChar('q');
    await sleep(50);

    expect(exitSpy).toHaveBeenCalledTimes(1);

    exitSpy.mockClear();
    mockStdin.sendKey('escape');
    await sleep(50);

    expect(exitSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('navigates to help screen and returns back to main dashboard on Esc or B', async () => {
    const { unmount } = renderDashboard();

    await waitForFrame(mockStdout, 'Kubernetes & Docker Monitor');
    mockStdin.sendChar('?');
    await waitForFrame(mockStdout, 'KDM - Kubernetes & Docker Monitoring CLI Help');

    // Press 'b' to go back
    mockStdin.sendChar('b');
    await waitForFrame(mockStdout, 'Select an Action to Launch:');

    unmount();
  });

  it('navigates to analyze subscreen and returns back to home dashboard on Esc', async () => {
    const { unmount } = renderDashboard();

    await waitForFrame(mockStdout, 'Kubernetes & Docker Monitor');
    mockStdin.sendChar('a');
    await waitForFrame(mockStdout, 'KDM Analyze Dashboard');

    // Press Escape to go back
    mockStdin.sendKey('escape');
    await waitForFrame(mockStdout, 'Select an Action to Launch:');

    unmount();
  });
});
