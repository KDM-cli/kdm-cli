import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import {
  renderTUI,
  DiffRenderer,
  ToolConfirmationQueueView,
  evaluateSafetyPolicy,
  type ConfirmationRequest,
} from '../harness';

describe('Tier 1: F-07 Manifest Diff & Confirmation Queue', () => {
  it('TC-E2E-T1-F07-01: Unified color-coded diff rendering (DiffRenderer with line numbers)', () => {
    const sampleDiff =
      '--- deployment.yaml\n+++ deployment.yaml.patched\n@@ -10,4 +10,4 @@\n-      memory: 512Mi\n+      memory: 1024Mi\n';

    const { getCleanOutput, unmount } = renderTUI(<DiffRenderer diff={sampleDiff} />);
    const output = getCleanOutput();

    expect(output).toContain('Manifest Unified Diff');
    expect(output).toContain('-      memory: 512Mi');
    expect(output).toContain('+      memory: 1024Mi');
    expect(output).toContain('@@ -10,4 +10,4 @@');
    unmount();
  });

  it('TC-E2E-T1-F07-02: Confirmation queue item display with risk badge (LOW, MEDIUM, HIGH)', () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-001',
      toolName: 'k8s_apply_patch',
      args: { command: 'kubectl apply -f patch.yaml' },
      riskLevel: 'high',
      prompt: 'Apply memory limit patch (512Mi -> 1024Mi) to payment-service deployment?',
    };

    const onDecision = vi.fn();
    const { getCleanOutput, unmount } = renderTUI(
      <ToolConfirmationQueueView request={request} onDecision={onDecision} />
    );

    const output = getCleanOutput();
    expect(output).toContain('[HIGH RISK ACTION REQUIRED]');
    expect(output).toContain('conf-req-001');
    expect(output).toContain('Apply memory limit patch');
    unmount();
  });

  it('TC-E2E-T1-F07-03: Interactive human approval flow ("y" keypress -> ALLOW)', async () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-002',
      toolName: 'k8s_apply_patch',
      args: { command: 'kubectl apply -f patch.yaml' },
      riskLevel: 'medium',
      prompt: 'Approve patch rollout?',
    };

    let decisionMade: string | null = null;
    const { sendKey, wait, unmount } = renderTUI(
      <ToolConfirmationQueueView
        request={request}
        onDecision={(d) => {
          decisionMade = d;
        }}
      />
    );

    // Keystroke 'y' is processed by useInput in ToolConfirmationQueueView
    sendKey('y');
    await wait(50);

    expect(decisionMade).toBe('ALLOW');
    unmount();
  });

  it('TC-E2E-T1-F07-04: Interactive human denial flow ("n" keypress -> DENY)', async () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-003',
      toolName: 'docker_restart_container',
      args: { command: 'docker rm -f postgres-local' },
      riskLevel: 'high',
      prompt: 'Delete and recreate database container?',
    };

    let decisionMade: string | null = null;
    const { sendKey, wait, unmount } = renderTUI(
      <ToolConfirmationQueueView
        request={request}
        onDecision={(d) => {
          decisionMade = d;
        }}
      />
    );

    // Keystroke 'n' is processed by useInput in ToolConfirmationQueueView
    sendKey('n');
    await wait(50);

    expect(decisionMade).toBe('DENY');
    unmount();
  });

  it('TC-E2E-T1-F07-05: Destructive command policy auto-block (e.g. rm -rf /, kubectl delete ns)', () => {
    const destructiveCommand = 'rm -rf /';
    const policyResult = evaluateSafetyPolicy(destructiveCommand);
    expect(policyResult.allowed).toBe(false);
    expect(policyResult.violation).toContain('Destructive command permanently blocked');

    const k8sDestructive = 'kubectl delete namespace production';
    const k8sPolicyResult = evaluateSafetyPolicy(k8sDestructive);
    expect(k8sPolicyResult.allowed).toBe(false);

    // Verify rendering of blocked policy
    const request: ConfirmationRequest = {
      id: 'conf-req-blocked',
      toolName: 'shell_exec',
      args: { command: destructiveCommand },
      riskLevel: 'high',
      prompt: 'Wipe cluster filesystem',
    };

    const { getCleanOutput, unmount } = renderTUI(
      <ToolConfirmationQueueView request={request} onDecision={() => {}} />
    );

    const output = getCleanOutput();
    expect(output).toContain('POLICY VIOLATION');
    expect(output).toContain('permanently blocked');
    unmount();
  });
});
