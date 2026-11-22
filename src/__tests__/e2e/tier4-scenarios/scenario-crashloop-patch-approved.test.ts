import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  renderTUI,
  MockClusterEnvironment,
  CodebaseInvestigatorAgent,
  ToolConfirmationQueueView,
  type ConfirmationRequest,
  type ConfirmationDecision,
} from '../harness';
import { executeRemediationCommand, RemediationAuditTrail } from '../../../remediation/executor';

describe('Tier 4: Scenario 2 — Incident Triage: CrashLoopBackOff Pod Remediation with Approved Manifest Patch', () => {
  let cluster: MockClusterEnvironment | null = null;

  afterEach(() => {
    if (cluster) {
      cluster.reset();
      cluster = null;
    }
    MockClusterEnvironment.resetActive();
    vi.restoreAllMocks();
  });

  it('executes full automated remediation cycle: triage -> diff -> approval -> execution -> audit', async () => {
    // 1. Setup cluster state with CrashLoopBackOff pod
    const podName = 'auth-api-v2-7c91';
    const namespace = 'auth';
    cluster = new MockClusterEnvironment().setCrashLoopBackOffScenario(podName, namespace).install();

    // 2. Codebase investigation identifies secret key mismatch and generates patch
    const workspaceFiles = {
      'k8s/auth/deployment.yaml': `
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: auth-server
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: auth-secrets
              key: db-url
`,
    };

    const investigation = await CodebaseInvestigatorAgent.run({
      workspaceFiles,
      liveClusterState: { podName },
    });

    expect(investigation.driftDetected).toBe(true);
    expect(investigation.findings[0].issue).toContain('db-url');
    expect(investigation.findings[0].patch).toBeDefined();

    // 3. ToolConfirmationQueue gates action with [MEDIUM RISK]
    const confirmationRequest: ConfirmationRequest = {
      id: 'conf-auth-001',
      toolName: 'k8s_apply_patch',
      args: {
        command: `kubectl apply -f k8s/auth/deployment.yaml`,
        diff: investigation.findings[0].patch,
      },
      riskLevel: 'medium',
      prompt: 'Apply secretKeyRef patch to auth-api-v2 deployment in namespace auth?',
      diff: investigation.findings[0].patch,
    };

    expect(confirmationRequest.riskLevel).toBe('medium');
    expect(confirmationRequest.diff).toContain('key: DATABASE_URL');

    // 4. Operator approves action with 'y' -> 'ALLOW' via interactive ToolConfirmationQueueView
    let userDecision: ConfirmationDecision | null = null;
    const { sendKey, wait, unmount, getLastFrame } = renderTUI(
      React.createElement(ToolConfirmationQueueView, {
        request: confirmationRequest,
        onDecision: (d: ConfirmationDecision) => {
          userDecision = d;
        },
      })
    );

    expect(getLastFrame()).toContain('MEDIUM RISK ACTION REQUIRED');
    expect(getLastFrame()).toContain('Apply secretKeyRef patch');

    sendKey('y');
    await wait(50);
    unmount();

    expect(userDecision).toBe('ALLOW');

    // 5. Remediation executor applies patch and logs audit trail if approved
    let result;
    const auditTrail = new RemediationAuditTrail();
    if (userDecision === 'ALLOW') {
      result = await executeRemediationCommand('echo "deployment.apps/auth-api-v2 configured"', {
        auditTrail,
      });
    }

    expect(result).toBeDefined();
    expect(result?.success).toBe(true);
    expect(result?.exitCode).toBe(0);
    expect(result?.stdout).toContain('deployment.apps/auth-api-v2 configured');

    // 6. Verify audit trail recording
    const auditRecords = auditTrail.getRecords();
    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0].success).toBe(true);
    expect(auditRecords[0].exitCode).toBe(0);
  });
});
