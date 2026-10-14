import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink';
import { Writable, Readable } from 'node:stream';
import { Console } from 'node:console';
import {
  SafetyPrompt,
  promptSafetyConfirmation,
  getRiskColor,
  parseDiffLines,
  type RemediationProposal,
  type SafetyPromptProps,
} from '../remediation/safety-prompt';

if (!(console as any).Console) {
  (console as any).Console = Console;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class MockStdout extends Writable {
  frames: string[] = [];
  isTTY = true;
  columns = 120;
  rows = 40;
  _write(chunk: any, _encoding: any, callback: (error?: Error | null) => void) {
    this.frames.push(chunk.toString());
    callback();
  }
  get output(): string {
    return this.frames.join('\n');
  }
}

class MockStdin extends Readable {
  _read() {}
  isTTY = true;
  setRawMode = vi.fn();
  setEncoding = vi.fn();
  ref = vi.fn();
  unref = vi.fn();
  sendChar(char: string) {
    this.push(Buffer.from(char));
  }
}

const SAMPLE_PROPOSAL: RemediationProposal = {
  action: 'Increase Container Memory Limit',
  risk: 'LOW',
  riskDetails: 'Safe rollback available',
  command: 'kubectl set resources deployment checkout-api --limits=memory=512Mi',
  diffPreview: '- limits.memory: 256Mi\n+ limits.memory: 512Mi',
};

const waitForFrame = async (mockStdout: MockStdout, substring: string, timeout = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (mockStdout.output.includes(substring)) {
      return;
    }
    await sleep(25);
  }
  throw new Error(`Timed out waiting for frame containing "${substring}". Last output:\n${mockStdout.output}`);
};

interface TestHarness {
  onConfirm: ReturnType<typeof vi.fn>;
  onAbort: ReturnType<typeof vi.fn>;
  onDecision: ReturnType<typeof vi.fn>;
  sendAndWait: (char: string) => Promise<void>;
  unmount: () => void;
}

async function setupPromptHarness(
  stdout: MockStdout,
  stdin: MockStdin,
  customProps: Partial<SafetyPromptProps> = {}
): Promise<TestHarness> {
  const onConfirm = vi.fn();
  const onAbort = vi.fn();
  const onDecision = vi.fn();

  const { unmount } = render(
    React.createElement(SafetyPrompt, {
      proposal: SAMPLE_PROPOSAL,
      onConfirm,
      onAbort,
      onDecision,
      ...customProps,
    }),
    {
      stdout: stdout as any,
      stdin: stdin as any,
    }
  );

  await waitForFrame(stdout, 'Apply this remediation to the cluster?');

  const sendAndWait = async (char: string) => {
    stdin.sendChar(char);
    await sleep(40);
  };

  return { onConfirm, onAbort, onDecision, sendAndWait, unmount };
}

describe('SafetyPrompt Component & Interactive Safety Gate', () => {
  let mockStdout: MockStdout;
  let mockStdin: MockStdin;

  beforeEach(() => {
    mockStdout = new MockStdout();
    mockStdin = new MockStdin();
  });

  it('renders the complete remediation proposal layout accurately', async () => {
    const { unmount } = render(
      React.createElement(SafetyPrompt, { proposal: SAMPLE_PROPOSAL }),
      {
        stdout: mockStdout as any,
        stdin: mockStdin as any,
      }
    );

    await waitForFrame(mockStdout, 'Remediation Proposal');
    const out = mockStdout.output;

    expect(out).toContain('Remediation Proposal');
    expect(out).toContain('Action:');
    expect(out).toContain('Increase Container Memory Limit');
    expect(out).toContain('Risk:');
    expect(out).toContain('LOW · Safe rollback available');
    expect(out).toContain('Command:');
    expect(out).toContain('$ kubectl set resources deployment checkout-api --limits=memory=512Mi');
    expect(out).toContain('Diff Preview:');
    expect(out).toContain('- limits.memory: 256Mi');
    expect(out).toContain('+ limits.memory: 512Mi');
    expect(out).toContain('Apply this remediation to the cluster? [y/N]:');

    unmount();
  });

  it('renders with individual props without a nested proposal object', async () => {
    const { unmount } = render(
      React.createElement(SafetyPrompt, {
        action: 'Scale Service Replicas',
        risk: 'MEDIUM',
        riskDetails: 'Potential brief latency',
        command: 'kubectl scale deployment api --replicas=3',
        diffPreview: ['- replicas: 1', '+ replicas: 3'],
      }),
      {
        stdout: mockStdout as any,
        stdin: mockStdin as any,
      }
    );

    await waitForFrame(mockStdout, 'Scale Service Replicas');
    const out = mockStdout.output;

    expect(out).toContain('Scale Service Replicas');
    expect(out).toContain('MEDIUM · Potential brief latency');
    expect(out).toContain('$ kubectl scale deployment api --replicas=3');
    expect(out).toContain('- replicas: 1');
    expect(out).toContain('+ replicas: 3');

    unmount();
  });

  it('confirms execution on lowercase "y" keypress', async () => {
    const harness = await setupPromptHarness(mockStdout, mockStdin);
    await harness.sendAndWait('y');

    expect(harness.onConfirm).toHaveBeenCalledTimes(1);
    expect(harness.onDecision).toHaveBeenCalledWith(true);
    expect(harness.onAbort).not.toHaveBeenCalled();
    harness.unmount();
  });

  it('confirms execution on uppercase "Y" keypress', async () => {
    const harness = await setupPromptHarness(mockStdout, mockStdin);
    await harness.sendAndWait('Y');

    expect(harness.onConfirm).toHaveBeenCalledTimes(1);
    expect(harness.onDecision).toHaveBeenCalledWith(true);
    harness.unmount();
  });

  it('defaults to abort on Enter keypress', async () => {
    const harness = await setupPromptHarness(mockStdout, mockStdin);
    await harness.sendAndWait('\r');

    expect(harness.onAbort).toHaveBeenCalledTimes(1);
    expect(harness.onDecision).toHaveBeenCalledWith(false);
    expect(harness.onConfirm).not.toHaveBeenCalled();
    harness.unmount();
  });

  it('aborts execution on explicit "n" keypress', async () => {
    const harness = await setupPromptHarness(mockStdout, mockStdin);
    await harness.sendAndWait('n');

    expect(harness.onAbort).toHaveBeenCalledTimes(1);
    expect(harness.onDecision).toHaveBeenCalledWith(false);
    expect(harness.onConfirm).not.toHaveBeenCalled();
    harness.unmount();
  });

  it('aborts execution on explicit "N" keypress', async () => {
    const harness = await setupPromptHarness(mockStdout, mockStdin);
    await harness.sendAndWait('N');

    expect(harness.onAbort).toHaveBeenCalledTimes(1);
    expect(harness.onDecision).toHaveBeenCalledWith(false);
    harness.unmount();
  });

  it('aborts execution on any unexpected single keypress', async () => {
    const harness = await setupPromptHarness(mockStdout, mockStdin);
    await harness.sendAndWait('x');

    expect(harness.onAbort).toHaveBeenCalledTimes(1);
    expect(harness.onDecision).toHaveBeenCalledWith(false);
    harness.unmount();
  });

  it('ignores subsequent keypresses after the single initial decision', async () => {
    const harness = await setupPromptHarness(mockStdout, mockStdin);
    await harness.sendAndWait('y');

    mockStdin.sendChar('n');
    mockStdin.sendChar('\r');
    await sleep(40);

    expect(harness.onDecision).toHaveBeenCalledTimes(1);
    expect(harness.onDecision).toHaveBeenCalledWith(true);
    harness.unmount();
  });

  it('promptSafetyConfirmation helper resolves true on "y"', async () => {
    const promise = promptSafetyConfirmation(SAMPLE_PROPOSAL, {
      stdin: mockStdin as any,
      stdout: mockStdout as any,
    });

    await waitForFrame(mockStdout, 'Apply this remediation to the cluster?');
    mockStdin.sendChar('y');

    const result = await promise;
    expect(result).toBe(true);
  });

  it('promptSafetyConfirmation helper resolves false on Enter', async () => {
    const promise = promptSafetyConfirmation(SAMPLE_PROPOSAL, {
      stdin: mockStdin as any,
      stdout: mockStdout as any,
    });

    await waitForFrame(mockStdout, 'Apply this remediation to the cluster?');
    mockStdin.sendChar('\r');

    const result = await promise;
    expect(result).toBe(false);
  });
});

describe('SafetyPrompt Utility Functions', () => {
  it('getRiskColor maps risk levels to corresponding colors', () => {
    expect(getRiskColor('LOW')).toBe('green');
    expect(getRiskColor('low')).toBe('green');
    expect(getRiskColor('MEDIUM')).toBe('yellow');
    expect(getRiskColor('medium')).toBe('yellow');
    expect(getRiskColor('HIGH')).toBe('red');
    expect(getRiskColor('high')).toBe('red');
    expect(getRiskColor('unknown')).toBe('cyan');
  });

  it('parseDiffLines handles multiline strings and array inputs', () => {
    expect(parseDiffLines(undefined)).toEqual([]);
    expect(parseDiffLines('')).toEqual([]);
    expect(parseDiffLines('- a\n+ b\n')).toEqual(['- a', '+ b']);
    expect(parseDiffLines(['- line1', '+ line2'])).toEqual(['- line1', '+ line2']);
  });
});
