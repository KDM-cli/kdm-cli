import { AnalysisOptions, AnalysisOutput, AnalysisStats } from './types';
import { registry } from '../analyzers';
import { measureDuration } from './stats';
import { getActiveFilters, getAIConfig, getCacheConfig } from '../config/store';
import { Analyzer, AnalyzerResult } from '../analyzers/types';
import { createAIClient } from '../ai/factory';
import { buildPrompt } from '../ai/prompts';
import { anonymize, deanonymize } from '../utils/text';
import { createCacheProvider } from '../cache';
import { logger } from '../utils/logger';
import type { SuggestedFix } from './types';

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
  language: string;
  shouldAnonymize: boolean;
  noCache: boolean;
  customHeaders?: Record<string, string>;
}

/**
 * Explains a single analyzer result by building a prompt, calling the AI provider,
 * and attaching the response to the result's details field.
 * @param params Parameters for the explain operation.
 */
export async function explainSingleResult(params: ExplainSingleParams): Promise<void> {
  const failureText = params.result.errors.map((e) => e.text).join('\n');
  let promptText = failureText;
  let mapping: { original: string; placeholder: string }[] = [];

  if (params.shouldAnonymize) {
    const anonymized = anonymize(failureText);
    promptText = anonymized.text;
    mapping = anonymized.mapping;
  }

  const prompt = buildPrompt({
    failureText: promptText,
    language: params.language,
    analyzerName: params.result.kind,
  });

  const client = await createAIClient(params.backend);
  const model = (client as any).model ?? '';

  const cacheKey = await buildCacheKey({
    provider: params.backend,
    model,
    language: params.language,
    failureText: promptText,
  });

  const cached = await tryLoadFromCache(cacheKey, params.noCache);
  if (cached) {
    params.result.details = params.shouldAnonymize ? deanonymize(cached, mapping) : cached;
    return;
  }

  const response = await client.getCompletion(prompt);
  const explanation = params.shouldAnonymize ? deanonymize(response, mapping) : response;
  params.result.details = explanation;

  if (!params.noCache) {
    await tryStoreToCache(cacheKey, response);
  }
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
      title: `Review ${result.kind} ${result.name}`,
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
 * Executes a full Kubernetes analysis run across selected analyzers in parallel,
 * respecting concurrency limits and monitoring cancellation signals.
 * @param options Options configuration directing namespace, filters, context, and stats.
 * @returns Aggregated analysis results containing status, problems, and stats.
 */
export async function runAnalysis(options: AnalysisOptions): Promise<AnalysisOutput> {
  const errors: string[] = [];
  const results: AnalyzerResult[] = [];
  const stats: AnalysisStats[] = [];

  const filters = resolveFilters(options);
  const analyzersToRun = resolveAnalyzers(filters, errors);
  const limit = resolveConcurrencyLimit(options.maxConcurrency);

  const context = {
    namespace: options.namespace,
    labelSelector: options.labelSelector,
    kubeconfig: options.kubeconfig,
    kubecontext: options.kubecontext,
    withDocs: options.withDocs,
    signal: options.signal,
  };

  let index = 0;
  const workers = Array.from({ length: Math.min(limit, analyzersToRun.length) }, async () => {
    while (index < analyzersToRun.length) {
      if (options.signal?.aborted) break;
      const currentIndex = index++;
      const analyzer = analyzersToRun[currentIndex];

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

  await explainResults(results, options);

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
