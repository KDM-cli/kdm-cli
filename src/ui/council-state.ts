/**
 * Multi-Agent Council State Management & NDJSON Event Reducer
 * ===========================================================
 * Manages live terminal UI state for the 4 specialist SRE agents,
 * active tool invocations, and consensus diagnosis in React Ink.
 */

import type {
  AgentRole,
  AgentStatus,
  ConsensusDiagnosis,
  NDJSONEvent,
} from '../agent/types';

/**
 * State tracking for an individual specialist agent.
 */
export interface AgentState {
  role: AgentRole;
  name: string;
  icon: string;
  status: AgentStatus;
  message: string;
}

/**
 * State tracking for the currently executing diagnostic tool.
 */
export interface ActiveToolState {
  role: string;
  agentName: string;
  tool: string;
  args: Record<string, unknown>;
  durationMs?: number;
  status: 'running' | 'completed';
}

/**
 * Aggregated live state of the multi-agent council triaging session.
 */
export interface CouncilDashboardState {
  agents: Record<AgentRole, AgentState>;
  activeTool: ActiveToolState | null;
  consensus: ConsensusDiagnosis | null;
  analysisId?: string;
  ruleMatched?: { ruleId: string; title: string };
  error?: string | null;
  isLive: boolean;
}

/**
 * Display metadata and default tasks for each agent role.
 */
export const AGENT_ROLE_MAP: Record<
  AgentRole,
  { name: string; icon: string; defaultMessage: string }
> = {
  runtime: {
    name: 'Runtime Agent',
    icon: '🔍',
    defaultMessage: 'Waiting to inspect container logs & exit codes...',
  },
  config: {
    name: 'Config Agent',
    icon: '⚙️',
    defaultMessage: 'Checking pod memory limits and container spec...',
  },
  resource: {
    name: 'Resource Agent',
    icon: '🛡️',
    defaultMessage: 'Waiting for node capacity evaluation...',
  },
  synthesizer: {
    name: 'Lead SRE',
    icon: '🎯',
    defaultMessage: 'Waiting to synthesize findings...',
  },
};

const ROLE_PATTERNS: Array<[RegExp, AgentRole]> = [
  [/runtime|log/i, 'runtime'],
  [/config|depend/i, 'config'],
  [/resource|cluster/i, 'resource'],
  [/synthes|lead|sre|investigat/i, 'synthesizer'],
];

/**
 * Normalizes an arbitrary role string to a canonical AgentRole.
 */
export function normalizeCouncilRole(role?: string): AgentRole | null {
  if (!role) return null;
  const match = ROLE_PATTERNS.find(([pattern]) => pattern.test(role));
  return match ? match[1] : null;
}

/**
 * Returns human-readable agent name for a given role.
 */
export function getAgentDisplayName(role: string): string {
  const normalized = normalizeCouncilRole(role);
  return normalized ? AGENT_ROLE_MAP[normalized].name : role;
}

/**
 * Returns the icon emoji for a given agent role.
 */
export function getAgentIcon(role: string): string {
  const normalized = normalizeCouncilRole(role);
  return normalized ? AGENT_ROLE_MAP[normalized].icon : '🤖';
}

function formatPrimitiveArg(val: unknown): string {
  return typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val);
}

/**
 * Formats tool call arguments into a concise terminal string.
 */
export function formatToolArgs(args?: Record<string, unknown>): string {
  if (!args) return '';
  const entries = Object.entries(args);
  if (!entries.length) return '';
  if (entries.length === 1) {
    return formatPrimitiveArg(entries[0][1]);
  }
  return entries
    .map(([key, val]) => `${key}=${formatPrimitiveArg(val)}`)
    .join(', ');
}

/**
 * Formats a tool call and its arguments as `tool_name(args)`.
 */
export function formatToolInvocation(tool: string, args?: Record<string, unknown>): string {
  return `${tool}(${formatToolArgs(args)})`;
}

/**
 * Creates the initial pending state for all 4 council agents.
 */
export function createInitialCouncilState(): CouncilDashboardState {
  return {
    agents: {
      runtime: {
        role: 'runtime',
        name: AGENT_ROLE_MAP.runtime.name,
        icon: AGENT_ROLE_MAP.runtime.icon,
        status: 'pending',
        message: AGENT_ROLE_MAP.runtime.defaultMessage,
      },
      config: {
        role: 'config',
        name: AGENT_ROLE_MAP.config.name,
        icon: AGENT_ROLE_MAP.config.icon,
        status: 'pending',
        message: AGENT_ROLE_MAP.config.defaultMessage,
      },
      resource: {
        role: 'resource',
        name: AGENT_ROLE_MAP.resource.name,
        icon: AGENT_ROLE_MAP.resource.icon,
        status: 'pending',
        message: AGENT_ROLE_MAP.resource.defaultMessage,
      },
      synthesizer: {
        role: 'synthesizer',
        name: AGENT_ROLE_MAP.synthesizer.name,
        icon: AGENT_ROLE_MAP.synthesizer.icon,
        status: 'pending',
        message: AGENT_ROLE_MAP.synthesizer.defaultMessage,
      },
    },
    activeTool: null,
    consensus: null,
    error: null,
    isLive: false,
  };
}

// ─── Pure Event Reducer Handlers ─────────────────────────────────────────────

interface AgentStatusUpdate {
  role: string;
  status: AgentStatus;
  message: string;
  clearTool?: boolean;
}

function updateAgentStatus(
  state: CouncilDashboardState,
  update: AgentStatusUpdate
): CouncilDashboardState {
  const role = normalizeCouncilRole(update.role);
  if (!role) return state;

  const current = state.agents[role];
  const shouldClearTool = update.clearTool && state.activeTool?.role === update.role;

  return {
    ...state,
    isLive: true,
    activeTool: shouldClearTool ? null : state.activeTool,
    agents: {
      ...state.agents,
      [role]: {
        ...current,
        status: update.status,
        message: update.message,
      },
    },
  };
}

function handleAnalysisStart(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'analysis_start' }>
): CouncilDashboardState {
  return {
    ...state,
    analysisId: event.analysisId,
    isLive: true,
    error: null,
  };
}

function handleAgentStart(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'agent_start' }>
): CouncilDashboardState {
  return updateAgentStatus(state, {
    role: event.role,
    status: 'running',
    message: event.message,
  });
}

function handleAgentToolCall(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'agent_tool_call' }>
): CouncilDashboardState {
  const role = normalizeCouncilRole(event.role);
  const agentName = role ? AGENT_ROLE_MAP[role].name : event.role;

  return {
    ...state,
    isLive: true,
    activeTool: {
      role: event.role,
      agentName,
      tool: event.tool,
      args: event.args,
      status: 'running',
    },
  };
}

function handleAgentToolResult(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'agent_tool_result' }>
): CouncilDashboardState {
  if (!state.activeTool || state.activeTool.tool !== event.tool) {
    return state;
  }

  return {
    ...state,
    activeTool: {
      ...state.activeTool,
      durationMs: event.durationMs,
      status: 'completed',
    },
  };
}

function handleAgentProgress(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'agent_progress' }>
): CouncilDashboardState {
  return updateAgentStatus(state, {
    role: event.role,
    status: 'running',
    message: event.message,
  });
}

function handleAgentComplete(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'agent_complete' }>
): CouncilDashboardState {
  return updateAgentStatus(state, {
    role: event.role,
    status: 'completed',
    message: event.summary,
    clearTool: true,
  });
}

function handleAgentFailed(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'agent_failed' }>
): CouncilDashboardState {
  return updateAgentStatus(state, {
    role: event.role,
    status: 'failed',
    message: event.error,
    clearTool: true,
  });
}

function handleDiagnosisReady(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'diagnosis_ready' }>
): CouncilDashboardState {
  const updatedAgents = { ...state.agents };
  const allRoles: AgentRole[] = ['runtime', 'config', 'resource', 'synthesizer'];

  for (const r of allRoles) {
    const agent = updatedAgents[r];
    if (agent.status !== 'failed' && agent.status !== 'completed') {
      updatedAgents[r] = {
        ...agent,
        status: 'completed',
      };
    }
  }

  return {
    ...state,
    consensus: event.consensus,
    activeTool: null,
    agents: updatedAgents,
  };
}

function handleRuleMatched(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'rule_matched' }>
): CouncilDashboardState {
  return {
    ...state,
    ruleMatched: { ruleId: event.ruleId, title: event.title },
  };
}

function handleErrorEvent(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'error' }>
): CouncilDashboardState {
  return {
    ...state,
    error: event.message,
  };
}

type ReducerHandler = (state: CouncilDashboardState, event: any) => CouncilDashboardState;

const EVENT_HANDLERS: Record<string, ReducerHandler> = {
  analysis_start: handleAnalysisStart,
  agent_start: handleAgentStart,
  agent_tool_call: handleAgentToolCall,
  agent_tool_result: handleAgentToolResult,
  agent_progress: handleAgentProgress,
  agent_complete: handleAgentComplete,
  agent_failed: handleAgentFailed,
  diagnosis_ready: handleDiagnosisReady,
  rule_matched: handleRuleMatched,
  error: handleErrorEvent,
};

/**
 * Pure state reducer applying live NDJSON streaming events to council dashboard state.
 */
export function councilEventReducer(
  state: CouncilDashboardState,
  event: NDJSONEvent
): CouncilDashboardState {
  const handler = EVENT_HANDLERS[event.event];
  return handler ? handler(state, event) : state;
}
