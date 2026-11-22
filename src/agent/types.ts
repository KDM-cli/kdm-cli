/**
 * Types and interfaces for the Multi-Agent Collaborative Analysis system.
 */

import type { z } from 'zod';

/**
 * Roles for agents participating in workload failure triaging.
 */
export type AgentRole = 'runtime' | 'config' | 'resource' | 'synthesizer';

/**
 * Execution status of an agent during triaging.
 */
export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Finding produced by an individual specialist agent.
 */
export interface AgentFinding {
  /** The agent role. */
  role: AgentRole;
  /** Human-readable display name of the agent. */
  agentName: string;
  /** Icon badge representing the agent. */
  icon: string;
  /** Current status of the agent. */
  status: AgentStatus;
  /** Status or progress message. */
  statusText: string;
  /** Primary observation or diagnostic finding. */
  summary?: string;
  /** List of supporting evidence items found by this agent. */
  evidence?: string[];
}

/**
 * Recommended remediation solution synthesized by the Lead SRE agent.
 */
export interface BestSolution {
  /** Short descriptive title for the recommended fix. */
  actionTitle: string;
  /** Detailed step-by-step remediation instructions. */
  steps: string[];
  /** Concrete CLI command or manifest patch to apply if applicable. */
  commandToRun?: string;
  /** Estimated risk level of applying this solution. */
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Complete consensus diagnosis produced by the agent council.
 */
export interface ConsensusDiagnosis {
  /** The primary identified root cause of the workload failure. */
  rootCause: string;
  /** Confidence level of the consensus diagnosis. */
  confidence: 'high' | 'medium' | 'low';
  /** Individual findings contributed by specialist agents. */
  findings: AgentFinding[];
  /** The synthesized best remediation solution. */
  bestSolution: BestSolution;
  /** Canonical evidence identifiers cited in support of this consensus diagnosis. */
  evidenceCitations?: string[];
}

/**
 * Lifecycle event emitted as agents progress through their investigation.
 */
export interface AgentProgressEvent {
  /** Role of the active agent. */
  role?: AgentRole;
  /** Display name of the active agent. */
  agentName: string;
  /** Current status of this agent. */
  status: AgentStatus;
  /** Descriptive status message (e.g. "Runtime Agent is working: Analyzing exit code..."). */
  message: string;
  /** Optional icon badge. */
  icon?: string;
}

// ─── NDJSON Streaming Event Protocol (Phase 11) ─────────────────────────────

/**
 * Discriminated union of all NDJSON streaming events exchanged between
 * the Python multi-agent engine (stdout) and the Node.js consumer.
 * Each variant is keyed by its `event` field.
 */
export type NDJSONEvent =
  | { event: 'analysis_start'; analysisId: string; timestamp: string }
  | { event: 'evidence_collected'; count: number; ids: string[]; timestamp: string }
  | { event: 'rule_matched'; ruleId: string; title: string; timestamp: string }
  | { event: 'agent_start'; role: AgentRole; message: string; timestamp: string }
  | { event: 'agent_tool_call'; role: string; tool: string; args: Record<string, unknown>; timestamp: string }
  | { event: 'agent_tool_result'; role: string; tool: string; durationMs: number; timestamp: string }
  | { event: 'agent_progress'; role: string; message: string; timestamp: string }
  | { event: 'agent_complete'; role: string; summary: string; timestamp: string }
  | { event: 'agent_failed'; role: string; error: string; timestamp: string }
  | { event: 'diagnosis_ready'; consensus: ConsensusDiagnosis; timestamp: string }
  | { event: 'error'; message: string; fatal: boolean; timestamp: string };

// ─── Milestone 3: Multi-Agent Coordination Protocol Types ────────────────────

/**
 * Execution context provided to registered subagents.
 */
export interface AgentContext {
  cwd?: string;
  namespace?: string;
  clusterContext?: string;
  signal?: AbortSignal;
  depth?: number;
  maxDepth?: number;
  dryRun?: boolean;
  auditTrail?: any;
  registry?: any;
  aiClient?: any;
  toolRegistry?: any;
  [key: string]: unknown;
}

/**
 * Standard agent definition registered in AgentRegistry.
 * Conforms to PROJECT.md § Interface Contracts.
 */
export interface AgentDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  run: (input: TInput, context?: AgentContext) => Promise<TOutput>;
  type?: 'local' | 'remote' | 'specialist' | 'council';
  metadata?: Record<string, unknown>;
}

/**
 * Type alias for local in-process agent definition.
 */
export type LocalAgentDefinition<TInput = any, TOutput = any> = AgentDefinition<TInput, TOutput>;

/**
 * Unified subagent progress representation consumed by terminal UI and event bridges.
 * Conforms to PROJECT.md § Interface Contracts.
 */
export interface SubagentProgress {
  agentName: string;
  state: 'running' | 'completed' | 'error' | 'cancelled';
  thought?: string;
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    status: 'running' | 'success' | 'error';
    output?: string;
  };
  result?: string;
}

/**
 * Event type discriminators for gemini-cli agent coordination.
 */
export type AgentEventType =
  | 'agent_start'
  | 'thought'
  | 'tool_call'
  | 'tool_result'
  | 'agent_complete'
  | 'agent_error'
  | 'agent_cancelled'
  | 'diagnosis_ready';

/**
 * Unified gemini-cli agent event protocol envelope.
 */
export interface AgentEvent {
  id?: string;
  agentName: string;
  type: AgentEventType;
  timestamp?: string;
  payload: {
    message?: string;
    thought?: string;
    tool?: string;
    args?: Record<string, unknown>;
    output?: string;
    durationMs?: number;
    result?: string;
    summary?: string;
    error?: string;
    consensus?: ConsensusDiagnosis;
  };
}

/**
 * Parameters for delegate_to_agent tool.
 */
export interface DelegateToAgentParams {
  agent_name: string;
  prompt: string;
  depth?: number;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

/**
 * Finding item produced by codebase investigation.
 */
export interface CodebaseFindingItem {
  file: string;
  issue: string;
  recommendation: string;
  patch?: string;
}

/**
 * Location citation in codebase investigation (gemini-cli format).
 */
export interface CodebaseRelevantLocation {
  FilePath: string;
  Reasoning: string;
  KeySymbols: string[];
  LineNumber?: number;
  Snippet?: string;
}

/**
 * KDM SRE finding report from codebase investigation.
 */
export interface CodebaseFinding {
  discoveredManifests: string[];
  findings: CodebaseFindingItem[];
  driftDetected?: boolean;
}

/**
 * Comprehensive dual-schema report from CodebaseInvestigatorAgent
 * supporting both gemini-cli and KDM SRE schemas.
 */
export interface CodebaseInvestigationReport {
  SummaryOfFindings: string;
  ExplorationTrace: string[];
  RelevantLocations: CodebaseRelevantLocation[];
  discoveredManifests: string[];
  findings: CodebaseFindingItem[];
  driftDetected: boolean;
}
