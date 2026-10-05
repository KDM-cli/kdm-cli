import { AnalyzerResult } from '../analyzers/types';

export interface AnalysisOptions {
  filters?: string[];
  namespace?: string;
  labelSelector?: string;
  kubeconfig?: string;
  kubecontext?: string;
  output?: 'text' | 'json';
  maxConcurrency?: number;
  withStats?: boolean;
  withDocs?: boolean;
  signal?: AbortSignal;
  explain?: boolean;
  backend?: string;
  language?: string;
  anonymize?: boolean;
  customHeaders?: Record<string, string>;
  noCache?: boolean;
  interactive?: boolean;
  requestedFixes?: string[];
  /** When true, route analysis through the multi-agent engine (Phases 1–24). */
  multiAgent?: boolean;
}

export interface AnalysisStats {
  analyzer: string;
  durationMs: number;
}

export interface AnalysisOutput {
  provider?: string;
  errors: string[];
  status: 'OK' | 'ProblemDetected';
  problems: number;
  results: AnalyzerResult[];
  stats?: AnalysisStats[];
  suggestedFixes?: SuggestedFix[];
}
export interface SuggestedFix {
  id: string;
  title: string;
  description: string;
  namespace?: string;
  kind?: string;
  resourceName?: string;
}
export type AnalysisStatus = 'OK' | 'ProblemDetected';
export type AnalysisErrors = string[];

// ─── Frozen Boundary Interfaces (Phase 0 Contract Freeze) ───────────────────

/**
 * Frozen input contract for the analysis pipeline.
 * Encapsulates all parameters needed to initiate a workload analysis request.
 * This interface must remain stable across all future phases.
 */
export interface AnalysisRequest {
  /** The Kubernetes workload kind being analyzed. */
  workloadKind: 'Pod' | 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Job';
  /** Name of the workload resource. */
  workloadName: string;
  /** Kubernetes namespace where the workload resides. */
  namespace: string;
  /** Optional cluster context for multi-cluster environments. */
  clusterContext?: string;
  /** AI backend provider to use for analysis. */
  backend: 'ollama' | 'openai' | 'claude' | 'azure' | 'custom';
  /** Optional model name override for the selected backend. */
  model?: string;
  /** Whether to include detailed analysis output. */
  detailed?: boolean;
}

/**
 * Frozen output contract for the legacy analysis pipeline.
 * Captures the complete result of a single workload analysis run.
 * All future phases must produce data compatible with this shape.
 */
export interface LegacyAnalysisResult {
  /** The identified root cause of the workload issue. */
  rootCause: string;
  /** Suggested remediation steps or commands. */
  suggestedFix: string;
  /** Confidence score from 0.0 (no confidence) to 1.0 (certain). */
  confidence: number;
  /** Raw unprocessed output from the AI backend. */
  rawOutput: string;
  /** Total analysis duration in milliseconds. */
  durationMs: number;
}

/**
 * Lifecycle events emitted during the analysis pipeline execution.
 * Used for progress tracking and UI updates.
 */
export type AnalysisEvent =
  | { type: 'analysis:started'; timestamp: number }
  | { type: 'analysis:analyzer-complete'; analyzer: string; durationMs: number }
  | { type: 'analysis:explain-start'; backend: string }
  | { type: 'analysis:explain-complete'; durationMs: number }
  | { type: 'analysis:complete'; result: AnalysisOutput }
  | { type: 'analysis:error'; error: string };
