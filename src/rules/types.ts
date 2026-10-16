/**
 * Types and interfaces for the Deterministic Rule Engine.
 *
 * Implements Step 2 of the KDM v4.0.0 Fallback Ladder:
 * Synchronous, zero-overhead diagnostic evaluation of Kubernetes failure signatures.
 */

export interface WorkloadContext {
  kind?: string;
  name?: string;
  namespace?: string;
  container?: string;
}

export interface RuleMatch {
  ruleId: string;
  title: string;
  rootCause: string;
  confidence: number;
  details: string[];
  evidenceIds?: string[];
  suggestedFix?: string;
  commandToRun?: string;
}

export interface DiagnosticRule {
  readonly ruleId: string;
  readonly title: string;
  evaluate(failureText: string, context?: WorkloadContext): RuleMatch | null;
}
