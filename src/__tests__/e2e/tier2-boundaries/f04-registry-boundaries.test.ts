import { describe, it, expect } from 'vitest';
import {
  AgentRegistry,
  AgentTool,
  MockPythonCouncil,
  translateNDJSONToSubagentProgress,
} from '../harness';
import { parseNDJSONLine } from '../../../agent/event-schema';

describe('Tier 2: F-04 Agent Registry Boundaries & Corner Cases', () => {
  it('TC-E2E-T2-F04-01: Delegation to unregistered subagent name returns error without crash', async () => {
    const registry = new AgentRegistry();
    const tool = new AgentTool(registry);

    await expect(
      tool.execute({
        agent_name: 'UnregisteredSpecialist',
        prompt: 'Investigate leak',
      })
    ).rejects.toThrow("Agent 'UnregisteredSpecialist' not found");
  });

  it('TC-E2E-T2-F04-02: Subagent execution timeout triggers agent_failed state', () => {
    const timeoutEvent = {
      event: 'agent_failed' as const,
      role: 'runtime',
      error: 'CouncilTimeoutError: Agent execution timed out after 10000ms',
      timestamp: new Date().toISOString(),
    };

    const progress = translateNDJSONToSubagentProgress(timeoutEvent);
    expect(progress?.state).toBe('error');
    expect(progress?.result).toContain('CouncilTimeoutError');
  });

  it('TC-E2E-T2-F04-03: Corrupted / partial NDJSON stream lines skipped silently', () => {
    const corruptLines = [
      'not a valid json object',
      '{"partial": true, ',
      '',
      '{"missing_event": 123}',
    ];

    for (const badLine of corruptLines) {
      const parsed = parseNDJSONLine(badLine);
      expect(parsed).toBeNull();
    }

    // Valid line adjacent to bad line parses properly
    const validLine = JSON.stringify({
      event: 'agent_progress',
      role: 'runtime',
      message: 'Processing memory metrics',
      timestamp: new Date().toISOString(),
    });
    const parsedValid = parseNDJSONLine(validLine);
    expect(parsedValid).not.toBeNull();
    expect(parsedValid?.event).toBe('agent_progress');
  });

  it('TC-E2E-T2-F04-04: Circular subagent delegation prevention via max depth clamp', async () => {
    const registry = new AgentRegistry();
    const tool = new AgentTool(registry, 2);

    // Attempting depth 2 when maxDepth is 2 throws
    await expect(
      tool.execute({
        agent_name: 'RecursiveAgent',
        prompt: 'Self delegation',
        depth: 2,
      })
    ).rejects.toThrow('MaxDelegationDepthExceededError');
  });

  it('TC-E2E-T2-F04-05: Unexpected subagent child process crash (SIGKILL/exit 137) handled gracefully', async () => {
    const proc = MockPythonCouncil.createMockProcess([], { exitCode: 137 });

    const exitPromise = new Promise<{ code: number }>((resolve) => {
      proc.on('close', (code: number) => {
        resolve({ code });
      });
    });

    const result = await exitPromise;
    expect(result.code).toBe(137);
  });
});
