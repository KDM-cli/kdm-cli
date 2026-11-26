import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  renderTUI,
  MockClusterEnvironment,
  MockPythonCouncil,
  CodebaseInvestigatorAgent,
  DashboardWithTroubleshootTrigger,
  translateNDJSONToSubagentProgress,
} from '../harness';
import { getRunningPods } from '../../../kubernetes/pods';

describe('Tier 4: Scenario 1 — Incident Triage: OOMKilled Pod in Production', () => {
  let cluster: MockClusterEnvironment | null = null;

  afterEach(() => {
    if (cluster) {
      cluster.reset();
      cluster = null;
    }
    MockClusterEnvironment.resetActive();
    vi.restoreAllMocks();
  });

  it('executes complete 6-stage SRE triage workflow for OOMKilled payment-service pod', async () => {
    // Stage 1: Detection — SRE observes failing pod in cluster watch
    const podName = 'payment-service-8f4b-2x9p';
    const namespace = 'production';
    cluster = new MockClusterEnvironment().setOOMKilledScenario(podName, namespace).install();

    const activePods = await getRunningPods();
    const failingPod = activePods.find((p) => p.name === podName);

    expect(failingPod).toBeDefined();
    expect(failingPod?.status).toBe('OOMKilled');
    expect(failingPod?.restarts).toBe(5);

    // Stage 2: Trigger — SRE initiates troubleshooting workflow via 't' keyboard shortcut on dashboard
    let triggeredPod = '';
    const { sendKey, wait, unmount, getLastFrame } = renderTUI(
      React.createElement(DashboardWithTroubleshootTrigger, {
        dashboardType: 'watch',
        targetResource: failingPod!.name,
        onTrigger: (res: string) => {
          triggeredPod = res;
        },
      })
    );

    expect(getLastFrame()).toContain(`Selected Resource: ${podName}`);
    sendKey('t');
    await wait(50);

    expect(getLastFrame()).toContain(`AI Troubleshooting Session: ${podName}`);
    expect(triggeredPod).toBe(podName);
    unmount();

    // Stage 3: Specialist Council Dispatch — NDJSON streaming from Python bridge
    const councilEvents = MockPythonCouncil.createOOMKilledCouncilEvents(podName, namespace);
    const proc = MockPythonCouncil.createMockProcess(councilEvents);

    const rawStreamEvents: any[] = [];
    const translatedProgress: any[] = [];
    await new Promise<void>((resolve, reject) => {
      proc.on('error', reject);
      proc.stdout.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().trim().split('\n');
        for (const line of lines) {
          if (!line) continue;
          const parsed = JSON.parse(line);
          rawStreamEvents.push(parsed);
          const prog = translateNDJSONToSubagentProgress(parsed);
          if (prog) translatedProgress.push(prog);
        }
      });
      proc.on('close', () => resolve());
    });

    expect(translatedProgress.length).toBeGreaterThan(0);

    // Stage 4: Codebase Investigation — Dynamic JVM heap vs cgroup memory limit correlation
    const workspaceFiles = {
      'charts/payment-service/values.yaml':
        'resources:\n  limits:\n    memory: 512Mi\nenv:\n  JAVA_OPTS: "-Xmx768m"\n',
    };

    const codebaseReport = await CodebaseInvestigatorAgent.run({
      workspaceFiles,
      liveClusterState: { memoryLimit: '512Mi', podName },
    });

    expect(codebaseReport.driftDetected).toBe(true);
    expect(codebaseReport.findings[0].issue).toContain('-Xmx768m');
    expect(codebaseReport.findings[0].issue).toContain('512Mi');

    // Dynamic contrast verification: a healthy container limit (2048Mi) produces NO drift
    const healthyCheck = await CodebaseInvestigatorAgent.run({
      workspaceFiles,
      liveClusterState: { memoryLimit: '2048Mi', podName },
    });
    expect(healthyCheck.driftDetected).toBe(false);

    // Stage 5: Consensus Synthesis — Root cause correlation from LIVE streaming output
    const synthProgress = translatedProgress.find(
      (p) => p.agentName === 'SynthesizerAgent' && p.state === 'completed'
    );
    expect(synthProgress).toBeDefined();
    expect(synthProgress?.result).toContain('misaligned JVM heap (-Xmx768m)');

    const diagnosisEvent = rawStreamEvents.find((e) => e.event === 'diagnosis_ready');
    expect(diagnosisEvent).toBeDefined();
    expect(diagnosisEvent.consensus.confidence).toBe('high');
    expect(diagnosisEvent.consensus.rootCause).toContain('misaligned JVM heap (-Xmx768m)');
    expect(diagnosisEvent.consensus.bestSolution.actionTitle).toContain('Align JVM heap');

    // Stage 6: Remediation Proposal — Verified unified diff patch dynamically generated
    const patch = codebaseReport.findings[0].patch;
    expect(patch).toBeDefined();
    expect(patch).toContain('memory: 512Mi');
    expect(patch).toContain('memory: 1024Mi');
  });
});
