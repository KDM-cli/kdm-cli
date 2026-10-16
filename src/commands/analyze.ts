import { Command } from 'commander';
import chalk from 'chalk';
import { runAnalysis } from '../analysis/analysis';
import { formatJsonOutput, formatTextOutput } from '../analysis/output';
import type { AnalysisOptions } from '../analysis/types';
import { createSpinner } from '../ui/spinner';
import { logger } from '../utils/logger';
import { exportIncidentAudit, type IncidentAuditSession } from '../utils/audit-exporter';
import { AnalyzeDashboard } from '../ui/AnalyzeDashboard';
import { render } from 'ink';
import React from 'react';

/**
 * Helper to collect multiple filter flags from the CLI options into an array.
 * @param value The newly passed filter option.
 * @param previous Accumulator list of previously collected filters.
 * @returns Array containing all collected filters.
 */
const collectFilter = (value: string, previous: string[]) => [...previous, value];

/**
 * Validates and normalizes the output format choice.
 * @param output The user-selected output format string.
 * @returns The validated output format 'json' or 'text'.
 * @throws An Error if the format is invalid.
 */
const parseOutput = (output: string): AnalysisOptions['output'] => {
  if (output === 'json' || output === 'text') return output;
  throw new Error('Output format must be either "text" or "json"');
};

/**
 * Parses a custom headers string into a key-value record.
 * Expected format: "Key1:Value1,Key2:Value2".
 * @param value The raw custom headers string.
 * @param previous Previously accumulated headers.
 * @returns Headers record.
 */
const parseCustomHeaders = (
  value: string,
  previous: Record<string, string>,
): Record<string, string> => {
  const result = { ...previous };
  for (const pair of value.split(',')) {
    const idx = pair.indexOf(':');
    if (idx > 0) {
      result[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return result;
};

/**
 * Builds the analysis configuration options from the CLI raw options.
 * @param options CLI parsed options.
 * @param signal AbortSignal for cancellation.
 * @returns Configured AnalysisOptions.
 */
const buildAnalysisOptions = (options: any, signal: AbortSignal): AnalysisOptions => ({
  filters: options.filter?.length ? options.filter : undefined,
  namespace: options.namespace,
  labelSelector: options.selector,
  output: parseOutput(options.output),
  maxConcurrency: Number.parseInt(options.maxConcurrency, 10),
  withStats: Boolean(options.withStat),
  withDocs: Boolean(options.withDoc),
  kubeconfig: options.kubeconfig,
  kubecontext: options.kubecontext,
  signal,
  explain: Boolean(options.explain),
  backend: options.backend,
  language: options.language,
  anonymize: Boolean(options.anonymize),
  customHeaders: options.customHeaders,
  noCache: Boolean(options.noCache),
  interactive: options.output !== 'json',
  exportAudit: options.exportAudit,
});

/**
 * Formats and prints the analysis result to standard output.
 * @param result The analysis result.
 * @param output Output format ('json' | 'text').
 */
const printAnalysisResult = (result: any, output: AnalysisOptions['output']): void => {
  if (output === 'json') {
    console.log(formatJsonOutput(result));
  } else {
    console.log(formatTextOutput(result));
  }
};

/**
 * Resolves target workload descriptor from primary analysis result or options.
 */
function resolveIncidentTarget(primaryResult: any, runOpts: AnalysisOptions) {
  return {
    kind: primaryResult?.kind || 'Workload',
    name: primaryResult?.name || runOpts.labelSelector || runOpts.namespace || 'all',
    namespace: primaryResult?.namespace || runOpts.namespace || 'default',
  };
}

/**
 * Resolves consensus diagnosis or fallback diagnostic problem summary.
 */
function resolveConsensus(primaryResult: any, problems: number) {
  if (primaryResult?.consensus) return primaryResult.consensus;
  if (problems > 0) {
    return {
      rootCause: primaryResult?.message || 'Workload problem detected',
      confidence: 'high',
    };
  }
  return {
    rootCause: 'No problems detected',
    confidence: 'high',
  };
}

/**
 * Exports a structured, sanitized incident audit session file if requested.
 * @param exportPath Destination JSON file path.
 * @param runOpts Configured analysis options.
 * @param result Analysis output results.
 */
async function handleExportAudit(
  exportPath: string,
  runOpts: AnalysisOptions,
  result: any,
): Promise<void> {
  const primaryResult = result.results?.[0];
  const target = resolveIncidentTarget(primaryResult, runOpts);
  const consensus = resolveConsensus(primaryResult, result.problems || 0);

  const session: IncidentAuditSession = {
    sessionId: `an-${Date.now()}`,
    cliVersion: '4.0.0',
    target,
    evidence: result.results?.flatMap((r: any) => r.evidence || []) || {},
    toolCalls: result.toolCalls || [],
    consensus,
  };

  await exportIncidentAudit(exportPath, session);
  logger.success(`Incident audit exported to ${exportPath}`);
}

/**
 * Handles errors occurred during the analysis run, logging them and setting process exit code.
 * @param error The thrown error.
 * @param output Output format ('json' | 'text').
 * @param spinner The spinner instance to fail.
 */
const handleAnalysisError = (
  error: unknown,
  output: AnalysisOptions['output'],
  spinner: ReturnType<typeof createSpinner> | null,
): void => {
  const errMsg = (error as Error).message || String(error);
  spinner?.fail(`Analysis failed: ${errMsg}`);
  if (output === 'json') {
    logger.error(JSON.stringify({ error: errMsg }, null, 2));
  } else {
    logger.error(chalk.red(`Analysis failed: ${errMsg}`));
  }
  process.exitCode = 1;
};

/**
 * Handler for the analyze CLI command execution.
 * @param options CLI parsed options configuration.
 */
async function handleAnalyze(options: any): Promise<void> {
  let output: AnalysisOptions['output'] = 'text';
  let spinner: ReturnType<typeof createSpinner> | null = null;

  const abortController = new AbortController();
  const onSigint = () => {
    abortController.abort();
    spinner?.fail('Analysis cancelled');
    process.exitCode = 130;
  };
  process.on('SIGINT', onSigint);

  try {
    output = parseOutput(options.output);
    const runOpts = buildAnalysisOptions(options, abortController.signal);

    if (output === 'json') {
      const result = await runAnalysis(runOpts);
      if (options.exportAudit) {
        await handleExportAudit(options.exportAudit, runOpts, result);
      }
      printAnalysisResult(result, 'json');
      return;
    }

    spinner = createSpinner('Analyzing Kubernetes resources...').start();
    const result = await runAnalysis(runOpts);
    spinner.stop('Analysis complete');

    if (options.exportAudit) {
      await handleExportAudit(options.exportAudit, runOpts, result);
    }

    process.stdout.write('\x1Bc');
    const app = render(React.createElement(AnalyzeDashboard, { initialOptions: runOpts, initialResult: result }));
    await app?.waitUntilExit?.();
  } catch (error) {
    handleAnalysisError(error, output, spinner);
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

/**
 * Registers the `analyze` command and its options on the Commander program.
 * @param program Commander program instance.
 */
export const registerAnalyzeCommand = (program: Command) => {
  program
    .command('analyze')
    .alias('analyse')
    .description('Analyze Kubernetes resources for common workload problems')
    .option('-n, --namespace <namespace>', 'Namespace to analyze')
    .option('-L, --selector <selector>', 'Label selector to filter Kubernetes resources')
    .option('-f, --filter <filter>', 'Analyzer filter to run, such as Pod or Deployment', collectFilter, [])
    .option('-o, --output <format>', 'Output format: text or json', 'text')
    .option('-m, --max-concurrency <number>', 'Maximum number of analyzers to run concurrently', '10')
    .option('-s, --with-stat', 'Print analyzer execution stats')
    .option('--with-doc', 'Reserve Kubernetes documentation lookup for analyzer output')
    .option('--kubeconfig <path>', 'Path to kubeconfig file')
    .option('--kubecontext <context>', 'Kubernetes context to use')
    .option('-e, --explain', 'Enable AI-powered explanations for detected problems')
    .option('-b, --backend <backend>', 'AI backend provider to use (e.g. openai, ollama, noop)')
    .option('-l, --language <lang>', 'Language for AI responses', 'english')
    .option('-a, --anonymize', 'Anonymize sensitive resource names in AI prompts')
    .option('-r, --custom-headers <headers>', 'Custom HTTP headers (Key:Value,Key2:Value2)', parseCustomHeaders, {})
    .option('-c, --no-cache', 'Skip cache for AI explanations')
    .option('--export-audit <path>', 'Export sanitized incident audit trail to a JSON file')
    .action(handleAnalyze);
};
