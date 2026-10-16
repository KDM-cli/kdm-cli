/**
 * Fallback Ladder & Graceful Degradation Engine — KDM v4.0.0
 *
 * Implements Phase 18 (Issue #289):
 * Prevents unhandled crashes when local Ollama, Python runtime, or cloud backends fail.
 *
 * Ladder Steps:
 *   Step 1: Multi-Agent Council (Python + Ollama)
 *   Step 2: Deterministic Rule Engine (Synchronous, zero LLM overhead)
 *   Step 3: Legacy AI Client (OpenAI/Claude/Azure cloud backends)
 *   Step 4: Raw Kubernetes Event and Log Summary (Zero AI available)
 */

import type { AnalyzerResult } from '../analyzers/types';
import { logger } from '../utils/logger';
import { RuleEngine } from '../rules';
import type { RuleMatch } from '../rules/types';
import { createAIClient } from '../ai/factory';
import { getAIConfig } from '../config/store';

export type FallbackStep = 'council' | 'rule_engine' | 'legacy_ai' | 'raw_summary';

export interface FallbackContext {
  result: AnalyzerResult;
  backend: string;
  failureText: string;
  prompt: string;
  degradationReason?: string;
  customHeaders?: Record<string, string>;
}

/**
 * Formats a raw Kubernetes failure and event summary when zero AI is available.
 */
export function formatRawKubernetesSummary(result: AnalyzerResult, reason?: string): string {
  const lines: string[] = ['[RAW KUBERNETES SUMMARY]'];

  if (reason) {
    lines.push(`ℹ Notice: ${reason}.`);
  }
  lines.push('ℹ Zero AI available. Displaying raw Kubernetes diagnostic summary...');
  lines.push('');
  lines.push(`Workload: ${result.kind}/${result.name}`);
  if (result.namespace) {
    lines.push(`Namespace: ${result.namespace}`);
  }

  lines.push('Detected Failures:');
  for (const err of result.errors) {
    lines.push(`  - ${err.text}`);
    if (err.kubernetesDoc) {
      lines.push(`    Reference: ${err.kubernetesDoc}`);
    }
  }

  return lines.join('\n');
}

/**
 * Attempts Step 2 of the ladder: Deterministic Rule Engine.
 * Evaluates rules directly and returns true if a conclusive match (confidence >= 0.9) is found.
 */
export function applyRuleEngineFallback(
  ctx: FallbackContext,
  ruleEngine: RuleEngine = new RuleEngine()
): RuleMatch | null {
  const match = ruleEngine.evaluate(ctx.result, 0.9);
  if (!match) return null;

  const notice = ctx.degradationReason || 'Local AI unavailable';
  logger.info(`Notice: ${notice}.`);
  logger.info('Running in Deterministic Rule Mode (zero LLM overhead)...');

  const formattedDetails = ruleEngine.formatMatch(match, notice);

  ctx.result.details = formattedDetails;
  ctx.result.fallbackBadge = 'DETERMINISTIC RULE MODE';
  ctx.result.fallbackReason = notice;
  ctx.result.fallbackStep = 'rule_engine';
  ctx.result.ruleMatch = match;

  return match;
}

/**
 * Resolves a viable cloud AI fallback backend when Ollama is unreachable.
 */
function resolveCloudFallbackBackend(currentBackend: string): string | null {
  if (currentBackend.toLowerCase() !== 'ollama') {
    return currentBackend;
  }

  try {
    const aiConfig = getAIConfig();
    const cloudProvider = aiConfig?.providers?.find(
      (p) => p.name.toLowerCase() !== 'ollama' && Boolean(p.password || (p as any).apiKey)
    );
    if (cloudProvider?.name) {
      return cloudProvider.name;
    }
  } catch {
    // Fail-safe
  }
  return null;
}

/**
 * Attempts Step 3 of the ladder: Legacy AI Client completion.
 */
export async function applyLegacyAiFallback(ctx: FallbackContext): Promise<string | null> {
  const targetBackend = resolveCloudFallbackBackend(ctx.backend);
  if (!targetBackend) return null;

  try {
    const client = await createAIClient(targetBackend);
    const completion = await client.getCompletion(ctx.prompt);
    if (!completion?.trim()) return null;

    const notice = ctx.degradationReason
      ? `${ctx.degradationReason}; fell back to ${targetBackend}`
      : `Fell back to ${targetBackend}`;

    ctx.result.details = completion;
    ctx.result.fallbackBadge = 'LEGACY CLOUD AI';
    ctx.result.fallbackReason = notice;
    ctx.result.fallbackStep = 'legacy_ai';

    return completion;
  } catch (err) {
    logger.warn(`Legacy AI fallback to '${targetBackend}' failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Executes Step 4 of the ladder: Raw Kubernetes event and log summary.
 * Guaranteed to succeed without throwing.
 */
export function applyRawSummaryFallback(ctx: FallbackContext): void {
  const notice = ctx.degradationReason || 'All AI backends unavailable';
  const rawSummary = formatRawKubernetesSummary(ctx.result, notice);

  ctx.result.details = rawSummary;
  ctx.result.fallbackBadge = 'RAW K8S SUMMARY';
  ctx.result.fallbackReason = notice;
  ctx.result.fallbackStep = 'raw_summary';
}
