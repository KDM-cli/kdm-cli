import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig, setConfigValue } from '../config/store';
import { createCustomAnalyzer, type CustomAnalyzerConfig } from '../analyzers/custom';
import { registry } from '../analyzers';
import { logger } from '../utils/logger';
import React from 'react';
import { render } from 'ink';
import { CustomAnalyzerDashboard } from '../ui/CustomAnalyzerDashboard';

/**
 * Retrieves the current custom analyzer configurations from the store.
 * @returns Array of custom analyzer configs.
 */
const getCustomAnalyzers = (): CustomAnalyzerConfig[] =>
  (getConfig() as any).customAnalyzers ?? [];

/**
 * Persists custom analyzer configurations to the store.
 * @param analyzers Array of custom analyzer configs.
 */
const saveCustomAnalyzers = (analyzers: CustomAnalyzerConfig[]): void => {
  setConfigValue('customAnalyzers' as any, analyzers as any);
};

/**
 * Handles the `kdm custom-analyzer add` command.
 * @param name Analyzer name.
 * @param options CLI parsed options.
 */
async function handleAdd(name: string, options: any): Promise<void> {
  const existing = getCustomAnalyzers();
  if (existing.find((a) => a.name === name)) {
    logger.error(`Custom analyzer '${name}' already exists`);
    process.exitCode = 1;
    return;
  }

  const config: CustomAnalyzerConfig = {
    name,
    command: options.command,
    url: options.url,
  };

  if (!config.command && !config.url) {
    logger.error('Must provide either --command or --url');
    process.exitCode = 1;
    return;
  }

  existing.push(config);
  saveCustomAnalyzers(existing);
  registry.register(createCustomAnalyzer(config));
  logger.success(`Custom analyzer '${name}' added`);
}

/**
 * Handles the `kdm custom-analyzer list` command.
 */
async function handleList(): Promise<void> {
  const analyzers = getCustomAnalyzers();
  if (analyzers.length === 0) {
    logger.info('No custom analyzers configured');
    return;
  }
  console.log(chalk.cyan('\nCustom Analyzers:\n'));
  for (const a of analyzers) {
    const type = a.command ? `command: ${a.command}` : `url: ${a.url}`;
    console.log(`  ${chalk.yellow(a.name)} (${type})`);
  }
  console.log();
}

/**
 * Handles the `kdm custom-analyzer remove` command.
 * @param name Analyzer name to remove.
 */
async function handleRemove(name: string): Promise<void> {
  const existing = getCustomAnalyzers();
  const filtered = existing.filter((a) => a.name !== name);
  if (filtered.length === existing.length) {
    logger.warn(`Custom analyzer '${name}' not found`);
    process.exitCode = 1;
    return;
  }
  saveCustomAnalyzers(filtered);
  logger.success(`Custom analyzer '${name}' removed`);
}

/**
 * Registers the `custom-analyzer` command group on the Commander program.
 * @param program Commander program instance.
 */
export const registerCustomAnalyzerCommand = (program: Command) => {
  const cmd = program
    .command('custom-analyzer')
    .description('Manage custom analyzers')
    .action(() => {
      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        logger.error('Interactive custom analyzer dashboard requires a TTY terminal.');
        process.exitCode = 1;
        return;
      }
      process.stdout.write('\x1Bc');
      const instance = render(
        React.createElement(CustomAnalyzerDashboard, {
          analyzers: getCustomAnalyzers(),
          onAdd: (config) => {
            const analyzers = getCustomAnalyzers();
            analyzers.push(config);
            saveCustomAnalyzers(analyzers);
            registry.register(createCustomAnalyzer(config));
          },
          onRemove: (name) => {
            saveCustomAnalyzers(getCustomAnalyzers().filter((analyzer) => analyzer.name !== name));
          },
        }),
      );
      return instance.waitUntilExit();
    });

  cmd
    .command('add <name>')
    .description('Register a new custom analyzer')
    .option('--command <cmd>', 'External command to execute')
    .option('--url <url>', 'HTTP endpoint URL to call')
    .action(handleAdd);

  cmd
    .command('list')
    .description('List all registered custom analyzers')
    .action(handleList);

  cmd
    .command('remove <name>')
    .description('Remove a custom analyzer')
    .action(handleRemove);
};
