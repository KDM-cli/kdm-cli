/**
 * Bidirectional Event Translator — KDM v4.0.0
 * ============================================
 * Translates bidirectionally between KDM's Python Council NDJSON event stream
 * and gemini-cli's AgentEvent / SubagentProgress protocol.
 *
 * Enforces:
 * - Robust parsing of chunked stdout streams with line buffering.
 * - Silent fail-safe handling of corrupt, partial, or non-JSON log lines.
 * - Complete compliance with PROJECT.md § Interface Contracts.
 */

import { parseNDJSONLine } from './event-schema.js';
import type {
  NDJSONEvent,
  SubagentProgress,
  AgentEvent,
  ConsensusDiagnosis,
} from './types.js';

/** Returns current UTC ISO-8601 timestamp with 'Z' suffix. */
function utcIso(): string {
  return new Date().toISOString();
}

/**
 * Translates a single KDM Python Council NDJSON event into a SubagentProgress object.
 * Conforms to PROJECT.md § Interface Contracts.
 *
 * @param event Parsed NDJSONEvent object or raw line string.
 * @returns SubagentProgress object or null if event is non-subagent or unparseable.
 */
export function translateNDJSONToSubagentProgress(event: any): SubagentProgress | null {
  if (!event) return null;

  let resolvedEvent: any = event;
  if (typeof event === 'string') {
    resolvedEvent = parseNDJSONLine(event);
    if (!resolvedEvent) {
      try {
        resolvedEvent = JSON.parse(event.trim());
      } catch {
        return null;
      }
    }
  }

  if (typeof resolvedEvent !== 'object' || resolvedEvent === null) {
    return null;
  }

  // Handle standard Phase 11 NDJSON events
  if ('event' in resolvedEvent && typeof resolvedEvent.event === 'string') {
    switch (resolvedEvent.event) {
      case 'agent_start':
        return {
          agentName: resolvedEvent.role,
          state: 'running',
          thought: resolvedEvent.message,
        };

      case 'agent_tool_call':
        return {
          agentName: resolvedEvent.role,
          state: 'running',
          toolCall: {
            name: resolvedEvent.tool,
            args:
              resolvedEvent.args &&
              typeof resolvedEvent.args === 'object' &&
              !Array.isArray(resolvedEvent.args)
                ? resolvedEvent.args
                : {},
            status: 'running',
          },
        };

      case 'agent_tool_result':
        return {
          agentName: resolvedEvent.role,
          state: 'running',
          toolCall: {
            name: resolvedEvent.tool,
            args: {},
            status: 'success',
            output: `completed in ${resolvedEvent.durationMs}ms`,
          },
        };

      case 'agent_progress':
        return {
          agentName: resolvedEvent.role,
          state: 'running',
          thought: resolvedEvent.message,
        };

      case 'agent_complete':
        return {
          agentName: resolvedEvent.role,
          state: 'completed',
          result: resolvedEvent.summary,
        };

      case 'agent_failed':
        return {
          agentName: resolvedEvent.role,
          state: 'error',
          result: resolvedEvent.error,
        };

      case 'diagnosis_ready':
        return {
          agentName: 'SynthesizerAgent',
          state: 'completed',
          result: resolvedEvent.consensus?.rootCause ?? 'Consensus diagnosis formulated',
        };

      case 'analysis_start':
      case 'evidence_collected':
      case 'rule_matched':
        return null;

      case 'error':
        return resolvedEvent.fatal
          ? {
              agentName: 'council',
              state: 'error',
              result: resolvedEvent.message,
            }
          : null;

      default:
        return null;
    }
  }

  // Handle backward-compatible legacy Python council events (type: progress / agent_completed / complete)
  if ('type' in resolvedEvent && typeof resolvedEvent.type === 'string') {
    switch (resolvedEvent.type) {
      case 'progress':
        return {
          agentName: String(resolvedEvent.agent || resolvedEvent.role || 'council'),
          state: 'running',
          thought: String(resolvedEvent.message || ''),
        };

      case 'agent_completed': {
        const finding = resolvedEvent.finding || {};
        return {
          agentName: String(resolvedEvent.agent || finding.role || 'council'),
          state: 'completed',
          result: String(finding.summary || `${resolvedEvent.agent} finished inspection`),
        };
      }

      case 'complete':
        return {
          agentName: 'SynthesizerAgent',
          state: 'completed',
          result: resolvedEvent.consensus?.rootCause ?? 'Consensus complete',
        };

      case 'error':
        return {
          agentName: 'council',
          state: 'error',
          result: String(resolvedEvent.message || 'Unknown error'),
        };

      default:
        return null;
    }
  }

  return null;
}

/**
 * Translates a KDM NDJSON event into a gemini-cli AgentEvent.
 */
export function translateNDJSONToAgentEvent(event: any): AgentEvent | null {
  const progress = translateNDJSONToSubagentProgress(event);
  if (!progress) return null;

  const timestamp = event?.timestamp || utcIso();

  if (progress.toolCall) {
    if (progress.toolCall.status === 'running') {
      return {
        agentName: progress.agentName,
        type: 'tool_call',
        timestamp,
        payload: {
          tool: progress.toolCall.name,
          args: progress.toolCall.args,
        },
      };
    }
    return {
      agentName: progress.agentName,
      type: 'tool_result',
      timestamp,
      payload: {
        tool: progress.toolCall.name,
        output: progress.toolCall.output,
      },
    };
  }

  if (progress.state === 'running') {
    if (event?.event === 'agent_start') {
      return {
        agentName: progress.agentName,
        type: 'agent_start',
        timestamp,
        payload: { message: progress.thought },
      };
    }
    return {
      agentName: progress.agentName,
      type: 'thought',
      timestamp,
      payload: { thought: progress.thought },
    };
  }

  if (progress.state === 'completed') {
    if (event?.event === 'diagnosis_ready') {
      return {
        agentName: progress.agentName,
        type: 'diagnosis_ready',
        timestamp,
        payload: {
          consensus: event.consensus,
          result: progress.result,
        },
      };
    }
    return {
      agentName: progress.agentName,
      type: 'agent_complete',
      timestamp,
      payload: {
        summary: progress.result,
        result: progress.result,
      },
    };
  }

  if (progress.state === 'error') {
    return {
      agentName: progress.agentName,
      type: 'agent_error',
      timestamp,
      payload: { error: progress.result },
    };
  }

  if (progress.state === 'cancelled') {
    return {
      agentName: progress.agentName,
      type: 'agent_cancelled',
      timestamp,
      payload: { message: progress.result },
    };
  }

  return null;
}

/**
 * Translates a gemini-cli AgentEvent into a KDM NDJSONEvent.
 */
export function translateAgentEventToNDJSON(agentEvent: AgentEvent): NDJSONEvent | null {
  if (!agentEvent || !agentEvent.type) return null;
  const timestamp = agentEvent.timestamp || utcIso();

  switch (agentEvent.type) {
    case 'agent_start':
      return {
        event: 'agent_start',
        role: agentEvent.agentName as any,
        message: agentEvent.payload.message || `Agent ${agentEvent.agentName} started`,
        timestamp,
      };

    case 'thought':
      return {
        event: 'agent_progress',
        role: agentEvent.agentName,
        message: agentEvent.payload.thought || '',
        timestamp,
      };

    case 'tool_call':
      return {
        event: 'agent_tool_call',
        role: agentEvent.agentName,
        tool: agentEvent.payload.tool || 'unknown_tool',
        args: agentEvent.payload.args || {},
        timestamp,
      };

    case 'tool_result':
      return {
        event: 'agent_tool_result',
        role: agentEvent.agentName,
        tool: agentEvent.payload.tool || 'unknown_tool',
        durationMs: agentEvent.payload.durationMs ?? 0,
        timestamp,
      };

    case 'agent_complete':
      return {
        event: 'agent_complete',
        role: agentEvent.agentName,
        summary:
          agentEvent.payload.summary ||
          agentEvent.payload.result ||
          `Agent ${agentEvent.agentName} completed`,
        timestamp,
      };

    case 'agent_error':
      return {
        event: 'agent_failed',
        role: agentEvent.agentName,
        error: agentEvent.payload.error || 'Agent failed',
        timestamp,
      };

    case 'diagnosis_ready':
      return {
        event: 'diagnosis_ready',
        consensus: agentEvent.payload.consensus as ConsensusDiagnosis,
        timestamp,
      };

    default:
      return null;
  }
}

/**
 * Translates SubagentProgress into a corresponding KDM NDJSONEvent.
 */
export function translateSubagentProgressToNDJSON(progress: SubagentProgress): NDJSONEvent | null {
  if (!progress) return null;
  const timestamp = utcIso();

  if (progress.toolCall) {
    if (progress.toolCall.status === 'running') {
      return {
        event: 'agent_tool_call',
        role: progress.agentName,
        tool: progress.toolCall.name,
        args: progress.toolCall.args,
        timestamp,
      };
    }
    return {
      event: 'agent_tool_result',
      role: progress.agentName,
      tool: progress.toolCall.name,
      durationMs: 0,
      timestamp,
    };
  }

  if (progress.state === 'running') {
    return {
      event: 'agent_progress',
      role: progress.agentName,
      message: progress.thought || '',
      timestamp,
    };
  }

  if (progress.state === 'completed') {
    return {
      event: 'agent_complete',
      role: progress.agentName,
      summary: progress.result || 'Completed',
      timestamp,
    };
  }

  if (progress.state === 'error') {
    return {
      event: 'agent_failed',
      role: progress.agentName,
      error: progress.result || 'Failed',
      timestamp,
    };
  }

  return null;
}

/**
 * Stateful stream event translator handling chunk boundaries, line reassembly,
 * and bidirectional conversion between NDJSON and SubagentProgress.
 */
export class EventTranslator {
  private buffer = '';

  /**
   * Ingests a raw stdout or network chunk, reassembles lines split across chunk boundaries,
   * parses complete lines, and yields translated SubagentProgress items.
   *
   * @param chunk Raw string or Buffer chunk.
   * @returns Array of translated SubagentProgress objects.
   */
  public pushChunk(chunk: string | Buffer): SubagentProgress[] {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    this.buffer += text;

    const lines = this.buffer.split(/\r?\n/);
    // Keep incomplete trailing fragment in buffer
    this.buffer = lines.pop() || '';

    const results: SubagentProgress[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const progress = this.translateLine(trimmed);
      if (progress) {
        results.push(progress);
      }
    }
    return results;
  }

  /**
   * Flushes and processes any remaining line in buffer when stream ends.
   */
  public flush(): SubagentProgress[] {
    const remaining = this.buffer.trim();
    this.buffer = '';
    if (!remaining) return [];
    const progress = this.translateLine(remaining);
    return progress ? [progress] : [];
  }

  /**
   * Translates a single line string to SubagentProgress, returning null on corrupt/invalid input.
   */
  public translateLine(line: string): SubagentProgress | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const ndjson = parseNDJSONLine(trimmed);
    if (ndjson) {
      return translateNDJSONToSubagentProgress(ndjson);
    }

    try {
      const raw = JSON.parse(trimmed);
      return translateNDJSONToSubagentProgress(raw);
    } catch {
      return null;
    }
  }

  /**
   * Serializes an event or SubagentProgress into a single NDJSON line with trailing newline.
   */
  public static serializeNDJSON(event: NDJSONEvent | AgentEvent | SubagentProgress): string {
    let ndjson: NDJSONEvent | null = null;
    if ('event' in event && typeof (event as any).event === 'string') {
      ndjson = event as NDJSONEvent;
    } else if ('type' in event && typeof (event as any).type === 'string') {
      ndjson = translateAgentEventToNDJSON(event as AgentEvent);
    } else if ('state' in event && typeof (event as any).state === 'string') {
      ndjson = translateSubagentProgressToNDJSON(event as SubagentProgress);
    }

    if (!ndjson) {
      return '';
    }

    return JSON.stringify(ndjson) + '\n';
  }
}
