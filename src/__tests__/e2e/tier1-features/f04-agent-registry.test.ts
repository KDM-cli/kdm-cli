import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  AgentRegistry,
  AgentTool,
  translateNDJSONToSubagentProgress,
  type AgentDefinition,
} from '../harness';
import type { NDJSONEvent } from '../../../agent/types';

describe('Tier 1: F-04 Subagent Registry & Invocation Protocol', () => {
  it('TC-E2E-T1-F04-01: Agent registration and capability retrieval in AgentRegistry', () => {
    const registry = new AgentRegistry();

    const runtimeAgent: AgentDefinition = {
      name: 'RuntimeLogAgent',
      description: 'Analyzes container exit codes, panic traces, and kernel OOM signals.',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ finding: z.string(), status: z.string() }),
      run: async (input) => ({ finding: `Analyzed logs for ${input.prompt}`, status: 'success' }),
    };

    const configAgent: AgentDefinition = {
      name: 'ConfigDependencyAgent',
      description: 'Validates Kubernetes ConfigMaps, Secrets, Volumes, and probe timeouts.',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ finding: z.string(), status: z.string() }),
      run: async (input) => ({ finding: `Verified configs for ${input.prompt}`, status: 'success' }),
    };

    registry.register(runtimeAgent);
    registry.register(configAgent);

    expect(registry.list()).toHaveLength(2);
    expect(registry.get('RuntimeLogAgent')?.name).toBe('RuntimeLogAgent');
    expect(registry.get('ConfigDependencyAgent')?.name).toBe('ConfigDependencyAgent');
    expect(registry.get('NonExistentAgent')).toBeUndefined();
  });

  it('TC-E2E-T1-F04-02: Orchestrator delegation via delegate_to_agent tool', async () => {
    const registry = new AgentRegistry();

    registry.register({
      name: 'RuntimeLogAgent',
      description: 'Specialist for runtime container diagnostics',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ rootCause: z.string(), confidence: z.string() }),
      run: async (input) => ({
        rootCause: `Diagnosed root cause for: ${input.prompt}`,
        confidence: 'high',
      }),
    });

    const agentTool = new AgentTool(registry);
    const result = await agentTool.execute({
      agent_name: 'RuntimeLogAgent',
      prompt: 'CrashLoopBackOff in auth-api',
    });

    expect(result.rootCause).toContain('CrashLoopBackOff in auth-api');
    expect(result.confidence).toBe('high');
  });

  it('TC-E2E-T1-F04-03: EventTranslator NDJSON to SubagentProgress event conversion', () => {
    const toolCallEvent: NDJSONEvent = {
      event: 'agent_tool_call',
      role: 'runtime',
      tool: 'k8s_get_logs',
      args: { pod: 'payment-service', tail: 50 },
      timestamp: '2026-11-15T12:00:00Z',
    };

    const progress = translateNDJSONToSubagentProgress(toolCallEvent);
    expect(progress).not.toBeNull();
    expect(progress?.agentName).toBe('runtime');
    expect(progress?.state).toBe('running');
    expect(progress?.toolCall?.name).toBe('k8s_get_logs');
    expect(progress?.toolCall?.args).toEqual({ pod: 'payment-service', tail: 50 });
  });

  it('TC-E2E-T1-F04-04: Subagent lifecycle state machine progression (pending -> running -> completed)', () => {
    const now = new Date().toISOString();

    const startEv: NDJSONEvent = {
      event: 'agent_start',
      role: 'resource',
      message: 'Checking node CPU limits...',
      timestamp: now,
    };
    const runningProgress = translateNDJSONToSubagentProgress(startEv);
    expect(runningProgress?.state).toBe('running');
    expect(runningProgress?.thought).toBe('Checking node CPU limits...');

    const completeEv: NDJSONEvent = {
      event: 'agent_complete',
      role: 'resource',
      summary: 'Node memory is healthy.',
      timestamp: now,
    };
    const completedProgress = translateNDJSONToSubagentProgress(completeEv);
    expect(completedProgress?.state).toBe('completed');
    expect(completedProgress?.result).toBe('Node memory is healthy.');
  });

  it('TC-E2E-T1-F04-05: Bidirectional event translation for diagnosis_ready consensus output', () => {
    const now = new Date().toISOString();
    const diagnosisEv: NDJSONEvent = {
      event: 'diagnosis_ready',
      timestamp: now,
      consensus: {
        rootCause: 'JVM heap -Xmx768m exceeded container 512Mi limit',
        confidence: 'high',
        findings: [],
        bestSolution: {
          actionTitle: 'Increase memory limit',
          steps: ['Patch deployment memory limit to 1024Mi'],
          riskLevel: 'low',
        },
      },
    };

    const progress = translateNDJSONToSubagentProgress(diagnosisEv);
    expect(progress).not.toBeNull();
    expect(progress?.agentName).toBe('SynthesizerAgent');
    expect(progress?.state).toBe('completed');
    expect(progress?.result).toContain('JVM heap -Xmx768m exceeded container 512Mi limit');
  });
});
