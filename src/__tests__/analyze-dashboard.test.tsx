import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink';
import { Writable, Readable } from 'node:stream';
import { Console } from 'node:console';
import { AnalyzeDashboard } from '../ui/AnalyzeDashboard';
import * as analysisModule from '../analysis/analysis';
import * as fixModule from '../analysis/fix';
import type { AnalysisOutput } from '../analysis/types';

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
      backspace: '\u007f',
    };
    const seq = sequences[name];
    if (seq) {
      this.write(seq);
    }
  }
  sendChar(char: string) {
    this.write(char);
  }
  async sendStr(str: string) {
    for (const ch of str) {
      this.sendChar(ch);
      await sleep(10);
    }
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

describe('AnalyzeDashboard', () => {
  let mockStdout: MockStdout;
  let mockStdin: MockStdin;

  const mockHealthyResult: AnalysisOutput = {
    status: 'OK',
    problems: 0,
    errors: [],
    results: [],
  };

  const mockProblemResult: AnalysisOutput = {
    status: 'ProblemDetected',
    problems: 2,
    errors: [],
    suggestedFixes: [
      {
        id: 'pod-0-0',
        title: 'Restart crashed pod',
        description: 'Pod is in CrashLoopBackOff',
        kind: 'Pod',
        resourceName: 'web-pod',
        namespace: 'default',
      },
    ],
    results: [
      {
        kind: 'Pod',
        name: 'web-pod',
        namespace: 'default',
        errors: [{ text: 'CrashLoopBackOff: back-off 5m restarting failed container' }],
      },
      {
        kind: 'Deployment',
        name: 'api-dep',
        namespace: 'prod',
        errors: [{ text: 'Zero available replicas' }],
      },
    ],
  };

  beforeEach(() => {
    mockStdout = new MockStdout();
    mockStdin = new MockStdin();
    vi.clearAllMocks();
  });

  it('renders clean fallback state when zero problems are detected', async () => {
    vi.spyOn(analysisModule, 'runAnalysis').mockResolvedValue(mockHealthyResult);

    const { unmount } = render(
      <AnalyzeDashboard
        initialOptions={{ namespace: 'test-ns', output: 'text' }}
        initialResult={mockHealthyResult}
      />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );

    await waitForFrame(mockStdout, 'No Problems Detected');
    const output = mockStdout.frames.join('\n');
    expect(output).toContain('test-ns');
    expect(output).toContain('OK (0)');
    unmount();
  });

  it('renders split pane with detected issues and initial selection', async () => {
    const { unmount } = render(
      <AnalyzeDashboard
        initialOptions={{ namespace: 'default', output: 'text' }}
        initialResult={mockProblemResult}
      />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );

    await waitForFrame(mockStdout, 'Detected Issues');
    const output = mockStdout.frames.join('\n');
    expect(output).toContain('web-pod');
    expect(output).toContain('api-dep');
    expect(output).toContain('Details & Fix');
    expect(output).toContain('Restart crashed pod');
    unmount();
  });

  it('navigates through items with arrow keys', async () => {
    const { unmount } = render(
      <AnalyzeDashboard
        initialOptions={{ namespace: 'default', output: 'text' }}
        initialResult={mockProblemResult}
      />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );

    await waitForFrame(mockStdout, 'web-pod');
    mockStdin.sendKey('down');
    await waitForFrame(mockStdout, 'api-dep');

    const output = mockStdout.frames.join('\n');
    expect(output).toContain('Zero available replicas');
    unmount();
  });

  it('requires confirmation before executing a fix and cancels on n/Esc', async () => {
    const fixSpy = vi.spyOn(fixModule, 'executeFix');

    const { unmount } = render(
      <AnalyzeDashboard
        initialOptions={{ namespace: 'default', output: 'text' }}
        initialResult={mockProblemResult}
      />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );

    await waitForFrame(mockStdout, 'web-pod');
    // Request fix with 'f'
    mockStdin.sendChar('f');
    await waitForFrame(mockStdout, 'Confirm Remediation');

    // Reject with 'n'
    mockStdin.sendChar('n');
    await sleep(50);
    expect(fixSpy).not.toHaveBeenCalled();

    unmount();
  });

  it('executes fix upon explicit user confirmation (y) and triggers re-analysis', async () => {
    const fixSpy = vi.spyOn(fixModule, 'executeFix').mockResolvedValue({
      success: true,
      message: 'Pod web-pod deleted successfully.',
    });
    const reanalyzeSpy = vi.spyOn(analysisModule, 'runAnalysis').mockResolvedValue(mockHealthyResult);

    const { unmount } = render(
      <AnalyzeDashboard
        initialOptions={{ namespace: 'default', output: 'text' }}
        initialResult={mockProblemResult}
      />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );

    await waitForFrame(mockStdout, 'web-pod');
    mockStdin.sendChar('f');
    await waitForFrame(mockStdout, 'Confirm Remediation');

    // Confirm with 'y'
    mockStdin.sendChar('y');
    await waitForFrame(mockStdout, 'Pod web-pod deleted successfully.');

    expect(fixSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceName: 'web-pod',
      })
    );
    expect(reanalyzeSpy).toHaveBeenCalled();
    unmount();
  });

  it('changes namespace on n modal and automatically re-analyzes', async () => {
    const reanalyzeSpy = vi.spyOn(analysisModule, 'runAnalysis').mockResolvedValue(mockHealthyResult);

    const { unmount } = render(
      <AnalyzeDashboard
        initialOptions={{ namespace: 'default', output: 'text' }}
        initialResult={mockProblemResult}
      />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );

    await waitForFrame(mockStdout, 'web-pod');
    mockStdin.sendChar('n');
    await waitForFrame(mockStdout, 'Change Namespace');

    await mockStdin.sendStr('kube-system');
    await waitForFrame(mockStdout, 'kube-system');
    await sleep(30);
    mockStdin.sendKey('return');

    await sleep(100);
    expect(reanalyzeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'kube-system',
      })
    );
    unmount();
  });

  it('switches backend on b modal and automatically re-analyzes', async () => {
    const reanalyzeSpy = vi.spyOn(analysisModule, 'runAnalysis').mockResolvedValue(mockHealthyResult);

    const { unmount } = render(
      <AnalyzeDashboard
        initialOptions={{ namespace: 'default', output: 'text', backend: 'openai' }}
        initialResult={mockProblemResult}
      />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );

    await waitForFrame(mockStdout, 'web-pod');
    mockStdin.sendChar('b');
    await waitForFrame(mockStdout, 'Select AI Backend Provider');

    // Navigate down and wait for frame with '> ollama'
    mockStdin.sendKey('down');
    await waitForFrame(mockStdout, '> ollama');
    mockStdin.sendKey('return');

    await sleep(100);
    expect(reanalyzeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'ollama',
      })
    );
    unmount();
  });

  it('triggers on-demand explanation when e is pressed and handles failures gracefully', async () => {
    vi.spyOn(analysisModule, 'explainSingleResult').mockRejectedValue(new Error('AI Quota Exceeded'));

    const { unmount } = render(
      <AnalyzeDashboard
        initialOptions={{ namespace: 'default', output: 'text' }}
        initialResult={mockProblemResult}
      />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );

    await waitForFrame(mockStdout, 'web-pod');
    mockStdin.sendChar('e');
    await waitForFrame(mockStdout, 'Explanation failed: AI Quota Exceeded');

    // Dashboard continues functioning without crash
    const output = mockStdout.frames.join('\n');
    expect(output).toContain('AI Quota Exceeded');
    expect(output).toContain('web-pod');
    unmount();
  });

  it('triggers manual re-analysis when r is pressed', async () => {
    const reanalyzeSpy = vi.spyOn(analysisModule, 'runAnalysis').mockResolvedValue(mockHealthyResult);

    const { unmount } = render(
      <AnalyzeDashboard
        initialOptions={{ namespace: 'default', output: 'text' }}
        initialResult={mockProblemResult}
      />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );

    await waitForFrame(mockStdout, 'web-pod');
    mockStdin.sendChar('r');

    await sleep(50);
    expect(reanalyzeSpy).toHaveBeenCalled();
    unmount();
  });

  it('displays agent loader message when multi-agent progress event is received', async () => {
    vi.spyOn(analysisModule, 'explainSingleResult').mockImplementation(async (params) => {
      params.onAgentProgress?.({
        agent: 'RuntimeLogAgent',
        status: 'working',
        message: 'Runtime Log Agent is inspecting container logs...',
      });
      await sleep(100);
    });

    const { unmount } = render(
      <AnalyzeDashboard
        initialOptions={{ namespace: 'default', output: 'text', backend: 'ollama' }}
        initialResult={mockProblemResult}
      />,
      { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
    );

    await waitForFrame(mockStdout, 'web-pod');
    mockStdin.sendChar('e');
    await waitForFrame(mockStdout, 'Runtime Log Agent is inspecting container logs...');

    const output = mockStdout.frames.join('\n');
    expect(output).toContain('Runtime Log Agent is inspecting container logs...');
    unmount();
  });
});

