import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import {
  renderTUI,
  DiffRenderer,
  ToolConfirmationQueueView,
  type ConfirmationRequest,
  type ConfirmationDecision,
} from '../harness';

describe('Tier 2: F-07 Manifest Diff & Queue Boundaries & Corner Cases', () => {
  it('TC-E2E-T2-F07-01: Empty diff preview (no changes detected) displays clean notice', () => {
    const { getCleanOutput, unmount } = renderTUI(<DiffRenderer diff="" />);
    const output = getCleanOutput();
    expect(output).toContain('No configuration differences detected');
    unmount();
  });

  it('TC-E2E-T2-F07-02: Unrecognized keystrokes ignored; prompt stays active', async () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-unrec',
      toolName: 'k8s_apply_patch',
      args: { command: 'kubectl apply -f patch.yaml' },
      riskLevel: 'medium',
      prompt: 'Approve patch rollout?',
    };

    let decisionMade: ConfirmationDecision | null = null;
    const { sendKey, wait, getCleanOutput, unmount } = renderTUI(
      <ToolConfirmationQueueView
        request={request}
        onDecision={(d) => {
          decisionMade = d;
        }}
      />
    );

    // Send unrecognized keys
    sendKey('x');
    await wait(20);
    sendKey('1');
    await wait(20);
    sendKey(' ');
    await wait(20);

    expect(decisionMade).toBeNull(); // remains active and unconfirmed
    expect(getCleanOutput()).toContain('Approve patch rollout?');

    // Confirm that valid 'y' key continues to work afterwards
    sendKey('y');
    await wait(50);
    expect(decisionMade).toBe('ALLOW');
    unmount();
  });

  it('TC-E2E-T2-F07-03: SIGINT (Ctrl+C) during pending confirmation records ABORTED_BY_USER', async () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-abort',
      toolName: 'docker_restart_container',
      args: { command: 'docker restart pg' },
      riskLevel: 'high',
      prompt: 'Restart container?',
    };

    let decisionMade: ConfirmationDecision | null = null;
    let aborted = false;

    const { stdin, wait, unmount } = renderTUI(
      <ToolConfirmationQueueView
        request={request}
        onDecision={(d) => {
          decisionMade = d;
        }}
        onAbort={() => {
          aborted = true;
        }}
      />
    );

    stdin.sendCtrlC();
    await wait(50);

    expect(aborted).toBe(true);
    expect(decisionMade).toBe('DENY');
    unmount();
  });

  it('TC-E2E-T2-F07-04: Giant multi-file diff (>500 lines) truncated with line count note', () => {
    const lines = Array.from({ length: 600 }, (_, i) => `+ Line ${i + 1}`);
    const giantDiff = lines.join('\n');

    const { getCleanOutput, unmount } = renderTUI(<DiffRenderer diff={giantDiff} maxLines={30} />);
    const output = getCleanOutput();

    expect(output).toContain('... and 570 more lines');
    unmount();
  });

  it('TC-E2E-T2-F07-05: Remediation execution failure (non-zero exit from kubectl) captures stderr', async () => {
    // Tests real executeRemediationCommand failure handling
    const { executeRemediationCommand } = await import('../../../remediation/executor');

    const failingExec = vi.fn().mockRejectedValue({
      code: 1,
      stdout: '',
      stderr: 'Error from server (Conflict): Operation cannot be fulfilled on deployments.apps',
    });

    const result = await executeRemediationCommand('kubectl apply -f patch.yaml', {
      execFileFn: failingExec,
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Conflict');
    expect(failingExec).toHaveBeenCalledTimes(1);
  });
});
