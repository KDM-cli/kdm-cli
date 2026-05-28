import { AnalysisOptions, AnalysisOutput, AnalysisStats } from './types';
import { registry } from '../analyzers';
import { measureDuration } from './stats';
import { getActiveFilters, getAIConfig } from '../config/store';
import { AnalyzerResult } from '../analyzers/types';

export async function runAnalysis(options: AnalysisOptions): Promise<AnalysisOutput> {
  const errors: string[] = [];
  const results: AnalyzerResult[] = [];
  const stats: AnalysisStats[] = [];

  // Determine filters to run
  let filters: string[] = [];
  if (options.filters && options.filters.length > 0) {
    filters = options.filters;
  } else {
    filters = getActiveFilters();
    if (filters.length === 0) {
      filters = ['Pod', 'Deployment', 'Service', 'PersistentVolumeClaim', 'Node'];
    }
  }

  // Resolve filters to analyzers
  const analyzersToRun: { name: string; analyze: (context: any) => Promise<AnalyzerResult[]> }[] = [];
  for (const filter of filters) {
    const analyzer = registry.get(filter);
    if (analyzer) {
      analyzersToRun.push(analyzer);
    } else {
      errors.push(`Unknown filter: ${filter}`);
    }
  }

  // Concurrency settings
  const maxAllowedConcurrency = 100;
  const defaultConcurrency = 10;
  let limit = defaultConcurrency;

  if (options.maxConcurrency !== undefined) {
    if (
      typeof options.maxConcurrency === 'number' &&
      options.maxConcurrency > 0 &&
      Number.isInteger(options.maxConcurrency)
    ) {
      limit = Math.min(options.maxConcurrency, maxAllowedConcurrency);
    } else {
      limit = defaultConcurrency;
    }
  }

  // Execution context
  const context = {
    namespace: options.namespace,
    labelSelector: options.labelSelector,
    withDocs: options.withDocs,
  };

  let index = 0;
  const workers = Array.from({ length: Math.min(limit, analyzersToRun.length) }, async () => {
    while (index < analyzersToRun.length) {
      const currentIndex = index++;
      const analyzer = analyzersToRun[currentIndex];

      try {
        const { result: analyzerResults, durationMs } = await measureDuration(async () => {
          return await analyzer.analyze(context);
        });

        if (options.withStats) {
          stats.push({
            analyzer: analyzer.name,
            durationMs,
          });
        }

        results.push(...analyzerResults);
      } catch (err: any) {
        errors.push(`Analyzer ${analyzer.name} failed: ${err?.message || String(err)}`);
      }
    }
  });

  await Promise.all(workers);

  const problems = results.reduce((acc, curr) => acc + curr.errors.length, 0);
  const status = problems > 0 ? 'ProblemDetected' : 'OK';

  const output: AnalysisOutput = {
    errors,
    status,
    problems,
    results,
  };

  if (options.withStats) {
    output.stats = stats;
  }

  try {
    const aiConfig = getAIConfig();
    if (aiConfig && aiConfig.defaultProvider) {
      output.provider = aiConfig.defaultProvider;
    }
  } catch {
    // Fail-safe if store isn't initialized or fails to load in specific environments
  }

  return output;
}
