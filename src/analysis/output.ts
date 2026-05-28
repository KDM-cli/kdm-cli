import { AnalysisOutput } from './types';
import chalk from 'chalk';

export function formatTextOutput(output: AnalysisOutput): string {
  const lines: string[] = [];

  const redact = (value: string, sensitive?: { unmasked: string; masked: string }[]): string => {
    if (!sensitive?.length) return value;
    return sensitive.reduce(
      (acc, pair) => (pair.unmasked ? acc.split(pair.unmasked).join(pair.masked) : acc),
      value
    );
  };

  // Summary line
  if (output.status === 'OK') {
    lines.push(chalk.green('No problems detected'));
  } else {
    lines.push(
      chalk.yellow(
        `Status: ProblemDetected (${output.problems} ${output.problems === 1 ? 'problem' : 'problems'})`
      )
    );
  }

  // Include provider if explain was used
  if (output.provider) {
    lines.push(`AI Provider: ${chalk.yellow(output.provider)}`);
  }

  // Warnings / Errors
  if (output.errors && output.errors.length > 0) {
    lines.push('');
    lines.push(chalk.yellow('Warnings / Errors:'));
    for (const err of output.errors) {
      lines.push(`- ${chalk.yellow(err)}`);
    }
  }

  if (output.results && output.results.length > 0) {
    lines.push('');
    // Group results by kind
    const grouped = new Map<string, typeof output.results>();
    for (const res of output.results) {
      const list = grouped.get(res.kind) || [];
      list.push(res);
      grouped.set(res.kind, list);
    }

    for (const [kind, results] of grouped.entries()) {
      lines.push(`${chalk.cyan(kind)}s:`);
      for (const res of results) {
        const parentPart = res.parentObject ? `(${res.parentObject})` : '';
        const nsPart = res.namespace ? ` [${res.namespace}]` : '';
        lines.push(`- Name: ${chalk.yellow(res.name)}${nsPart} ${chalk.cyan(parentPart)}`.trim());
        for (const failure of res.errors) {
          lines.push(`  - ${chalk.red('Error:')} ${chalk.red(redact(failure.text, failure.sensitive))}`);
          if (failure.kubernetesDoc) {
            lines.push(
              `    ${chalk.red('Kubernetes Doc:')} ${chalk.red(redact(failure.kubernetesDoc, failure.sensitive))}`
            );
          }
        }
        if (res.details) {
          lines.push(chalk.green(res.details));
        }
      }
    }
  }

  // Format stats if present
  if (output.stats && output.stats.length > 0) {
    lines.push('');
    lines.push(
      chalk.yellow(
        'The stats mode allows for debugging and understanding the time taken by an analysis by displaying the statistics of each analyzer.'
      )
    );
    for (const stat of output.stats) {
      lines.push(`- Analyzer ${chalk.yellow(stat.analyzer)} took ${stat.durationMs}ms`);
    }
  }

  return lines.join('\n');
}

export function formatJsonOutput(output: AnalysisOutput): string {
  return JSON.stringify(output, null, 2);
}
