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

/**
 * Normalizes an arbitrary role string to a canonical AgentRole.
 */
export function normalizeCouncilRole(role?: string): AgentRole | null {
  if (!role) return null;
  const lower = role.toLowerCase();
  if (lower === 'runtime' || lower.includes('runtime') || lower.includes('log')) return 'runtime';
  if (lower === 'config' || lower.includes('config') || lower.includes('depend')) return 'config';
  if (lower === 'resource' || lower.includes('resource') || lower.includes('cluster')) return 'resource';
  if (
    lower === 'synthesizer' ||
    lower.includes('synthes') ||
    lower.includes('lead') ||
    lower.includes('sre') ||
    lower.includes('investigator')
  ) {
    return 'synthesizer';
  }
  return null;
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

/**
 * Formats tool call arguments into a concise terminal string.
 */
export function formatToolArgs(args?: Record<string, unknown>): string {
  if (!args) return '';
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  if (entries.length === 1) {
    const val = entries[0][1];
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      return String(val);
    }
  }
  return entries
    .map(([key, val]) => `${key}=${typeof val === 'object' ? JSON.stringify(val) : String(val)}`)
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
  const role = normalizeCouncilRole(event.role);
  if (!role) return state;

  const current = state.agents[role];
  return {
    ...state,
    isLive: true,
    agents: {
      ...state.agents,
      [role]: {
        ...current,
        status: 'running',
        message: event.message,
      },
    },
  };
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
  const role = normalizeCouncilRole(event.role);
  if (!role) return state;

  const current = state.agents[role];
  return {
    ...state,
    isLive: true,
    agents: {
      ...state.agents,
      [role]: {
        ...current,
        status: 'running',
        message: event.message,
      },
    },
  };
}

function handleAgentComplete(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'agent_complete' }>
): CouncilDashboardState {
  const role = normalizeCouncilRole(event.role);
  if (!role) return state;

  const current = state.agents[role];
  const shouldClearTool = state.activeTool?.role === event.role;

  return {
    ...state,
    activeTool: shouldClearTool ? null : state.activeTool,
    agents: {
      ...state.agents,
      [role]: {
        ...current,
        status: 'completed',
        message: event.summary,
      },
    },
  };
}

function handleAgentFailed(
  state: CouncilDashboardState,
  event: Extract<NDJSONEvent, { event: 'agent_failed' }>
): CouncilDashboardState {
  const role = normalizeCouncilRole(event.role);
  if (!role) return state;

  const current = state.agents[role];
  const shouldClearTool = state.activeTool?.role === event.role;

  return {
    ...state,
    activeTool: shouldClearTool ? null : state.activeTool,
    agents: {
      ...state.agents,
      [role]: {
        ...current,
        status: 'failed',
        message: event.error,
      },
    },
  };
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

/**
 * Pure state reducer applying live NDJSON streaming events to council dashboard state.
 */
export function councilEventReducer(
  state: CouncilDashboardState,
  event: NDJSONEvent
): CouncilDashboardState {
  switch (event.event) {
    case 'analysis_start':
      return handleAnalysisStart(state, event);
    case 'agent_start':
      return handleAgentStart(state, event);
    case 'agent_tool_call':
      return handleAgentToolCall(state, event);
    case 'agent_tool_result':
      return handleAgentToolResult(state, event);
    case 'agent_progress':
      return handleAgentProgress(state, event);
    case 'agent_complete':
      return handleAgentComplete(state, event);
    case 'agent_failed':
      return handleAgentFailed(state, event);
    case 'diagnosis_ready':
      return handleDiagnosisReady(state, event);
    case 'rule_matched':
      return handleRuleMatched(state, event);
    case 'error':
      return handleErrorEvent(state, event);
    default:
      return state;
  }
}
