import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from './types';

const execAsync = promisify(exec);

/** Configuration for a custom analyzer. */
export interface CustomAnalyzerConfig {
  /** Unique name of the custom analyzer. */
  name: string;
  /** External command to execute (mutually exclusive with url). */
  command?: string;
  /** HTTP endpoint URL to call (mutually exclusive with command). */
  url?: string;
}

/**
 * Runs a command-based custom analyzer and converts its output to AnalyzerResult.
 * @param config Custom analyzer configuration.
 * @param context Analyzer context.
 * @returns Array of analyzer results.
 */
async function runCommandAnalyzer(
  config: CustomAnalyzerConfig,
  context: AnalyzerContext,
): Promise<AnalyzerResult[]> {
  try {
    const { stdout } = await execAsync(config.command!, { timeout: 30000 });
    const trimmed = stdout.trim();
    if (!trimmed) {
      return [];
    }
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    return [{
      kind: 'Custom',
      name: config.name,
      errors: [{ text: `Custom analyzer '${config.name}' failed: ${(error as Error).message}` }],
    }];
  }
}

/**
 * Runs an HTTP-based custom analyzer and converts its response to AnalyzerResult.
 * @param config Custom analyzer configuration.
 * @param context Analyzer context.
 * @returns Array of analyzer results.
 */
async function runHTTPAnalyzer(
  config: CustomAnalyzerConfig,
  context: AnalyzerContext,
): Promise<AnalyzerResult[]> {
  try {
    const response = await fetch(config.url!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: context.namespace }),
    });
    if (!response.ok) {
      const statusInfo = response.statusText ? `${response.status} ${response.statusText}` : `${response.status}`;
      throw new Error(`HTTP ${statusInfo}`);
    }
    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) {
      return [];
    }
    const data = JSON.parse(trimmed);
    return Array.isArray(data) ? data as AnalyzerResult[] : [data as AnalyzerResult];
  } catch (error) {
    return [{
      kind: 'Custom',
      name: config.name,
      errors: [{ text: `Custom analyzer '${config.name}' HTTP call failed: ${(error as Error).message}` }],
    }];
  }
}

/**
 * Creates an Analyzer instance from a custom analyzer configuration.
 * Dispatches to either command or HTTP execution.
 * @param config Custom analyzer configuration.
 * @returns Analyzer instance.
 */
export function createCustomAnalyzer(config: CustomAnalyzerConfig): Analyzer {
  return {
    name: config.name,
    async analyze(context: AnalyzerContext): Promise<AnalyzerResult[]> {
      if (config.command) return runCommandAnalyzer(config, context);
      if (config.url) return runHTTPAnalyzer(config, context);
      return [{
        kind: 'Custom',
        name: config.name,
        errors: [{ text: `Custom analyzer '${config.name}' has neither command nor URL` }],
      }];
    },
  };
}
