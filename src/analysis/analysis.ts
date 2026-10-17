import type { AnalysisOptions, AnalysisOutput, AnalysisStats, SuggestedFix } from './types';
import { registry } from '../analyzers';
import { measureDuration } from './stats';
import { getActiveFilters, getAIConfig, getCacheConfig, getConfig } from '../config/store';
import type { Analyzer, AnalyzerResult } from '../analyzers/types';
import { createAIClient } from '../ai/factory';
import { buildPrompt } from '../ai/prompts';
import { anonymize, deanonymize } from '../utils/text';
import { createCacheProvider } from '../cache';
import { logger } from '../utils/logger';
import {
  runPythonAgentCouncil,
  runAgentCouncilProcess,
  isPythonAgentAvailable,
} from '../agent/python-bridge';
import type { ConsensusDiagnosis, AgentProgressEvent, NDJSONEvent } from '../agent/types';
import {
  checkCouncilDependencies,
  resolveOllamaBaseUrl,
} from './probes';
import {
  applyRuleEngineFallback,
  applyLegacyAiFallback,
  applyRawSummaryFallback,
  formatRawKubernetesSummary,
  type FallbackContext,
} from './fallback';

const DEFAULT_FILTERS = ['Pod', 'Deployment', 'Service', 'PersistentVolumeClaim', 'Node'];
const MAX_ALLOWED_CONCURRENCY = 100;
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_LANGUAGE = 'english';
const DEFAULT_FALLBACK_BACKEND = 'openai';

/**
 * Resolves the list of filters to be run based on option inputs, default configuration,
 * or active filters stored in the client settings.
 * @param options Options passed to the analysis run.
 * @returns An array of string filter names.
 */
function resolveFilters(options: AnalysisOptions): string[] {
  if (options.filters?.length) {
    return options.filters;
  }
  const active = getActiveFilters();
  return active.length > 0 ? active : DEFAULT_FILTERS;
}

/**
 * Resolves filter strings to their corresponding Analyzer implementations from the registry.
 * Appends error messages to the errors array if a filter name is unrecognized.
 * @param filters The names of the filters to resolve.
 * @param errors The array of error strings to log unknown filters.
 * @returns Resolved Analyzer instances.
 */
function resolveAnalyzers(filters: string[], errors: string[]): Analyzer[] {
  const analyzers: Analyzer[] = [];
  for (const filter of filters) {
    const analyzer = registry.get(filter);
    if (analyzer) {
      analyzers.push(analyzer);
    } else {
      errors.push(`Unknown filter: ${filter}`);
    }
  }
  return analyzers;
}

/**
 * Parses and bounds the concurrency limit within the minimum and maximum constraints.
 * @param maxConcurrency User provided concurrency limit or undefined.
 * @returns Valid concurrency limit integer.
 */
function resolveConcurrencyLimit(maxConcurrency: number | undefined): number {
  if (maxConcurrency === undefined) return DEFAULT_CONCURRENCY;
  if (typeof maxConcurrency !== 'number') return DEFAULT_CONCURRENCY;
  if (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0) return DEFAULT_CONCURRENCY;
  return Math.min(maxConcurrency, MAX_ALLOWED_CONCURRENCY);
}

/**
 * Attaches the currently configured default AI provider metadata to the analysis output.
 * Swallows exceptions to remain fail-safe in non-configured environments.
 * @param output The analysis output object.
 */
function tryAttachProvider(output: AnalysisOutput): void {
  try {
    const aiConfig = getAIConfig();
    if (aiConfig?.defaultProvider) {
      output.provider = aiConfig.defaultProvider;
    }
  } catch {
    // Fail-safe if store isn't initialized or fails to load in specific environments
  }
}

/**
 * Resolves the AI backend name to use for explain mode.
 * Priority: explicit --backend flag > configured default provider > fallback to openai.
 * @param options The analysis options.
 * @returns The resolved backend name string.
 */
export function resolveBackend(options: AnalysisOptions): string {
  if (options.backend) return options.backend;
  try {
    const aiConfig = getAIConfig();
    if (aiConfig?.defaultProvider) return aiConfig.defaultProvider;
  } catch {
    // Fail-safe
  }
  return DEFAULT_FALLBACK_BACKEND;
}

/** Options for building a cache key. */
interface CacheKeyParams {
  provider: string;
  model: string;
  language: string;
  failureText: string;
}

/**
 * Builds a deterministic cache key by hashing provider, model, language, and failure text.
 * @param params Parameters to include in the cache key.
 * @returns A hex-encoded SHA-256 hash string.
 */
async function buildCacheKey(params: CacheKeyParams): Promise<string> {
  const { createHash } = await import('node:crypto');
  const normalized = `${params.provider}:${params.model}:${params.language}:${params.failureText.trim()}`;
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Attempts to load a cached AI response for a given failure text.
 * Returns null and warns on errors without throwing.
 * @param cacheKey The cache key to look up.
 * @param noCache Whether caching is bypassed via --no-cache flag.
 * @returns Cached response string or null.
 */
async function tryLoadFromCache(cacheKey: string, noCache: boolean): Promise<string | null> {
  if (noCache) return null;
  try {
    const cacheConfig = getCacheConfig();
    if (!cacheConfig.enabled) return null;
    const cache = createCacheProvider(cacheConfig);
    return await cache.load(cacheKey);
  } catch {
    logger.warn('Cache read failed, proceeding with AI call');
    return null;
  }
}

/**
 * Attempts to store an AI response in cache.
 * Warns on errors without throwing.
 * @param cacheKey The cache key to store under.
 * @param data The AI response text to cache.
 */
async function tryStoreToCache(cacheKey: string, data: string): Promise<void> {
  try {
    const cacheConfig = getCacheConfig();
    if (!cacheConfig.enabled) return;
    const cache = createCacheProvider(cacheConfig);
    await cache.store(cacheKey, data);
  } catch {
    logger.warn('Cache write failed, continuing without caching');
  }
}

/** Parameters for explaining a single analyzer result via AI. */
export interface ExplainSingleParams {
  result: AnalyzerResult;
  backend: string;
  model?: string;
  language: string;
  shouldAnonymize: boolean;
  noCache: boolean;
  customHeaders?: Record<string, string>;
  onAgentProgress?: (event: AgentProgressEvent) => void;
  onEvent?: (event: NDJSONEvent) => void;
}

/**
 * Formats consensus diagnosis from the multi-agent council for terminal display.
 *
 * @param consensus The consensus diagnosis from the Python agent council.
 * @returns Human-readable multi-agent report string.
 */
export function formatConsensusExplanation(consensus: ConsensusDiagnosis): string {
  const lines: string[] = [
    `Root Cause (${consensus.confidence.toUpperCase()} confidence):`,
    `  ${consensus.rootCause}`,
    '',
    'Recommended Remediation:',
    `  ${consensus.bestSolution.actionTitle}`,
  ];

  for (const step of consensus.bestSolution.steps) {
    lines.push(`  - ${step}`);
  }

  if (consensus.bestSolution.commandToRun) {
    lines.push('');
    lines.push(`  Command: ${consensus.bestSolution.commandToRun}`);
  }

  lines.push('');
  lines.push('Specialist Agent Findings:');
  for (const finding of consensus.findings) {
    lines.push(`  - [${finding.agentName}]: ${finding.summary || finding.statusText}`);
  }

  return lines.join('\n');
}

/**
 * Attempts to execute the Python Multi-Agent Council for Ollama backends.
 */
async function tryRunAgentCouncil(
  params: ExplainSingleParams,
  promptText: string,
  model: string,
  baseUrl: string = resolveOllamaBaseUrl()
): Promise<string | null> {
  if (params.backend !== 'ollama') return null;

  const isAvailable = await isPythonAgentAvailable();
  if (!isAvailable) return null;

  try {
    const consensus = await runPythonAgentCouncil({
      failureText: promptText,
      context: {
        kind: params.result.kind,
        name: params.result.name,
        namespace: params.result.namespace,
      },
      model: params.model || model,
      baseUrl,
      onProgress: params.onAgentProgress,
      onEvent: params.onEvent,
    });
    (params.result as any).consensus = consensus;
    params.result.fallbackStep = 'council';
    return formatConsensusExplanation(consensus);
  } catch (err) {
    logger.warn(`Multi-agent council failed, using direct completion: ${(err as Error).message}`);
    return null;
  }
}

interface PrimaryExecutionResult {
  success: boolean;
  response?: string;
  degradationReason?: string;
}

function preparePromptMapping(
  failureText: string,
  shouldAnonymize?: boolean
): { promptText: string; mapping: { original: string; placeholder: string }[] } {
  if (!shouldAnonymize) {
    return { promptText: failureText, mapping: [] };
  }
  const anonymized = anonymize(failureText);
  return { promptText: anonymized.text, mapping: anonymized.mapping };
}

function applyAnonymization(
  text: string,
  mapping: { original: string; placeholder: string }[],
  shouldAnonymize?: boolean
): string {
  return shouldAnonymize ? deanonymize(text, mapping) : text;
}

async function attemptPrimaryCouncil(
  params: ExplainSingleParams,
  promptText: string,
  model: string
): Promise<PrimaryExecutionResult> {
  const baseUrl = resolveOllamaBaseUrl();
  const deps = await checkCouncilDependencies(baseUrl);
  if (!deps.canRunCouncil) {
    return { success: false, degradationReason: deps.degradationReason };
  }

  const agentResponse = await tryRunAgentCouncil(params, promptText, model, baseUrl);
  if (agentResponse) {
    return { success: true, response: agentResponse };
  }
  return { success: false, degradationReason: 'Multi-agent council execution failed' };
}

async function attemptPrimaryClient(
  backend: string,
  prompt: string
): Promise<PrimaryExecutionResult> {
  try {
    const client = await createAIClient(backend);
    const rawResponse = await client.getCompletion(prompt);
    if (rawResponse) {
      return { success: true, response: rawResponse };
    }
    return { success: false, degradationReason: `Primary AI backend '${backend}' empty response` };
  } catch (err) {
    logger.warn(`Primary AI backend '${backend}' failed: ${(err as Error).message}`);
    return { success: false, degradationReason: `Primary AI backend '${backend}' failed` };
  }
}

async function executePrimaryStep(
  params: ExplainSingleParams,
  promptText: string,
  prompt: string,
  model: string
): Promise<PrimaryExecutionResult> {
  if (params.backend.toLowerCase() === 'ollama') {
    return attemptPrimaryCouncil(params, promptText, model);
  }
  return attemptPrimaryClient(params.backend, prompt);
}

async function executeFallbackSteps(
  ctx: FallbackContext,
  params: ExplainSingleParams,
  cacheKey: string,
  mapping: { original: string; placeholder: string }[]
): Promise<void> {
  if (applyRuleEngineFallback(ctx)) {
    params.result.details = applyAnonymization(params.result.details || '', mapping, params.shouldAnonymize);
    if (!params.noCache && params.result.details) {
      await tryStoreToCache(cacheKey, params.result.details);
    }
    return;
  }

  const legacyResponse = await applyLegacyAiFallback(ctx);
  if (legacyResponse) {
    params.result.details = applyAnonymization(legacyResponse, mapping, params.shouldAnonymize);
    if (!params.noCache) {
      await tryStoreToCache(cacheKey, legacyResponse);
    }
    return;
  }

  applyRawSummaryFallback(ctx);
  params.result.details = applyAnonymization(params.result.details || '', mapping, params.shouldAnonymize);
}

/**
 * Explains a single analyzer result by building a prompt, calling the AI provider,
 * and attaching the response to the result's details field.
 *
 * Implements the 4-Step Fallback Ladder (Phase 18, Issue #289):
 *   Step 1: Multi-Agent Council (Python + Ollama)
 *   Step 2: Deterministic Rule Engine (Synchronous, zero LLM overhead)
 *   Step 3: Legacy AI Client (OpenAI/Claude cloud backends)
 *   Step 4: Raw Kubernetes event and log summary
 *
 * @param params Parameters for the explain operation.
 */
export async function explainSingleResult(params: ExplainSingleParams): Promise<void> {
  const failureText = params.result.errors.map((e) => e.text).join('\n');
  const { promptText, mapping } = preparePromptMapping(failureText, params.shouldAnonymize);

  const prompt = buildPrompt({
    failureText: promptText,
    language: params.language,
    analyzerName: params.result.kind,
  });

  const client = await createAIClient(params.backend);
  const model = params.model || ((client as any).model ?? '');

  const cacheKey = await buildCacheKey({
    provider: params.backend,
    model,
    language: params.language,
    failureText: promptText,
  });

  const cached = await tryLoadFromCache(cacheKey, params.noCache);
  if (cached) {
    params.result.details = applyAnonymization(cached, mapping, params.shouldAnonymize);
    return;
  }

  const primary = await executePrimaryStep(params, promptText, prompt, model);
  if (primary.success && primary.response) {
    params.result.details = applyAnonymization(primary.response, mapping, params.shouldAnonymize);
    if (!params.noCache) {
      await tryStoreToCache(cacheKey, primary.response);
    }
    return;
  }

  const fallbackCtx: FallbackContext = {
    result: params.result,
    backend: params.backend,
    failureText: promptText,
    prompt,
    degradationReason: primary.degradationReason,
    customHeaders: params.customHeaders,
  };

  await executeFallbackSteps(fallbackCtx, params, cacheKey, mapping);
}

/**
 * Constructs suggested fix models for each detected issue in the analyzer results.
 * @param results The analyzer results containing resource problems.
 * @returns Array of suggested fixes.
 */
export function buildSuggestedFixes(results: AnalyzerResult[]): SuggestedFix[] {
  return results.flatMap((result, index) =>
    result.errors.map((failure, failureIndex) => ({
      id: `${result.kind.toLowerCase()}-${index}-${failureIndex}`,
      title: (result as any).consensus?.bestSolution?.actionTitle || `Review ${result.kind} ${result.name}`,
      description: failure.text,
      namespace: result.namespace,
      kind: result.kind,
      resourceName: result.name,
    }))
  );
}

/**
 * Enriches analysis results with AI-powered explanations when explain mode is enabled.
 * Skips AI calls if no results exist. Resolves backend, builds prompts, and handles
 * anonymization and caching.
 * @param results The analyzer results to enrich.
 * @param options The analysis options.
 */
async function explainResults(results: AnalyzerResult[], options: AnalysisOptions): Promise<void> {
  if (!options.explain || results.length === 0) return;

  const backend = resolveBackend(options);
  const language = options.language ?? DEFAULT_LANGUAGE;
  const shouldAnonymize = options.anonymize ?? false;
  const noCache = options.noCache ?? false;

  for (const result of results) {
    if (!result.errors.length) continue;
    await explainSingleResult({
      result,
      backend,
      model: options.model,
      language,
      shouldAnonymize,
      noCache,
      customHeaders: options.customHeaders,
    });
  }
}

/** Parameters for running a single analyzer. */
interface RunSingleParams {
  analyzer: Analyzer;
  context: any;
  options: AnalysisOptions;
  results: AnalyzerResult[];
  errors: string[];
  stats: AnalysisStats[];
}

/**
 * Runs a single analyzer, measures its duration, and collects results, stats, or errors.
 * @param params Parameter inputs for running the analyzer.
 */
async function runSingleAnalyzer(params: RunSingleParams): Promise<void> {
  try {
    const { result: analyzerResults, durationMs } = await measureDuration(
      () => params.analyzer.analyze(params.context),
    );

    if (params.options.withStats) {
      params.stats.push({ analyzer: params.analyzer.name, durationMs });
    }

    params.results.push(...analyzerResults);
  } catch (err: any) {
    params.errors.push(`Analyzer ${params.analyzer.name} failed: ${err?.message || String(err)}`);
  }
}

/**
 * Checks whether the multi-agent council execution mode is requested via CLI flag,
 * environment variable, or persistent configuration setting.
 *
 * @param options Analysis options provided to the execution run.
 * @returns True if multi-agent council mode is enabled.
 */
function isMultiAgentRequested(options: AnalysisOptions): boolean {
  if (options.multiAgent === true) return true;
  if (process.env.KDM_MULTI_AGENT === 'true') return true;
  try {
    const config = getConfig();
    if (config?.multi_agent === true) return true;
  } catch {
    // Fail-safe if store fails to read
  }
  return false;
}

/**
 * Executes the selected analyzers concurrently up to the configured concurrency limit.
 */
async function executeAnalyzersConcurrently(
  analyzers: Analyzer[],
  options: AnalysisOptions,
  context: any,
  results: AnalyzerResult[],
  errors: string[],
  stats: AnalysisStats[],
): Promise<void> {
  const limit = resolveConcurrencyLimit(options.maxConcurrency);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, analyzers.length) }, async () => {
    while (index < analyzers.length) {
      if (options.signal?.aborted) break;
      const currentIndex = index++;
      const analyzer = analyzers[currentIndex];

      await runSingleAnalyzer({
        analyzer,
        context,
        options,
        results,
        errors,
        stats,
      });
    }
  });

  await Promise.all(workers);
}

/**
 * Packages analyzer results into an aggregated AnalysisOutput payload.
 */
function buildAnalysisOutput(
  results: AnalyzerResult[],
  errors: string[],
  stats: AnalysisStats[],
  options: AnalysisOptions,
): AnalysisOutput {
  const problems = results.reduce((acc, curr) => acc + curr.errors.length, 0);
  const suggestedFixes = options.interactive ? buildSuggestedFixes(results) : undefined;

  const output: AnalysisOutput = {
    errors,
    status: problems > 0 ? 'ProblemDetected' : 'OK',
    problems,
    results,
    ...(options.withStats ? { stats } : {}),
    ...(suggestedFixes ? { suggestedFixes } : {}),
  };

  tryAttachProvider(output);
  return output;
}

/**
 * Delegates detected failures or target workload diagnostics to the Python Multi-Agent Council bridge.
 * Sets consensus diagnosis on the primary result or safely degrades on bridge failures.
 *
 * @param results Detected analyzer results.
 * @param options Analysis execution options.
 */
async function executeCouncilForResults(
  results: AnalyzerResult[],
  options: AnalysisOptions,
): Promise<void> {
  const primaryResult = results[0];
  const failureText = results
    .flatMap((r) => r.errors.map((e) => e.text))
    .join('\n') || (options.targetResource ? `Workload ${options.targetResource} failure` : options.labelSelector ? `Workload matching selector ${options.labelSelector} failure` : 'Cluster workload failure');

  const targetKind = primaryResult?.kind || (options.targetResource?.includes('/') ? options.targetResource.split('/')[0] : 'Workload');
  const targetName = primaryResult?.name || options.resourceName || options.labelSelector || 'cluster';

  const targetContext = {
    namespace: primaryResult?.namespace || options.namespace,
    kind: targetKind,
    name: targetName,
  };

  try {
    const runner = runAgentCouncilProcess || runPythonAgentCouncil;
    const consensus = await runner({
      failureText,
      context: targetContext,
      model: options.model,
      baseUrl: resolveOllamaBaseUrl(),
    });

    if (consensus) {
      if (primaryResult) {
        (primaryResult as any).consensus = consensus;
        primaryResult.details = formatConsensusExplanation(consensus);
        primaryResult.fallbackStep = 'council';
      } else {
        results.push({
          kind: targetContext.kind,
          name: targetContext.name,
          namespace: targetContext.namespace || 'default',
          errors: [{ text: failureText }],
          details: formatConsensusExplanation(consensus),
          consensus,
          fallbackStep: 'council',
        } as any);
      }
      return;
    }
  } catch (err) {
    logger.warn(`Multi-agent council bridge failed: ${(err as Error).message}. Falling back to legacy pipeline.`);
  }

  await explainResults(results, options);
}

/**
 * Runs the Multi-Agent Council pipeline (Phases 1–24) for workload analysis.
 * Concurrently evaluates analyzers and delegates to the Python agent council bridge.
 *
 * @param options Analysis options directing analyzers and multi-agent execution.
 * @returns Aggregated analysis output with council consensus.
 */
async function runMultiAgentPipeline(options: AnalysisOptions): Promise<AnalysisOutput> {
  const errors: string[] = [];
  const results: AnalyzerResult[] = [];
  const stats: AnalysisStats[] = [];

  const filters = resolveFilters(options);
  const analyzersToRun = resolveAnalyzers(filters, errors);
  const context = {
    namespace: options.namespace,
    labelSelector: options.labelSelector,
    kubeconfig: options.kubeconfig,
    kubecontext: options.kubecontext,
    withDocs: options.withDocs,
    signal: options.signal,
  };

  await executeAnalyzersConcurrently(analyzersToRun, options, context, results, errors, stats);
  await executeCouncilForResults(results, options);

  return buildAnalysisOutput(results, errors, stats, options);
}

/**
 * Executes the frozen legacy baseline analysis pipeline (Phase 0).
 * Runs analyzers and delegates to single-prompt cloud or local AI completions.
 *
 * @param options Analysis execution options.
 * @returns Aggregated analysis output.
 */
async function runLegacyPipeline(options: AnalysisOptions): Promise<AnalysisOutput> {
  const errors: string[] = [];
  const results: AnalyzerResult[] = [];
  const stats: AnalysisStats[] = [];

  const filters = resolveFilters(options);
  const analyzersToRun = resolveAnalyzers(filters, errors);
  const context = {
    namespace: options.namespace,
    labelSelector: options.labelSelector,
    kubeconfig: options.kubeconfig,
    kubecontext: options.kubecontext,
    withDocs: options.withDocs,
    signal: options.signal,
  };

  await executeAnalyzersConcurrently(analyzersToRun, options, context, results, errors, stats);
  await explainResults(results, options);

  return buildAnalysisOutput(results, errors, stats, options);
}

/**
 * Executes a full Kubernetes analysis run across selected analyzers,
 * routing to either the experimental Multi-Agent Council or the legacy pipeline.
 *
 * @param options Options configuration directing namespace, filters, context, and stats.
 * @returns Aggregated analysis results containing status, problems, and stats.
 */
export async function runAnalysis(options: AnalysisOptions): Promise<AnalysisOutput> {
  if (isMultiAgentRequested(options)) {
    return runMultiAgentPipeline(options);
  }

  logger.warn('Legacy single-prompt mode will be deprecated in v4.1.0.');
  return runLegacyPipeline(options);
}

export {
  isOllamaAvailable,
  checkCouncilDependencies,
  resolveOllamaBaseUrl,
} from './probes';
export { RuleEngine } from '../rules';
export type { RuleMatch } from '../rules/types';
export {
  applyRuleEngineFallback,
  applyLegacyAiFallback,
  applyRawSummaryFallback,
  formatRawKubernetesSummary,
};
