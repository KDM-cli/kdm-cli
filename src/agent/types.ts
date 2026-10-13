/**
 * Types and interfaces for the Multi-Agent Collaborative Analysis system.
 */

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
  | { event: 'evidence_collected'; count: number; ids: string[] }
  | { event: 'rule_matched'; ruleId: string; title: string }
  | { event: 'agent_start'; role: 'runtime' | 'config' | 'resource' | 'synthesizer'; message: string }
  | { event: 'agent_tool_call'; role: string; tool: string; args: Record<string, unknown> }
  | { event: 'agent_tool_result'; role: string; tool: string; durationMs: number }
  | { event: 'agent_progress'; role: string; message: string }
  | { event: 'agent_complete'; role: string; summary: string }
  | { event: 'agent_failed'; role: string; error: string }
  | { event: 'diagnosis_ready'; consensus: ConsensusDiagnosis }
  | { event: 'error'; message: string; fatal: boolean };
