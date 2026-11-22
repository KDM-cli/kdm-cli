import { describe, it, expect } from 'vitest';
import {
  translateNDJSONToSubagentProgress,
  translateNDJSONToAgentEvent,
  translateAgentEventToNDJSON,
  translateSubagentProgressToNDJSON,
  EventTranslator,
} from '../agent/event-translator.js';
import type { NDJSONEvent, SubagentProgress, AgentEvent } from '../agent/types.js';

describe('EventTranslator (F-04)', () => {
  const timestamp = '2026-11-15T12:00:00Z';

  it('TC-EVT-01: Translate agent_start to SubagentProgress', () => {
    const event: NDJSONEvent = {
      event: 'agent_start',
      role: 'runtime',
      message: 'Inspecting container exit codes...',
      timestamp,
    };

    const progress = translateNDJSONToSubagentProgress(event);
    expect(progress).toEqual({
      agentName: 'runtime',
      state: 'running',
      thought: 'Inspecting container exit codes...',
    });
  });

  it('TC-EVT-02: Translate agent_tool_call to SubagentProgress', () => {
    const event: NDJSONEvent = {
      event: 'agent_tool_call',
      role: 'config',
      tool: 'k8s_get_resources',
      args: { kind: 'configmap', namespace: 'prod' },
      timestamp,
    };

    const progress = translateNDJSONToSubagentProgress(event);
    expect(progress).toEqual({
      agentName: 'config',
      state: 'running',
      toolCall: {
        name: 'k8s_get_resources',
        args: { kind: 'configmap', namespace: 'prod' },
        status: 'running',
      },
    });
  });

  it('TC-EVT-03: Translate agent_tool_result to SubagentProgress', () => {
    const event: NDJSONEvent = {
      event: 'agent_tool_result',
      role: 'config',
      tool: 'k8s_get_resources',
      durationMs: 142,
      timestamp,
    };

    const progress = translateNDJSONToSubagentProgress(event);
    expect(progress).toEqual({
      agentName: 'config',
      state: 'running',
      toolCall: {
        name: 'k8s_get_resources',
        args: {},
        status: 'success',
        output: 'completed in 142ms',
      },
    });
  });

  it('TC-EVT-04: Translate agent_progress to SubagentProgress', () => {
    const event: NDJSONEvent = {
      event: 'agent_progress',
      role: 'resource',
      message: 'Evaluating cgroup v2 memory.current counters',
      timestamp,
    };

    const progress = translateNDJSONToSubagentProgress(event);
    expect(progress).toEqual({
      agentName: 'resource',
      state: 'running',
      thought: 'Evaluating cgroup v2 memory.current counters',
    });
  });

  it('TC-EVT-05: Translate agent_complete to SubagentProgress', () => {
    const event: NDJSONEvent = {
      event: 'agent_complete',
      role: 'runtime',
      summary: 'Container was OOMKilled with exit code 137',
      timestamp,
    };

    const progress = translateNDJSONToSubagentProgress(event);
    expect(progress).toEqual({
      agentName: 'runtime',
      state: 'completed',
      result: 'Container was OOMKilled with exit code 137',
    });
  });

  it('TC-EVT-06: Translate agent_failed to SubagentProgress', () => {
    const event: NDJSONEvent = {
      event: 'agent_failed',
      role: 'config',
      error: 'Secret not found: database-creds',
      timestamp,
    };

    const progress = translateNDJSONToSubagentProgress(event);
    expect(progress).toEqual({
      agentName: 'config',
      state: 'error',
      result: 'Secret not found: database-creds',
    });
  });

  it('TC-EVT-07: Translate diagnosis_ready to SubagentProgress with SynthesizerAgent', () => {
    const event: NDJSONEvent = {
      event: 'diagnosis_ready',
      timestamp,
      consensus: {
        rootCause: 'JVM -Xmx768m exceeded container 512Mi limit',
        confidence: 'high',
        findings: [],
        bestSolution: {
          actionTitle: 'Increase memory limit to 1024Mi',
          steps: ['kubectl set resources deployment/app --limits=memory=1024Mi'],
          riskLevel: 'low',
        },
      },
    };

    const progress = translateNDJSONToSubagentProgress(event);
    expect(progress).toEqual({
      agentName: 'SynthesizerAgent',
      state: 'completed',
      result: 'JVM -Xmx768m exceeded container 512Mi limit',
    });
  });

  it('TC-EVT-08: Non-agent lifecycle events return null', () => {
    expect(
      translateNDJSONToSubagentProgress({
        event: 'analysis_start',
        analysisId: 'ana-123',
        timestamp,
      })
    ).toBeNull();

    expect(
      translateNDJSONToSubagentProgress({
        event: 'evidence_collected',
        count: 5,
        ids: ['ev-1', 'ev-2'],
        timestamp,
      })
    ).toBeNull();

    expect(
      translateNDJSONToSubagentProgress({
        event: 'rule_matched',
        ruleId: 'R-01',
        title: 'OOMKilled Rule',
        timestamp,
      })
    ).toBeNull();

    // Non-fatal error returns null
    expect(
      translateNDJSONToSubagentProgress({
        event: 'error',
        message: 'minor warning',
        fatal: false,
        timestamp,
      })
    ).toBeNull();

    // Fatal error maps to council error
    expect(
      translateNDJSONToSubagentProgress({
        event: 'error',
        message: 'fatal crash',
        fatal: true,
        timestamp,
      })
    ).toEqual({
      agentName: 'council',
      state: 'error',
      result: 'fatal crash',
    });
  });

  it('TC-EVT-09: Malformed, corrupt, or invalid NDJSON input returns null safely', () => {
    expect(translateNDJSONToSubagentProgress(null)).toBeNull();
    expect(translateNDJSONToSubagentProgress(undefined)).toBeNull();
    expect(translateNDJSONToSubagentProgress('')).toBeNull();
    expect(translateNDJSONToSubagentProgress('   ')).toBeNull();
    expect(translateNDJSONToSubagentProgress('not json')).toBeNull();
    expect(translateNDJSONToSubagentProgress('{ corrupt: json')).toBeNull();
    expect(translateNDJSONToSubagentProgress(12345 as any)).toBeNull();
    expect(translateNDJSONToSubagentProgress({ unknown: 'field' } as any)).toBeNull();
  });

  it('TC-EVT-10: Legacy Python council event backward compatibility', () => {
    expect(
      translateNDJSONToSubagentProgress({
        type: 'progress',
        agent: 'RuntimeLogAgent',
        message: 'Processing stack traces...',
      })
    ).toEqual({
      agentName: 'RuntimeLogAgent',
      state: 'running',
      thought: 'Processing stack traces...',
    });

    expect(
      translateNDJSONToSubagentProgress({
        type: 'agent_completed',
        agent: 'ConfigDependencyAgent',
        finding: { summary: 'Missing configmap app-config' },
      })
    ).toEqual({
      agentName: 'ConfigDependencyAgent',
      state: 'completed',
      result: 'Missing configmap app-config',
    });

    expect(
      translateNDJSONToSubagentProgress({
        type: 'complete',
        consensus: { rootCause: 'OOMKill verified' },
      })
    ).toEqual({
      agentName: 'SynthesizerAgent',
      state: 'completed',
      result: 'OOMKill verified',
    });
  });

  it('TC-EVT-11: Bidirectional translation between NDJSONEvent and AgentEvent', () => {
    const ndjson: NDJSONEvent = {
      event: 'agent_tool_call',
      role: 'runtime',
      tool: 'docker_logs',
      args: { containerId: 'c123', tail: 50 },
      timestamp,
    };

    const agentEvent = translateNDJSONToAgentEvent(ndjson);
    expect(agentEvent).not.toBeNull();
    expect(agentEvent?.type).toBe('tool_call');
    expect(agentEvent?.agentName).toBe('runtime');
    expect(agentEvent?.payload.tool).toBe('docker_logs');
    expect(agentEvent?.payload.args).toEqual({ containerId: 'c123', tail: 50 });

    const backToNDJSON = translateAgentEventToNDJSON(agentEvent!);
    expect(backToNDJSON).toEqual({
      event: 'agent_tool_call',
      role: 'runtime',
      tool: 'docker_logs',
      args: { containerId: 'c123', tail: 50 },
      timestamp,
    });
  });

  it('TC-EVT-12: SubagentProgress translation back to NDJSON', () => {
    const progress: SubagentProgress = {
      agentName: 'resource',
      state: 'completed',
      result: 'Node memory is healthy',
    };

    const ndjson = translateSubagentProgressToNDJSON(progress);
    expect(ndjson).not.toBeNull();
    expect(ndjson?.event).toBe('agent_complete');
    expect((ndjson as any).role).toBe('resource');
    expect((ndjson as any).summary).toBe('Node memory is healthy');
  });

  it('TC-EVT-13: EventTranslator stateful chunk buffer and reassembly', () => {
    const translator = new EventTranslator();

    const line1 = JSON.stringify({
      event: 'agent_start',
      role: 'runtime',
      message: 'Started step 1',
      timestamp,
    });
    const line2 = JSON.stringify({
      event: 'agent_complete',
      role: 'runtime',
      summary: 'Completed step 1',
      timestamp,
    });

    // Split line1 into two chunks across arbitrary byte boundary
    const chunk1 = line1.slice(0, 20);
    const chunk2 = line1.slice(20) + '\n' + line2.slice(0, 25);
    const chunk3 = line2.slice(25) + '\n';

    const res1 = translator.pushChunk(chunk1);
    expect(res1).toHaveLength(0); // Incomplete line buffered

    const res2 = translator.pushChunk(chunk2);
    expect(res2).toHaveLength(1); // line1 complete!
    expect(res2[0].state).toBe('running');
    expect(res2[0].thought).toBe('Started step 1');

    const res3 = translator.pushChunk(chunk3);
    expect(res3).toHaveLength(1); // line2 complete!
    expect(res3[0].state).toBe('completed');
    expect(res3[0].result).toBe('Completed step 1');

    // Test flush with trailing fragment without newline
    const line3 = JSON.stringify({
      event: 'agent_progress',
      role: 'resource',
      message: 'Trailing item',
      timestamp,
    });
    translator.pushChunk(line3); // No trailing newline
    const flushed = translator.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].thought).toBe('Trailing item');
  });

  it('TC-EVT-14: EventTranslator.serializeNDJSON', () => {
    const serialized = EventTranslator.serializeNDJSON({
      event: 'agent_start',
      role: 'runtime',
      message: 'Starting inspection',
      timestamp,
    });

    expect(serialized.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(serialized.trim());
    expect(parsed.event).toBe('agent_start');
    expect(parsed.role).toBe('runtime');
  });
});
