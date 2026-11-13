/**
 * Rule Engine Dispatcher — KDM v4.0.0
 *
 * Implements Step 2 of the Fallback Ladder:
 * Evaluates deterministic failure rules synchronously in < 5ms with zero LLM overhead.
 */

import type { AnalyzerResult } from '../analyzers/types';
import {
  CrashLoopRule,
  ImagePullRule,
  OOMKilledRule,
  ProbeFailureRule,
  SchedulingRule,
} from './k8s-rules';
import type { DiagnosticRule, RuleMatch, WorkloadContext } from './types';

export type RuleEngineInput =
  | string
  | AnalyzerResult
  | { failureText: string; context?: WorkloadContext };

function normalizeInput(input: RuleEngineInput): { failureText: string; context: WorkloadContext } {
  if (typeof input === 'string') {
    return { failureText: input, context: {} };
  }
  if ('errors' in input && Array.isArray(input.errors)) {
    const failureText = input.errors.map((e) => e.text).join('\n');
    return {
      failureText,
      context: {
        kind: input.kind,
        name: input.name,
        namespace: input.namespace,
      },
    };
  }
  const custom = input as { failureText?: string; context?: WorkloadContext };
  return {
    failureText: custom.failureText || '',
    context: custom.context || {},
  };
}

export class RuleEngine {
  private readonly rules: DiagnosticRule[];

  constructor(rules?: DiagnosticRule[]) {
    this.rules = rules ? [...rules] : [
      new OOMKilledRule(),
      new ImagePullRule(),
      new CrashLoopRule(),
      new ProbeFailureRule(),
      new SchedulingRule(),
    ];
  }

  register(rule: DiagnosticRule): void {
    this.rules.push(rule);
  }

  getRules(): readonly DiagnosticRule[] {
    return [...this.rules];
  }

  evaluateAll(input: RuleEngineInput): RuleMatch[] {
    const { failureText, context } = normalizeInput(input);
    if (!failureText.trim()) return [];

    const matches: RuleMatch[] = [];
    for (const rule of this.rules) {
      try {
        const match = rule.evaluate(failureText, context);
        if (match) {
          matches.push(match);
        }
      } catch {
        // Individual rule failure should not crash the engine
        continue;
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  evaluate(input: RuleEngineInput, minConfidence = 0.0): RuleMatch | null {
    return this.getPrimaryMatch(input, minConfidence);
  }

  getPrimaryMatch(input: RuleEngineInput, minConfidence = 0.0): RuleMatch | null {
    const matches = this.evaluateAll(input);
    if (matches.length > 0 && matches[0].confidence >= minConfidence) {
      return matches[0];
    }
    return null;
  }

  shouldBypassLLM(match: RuleMatch | null | undefined): boolean {
    return Boolean(match && match.confidence >= 0.99);
  }

  /**
   * Formats a rule match for terminal/CLI display with optional notice header.
   */
  formatMatch(match: RuleMatch, notice?: string): string {
    const lines: string[] = [];

    if (notice) {
      lines.push(`ℹ Notice: ${notice}`);
      lines.push('ℹ Running in Deterministic Rule Mode (zero LLM overhead)...');
      lines.push('');
    }

    lines.push(`✔ Root Cause Identified: ${match.title}`);
    for (const detail of match.details) {
      lines.push(`  - ${detail}`);
    }

    if (match.suggestedFix) {
      lines.push('');
      lines.push(`Recommended Remediation:`);
      lines.push(`  ${match.suggestedFix}`);
    }

    if (match.commandToRun) {
      lines.push('');
      lines.push(`  Command: ${match.commandToRun}`);
    }

    return lines.join('\n');
  }
}
