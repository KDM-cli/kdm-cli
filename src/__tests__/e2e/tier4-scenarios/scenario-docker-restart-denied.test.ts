import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  renderTUI,
  MockClusterEnvironment,
  MockGenAIStreamBuilder,
  ToolConfirmationQueueView,
  dockerInspectContainerTool,
  type ConfirmationRequest,
  type ConfirmationDecision,
} from '../harness';
import { executeRemediationCommand } from '../../../remediation/executor';

describe('Tier 4: Scenario 3 — Docker Container Restart Loop Investigation with Denied Remediation', () => {
  let cluster: MockClusterEnvironment | null = null;

  afterEach(() => {
    if (cluster) {
      cluster.reset();
      cluster = null;
    }
    MockClusterEnvironment.resetActive();
    vi.restoreAllMocks();
  });

  it('handles safety denial gracefully and generates non-destructive alternative recommendation', async () => {
    // 1. Setup Docker environment with restarting postgres-local container
    const containerName = 'postgres-local';
    cluster = new MockClusterEnvironment().setDockerRestartLoopScenario(containerName).install();

    // 2. Inspect container state using declarative Docker tool
    const inspection = await dockerInspectContainerTool.execute({ containerId: containerName });
    expect(inspection.containerId).toBe(containerName);
    expect(inspection.state).toBe('restarting');
    expect(inspection.exitCode).toBe(1);

    // 3. AI proposes destructive container deletion
    const destructiveProposal: ConfirmationRequest = {
      id: 'conf-docker-001',
      toolName: 'docker_remove_container',
      args: { command: `docker rm -f ${containerName}` },
      riskLevel: 'high',
      prompt: `Permanently delete and recreate container ${containerName}? (Data Loss Risk)`,
    };

    expect(destructiveProposal.riskLevel).toBe('high');
    expect(destructiveProposal.args.command).toContain('docker rm -f');

    // 4. Operator denies destructive action with 'n' -> 'DENY' via ToolConfirmationQueueView
    let operatorDecision: ConfirmationDecision | null = null;
    const { sendKey, wait, unmount, getLastFrame } = renderTUI(
      React.createElement(ToolConfirmationQueueView, {
        request: destructiveProposal,
        onDecision: (d: ConfirmationDecision) => {
          operatorDecision = d;
        },
      })
    );

    expect(getLastFrame()).toContain('HIGH RISK ACTION REQUIRED');
    expect(getLastFrame()).toContain('Permanently delete and recreate');

    sendKey('n');
    await wait(50);
    unmount();

    expect(operatorDecision).toBe('DENY');

    let executedDestructiveCommand = false;
    if (operatorDecision === 'ALLOW') {
      await executeRemediationCommand(destructiveProposal.args.command as string);
      executedDestructiveCommand = true;
    }
    expect(executedDestructiveCommand).toBe(false);

    // 5. Synthesizer receives denial notice and recommends non-destructive fix
    const builder = new MockGenAIStreamBuilder();
    builder.addText(
      'Destructive remediation denied. Non-destructive alternative: Remove the stale postmaster.pid lock file by running `docker exec postgres-local rm /var/lib/postgresql/data/postmaster.pid` or inspect volume mount.'
    );

    const mockClient = builder.createMockClient();
    const alternativeAdvice = await mockClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'User denied docker rm -f. Propose non-destructive fix.',
    });

    expect(alternativeAdvice.text).toContain('Non-destructive alternative');
    expect(alternativeAdvice.text).toContain('postmaster.pid');
  });
});
