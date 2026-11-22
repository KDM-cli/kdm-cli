import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  MockPythonCouncil,
  translateNDJSONToSubagentProgress,
} from '../harness';

describe('Tier 4: Scenario 5 — Multi-Agent Synthesis: Cross-Module Root Cause Analysis', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('correlates multi-agent evidence across ingress, cgroups, and liveness probes to diagnose cascading 502 failure', async () => {
    // 1. Generate realistic multi-agent cascading failure sequence
    const events = MockPythonCouncil.createCascadingFailureCouncilEvents();
    const proc = MockPythonCouncil.createMockProcess(events);

    const agentActivity: Record<string, string[]> = {};
    let finalConsensus: any = null;

    await new Promise<void>((resolve, reject) => {
      proc.on('error', reject);
      proc.stdout.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().trim().split('\n');
        for (const line of lines) {
          if (!line) continue;
          const parsed = JSON.parse(line);
          const prog = translateNDJSONToSubagentProgress(parsed);
          if (prog) {
            if (!agentActivity[prog.agentName]) agentActivity[prog.agentName] = [];
            if (prog.thought) agentActivity[prog.agentName].push(prog.thought);
            if (prog.result) agentActivity[prog.agentName].push(prog.result);
          }
          if (parsed.event === 'diagnosis_ready') {
            finalConsensus = parsed.consensus;
          }
        }
      });
      proc.on('close', () => resolve());
    });

    // 2. Verify all 3 specialist agents contributed findings
    expect(agentActivity['runtime']).toBeDefined();
    expect(agentActivity['resource']).toBeDefined();
    expect(agentActivity['config']).toBeDefined();

    // 3. Verify consensus diagnosis correlates all three tiers into root cause
    expect(finalConsensus).not.toBeNull();
    expect(finalConsensus.confidence).toBe('high');
    expect(finalConsensus.rootCause).toContain('Cascading failure');
    expect(finalConsensus.rootCause).toContain('CPU throttling');
    expect(finalConsensus.rootCause).toContain('liveness probe timeout');
    expect(finalConsensus.rootCause).toContain('502 Bad Gateway');

    // 4. Verify remediation plan fixes both probe timeout and CPU limits
    expect(finalConsensus.bestSolution.steps).toContain('Increase liveness probe timeoutSeconds to 5');
    expect(finalConsensus.bestSolution.steps).toContain('Increase CPU limit to 1500m');
    expect(finalConsensus.bestSolution.commandToRun).toContain('resources":{"limits":{"cpu":"1500m"}}');
  });
});
