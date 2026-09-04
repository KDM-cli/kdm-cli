import { program } from 'commander';
import chalk from 'chalk';
import { checkDockerConnection } from '../docker/client';
import { checkK8sConnection } from '../kubernetes/client';
import { checkMinikubeConnection } from '../minikube/client';
import { registerShowCommand } from './show';
import { registerHealthCommand } from './health';
import { registerWatchCommand } from './watch';
import { registerLogsCommand } from './logs';
import { registerConfigCommand } from './config';
import { registerAnalyzeCommand } from './analyze';
import { registerFiltersCommand } from './filters';
import { registerAuthCommand } from './auth';
import { registerCacheCommand } from './cache';
import { registerServeCommand } from './serve';
import { registerCustomAnalyzerCommand } from './custom-analyzer';
import { logger } from '../utils/logger';
import { showWelcomeBanner } from '../ui/banner';
import { createSpinner } from '../ui/spinner';
import { checkForUpdates, getInstalledVersion } from '../utils/version-check';
import { registerIntegrations } from '../integrations/integrations';

const VERSION = getInstalledVersion();

program
  .name('kdm')
  .description('Kubernetes and Docker Monitoring CLI')
  .version(VERSION);

// Register modular commands
registerShowCommand(program);
registerHealthCommand(program);
registerWatchCommand(program);
registerLogsCommand(program);
registerConfigCommand(program);
registerAnalyzeCommand(program);
registerFiltersCommand(program);
registerAuthCommand(program);
registerCacheCommand(program);
registerServeCommand(program);
registerCustomAnalyzerCommand(program);

// Register integration analyzers
registerIntegrations();

import React from 'react';
import { render } from 'ink';
import { InitialDashboard } from '../ui/InitialDashboard';

/**
 * Renders connection status badges and resource metrics in non-interactive mode.
 * @param dockerStatus Result from checkDockerConnection.
 * @param k8sStatus Result from checkK8sConnection.
 * @param minikubeStatus Result from checkMinikubeConnection.
 */
function printStatusBadges(
  dockerStatus: { connected: boolean; containerCount: number },
  k8sStatus: { connected: boolean; podCount: number },
  minikubeStatus: { installed: boolean; running: boolean }
): void {
  const badge = (text: string, color: 'green' | 'red' | 'yellow') => {
    const styles = {
      green: chalk.bgGreen.black.bold,
      red: chalk.bgRed.white.bold,
      yellow: chalk.bgYellow.black.bold,
    };
    return styles[color](` ${text} `);
  };

  const dockerStr = dockerStatus.connected ? badge('CONNECTED', 'green') : badge('DISCONNECTED', 'red');
  const k8sStr = k8sStatus.connected ? badge('CONNECTED', 'green') : badge('DISCONNECTED', 'red');

  let minikubeStr = badge('NOT INSTALLED', 'red');
  if (minikubeStatus.installed) {
    minikubeStr = minikubeStatus.running ? badge('RUNNING', 'green') : badge('STOPPED', 'yellow');
  }

  console.log(`${chalk.bold('Docker:')}      ${dockerStr}`);
  console.log(`${chalk.bold('Kubernetes:')}  ${k8sStr}`);
  console.log(`${chalk.bold('Minikube:')}    ${minikubeStr}\n`);

  console.log(`${chalk.cyan('󰡨')} Running Containers: ${chalk.yellow.bold(dockerStatus.containerCount)}`);
  console.log(`${chalk.blue('󱔎')} Running Pods:       ${chalk.yellow.bold(k8sStatus.podCount)}`);
  console.log(`${chalk.red('󰒑')} Unhealthy Services: ${chalk.yellow.bold('0')} (Mocked)\n`);
  console.log(chalk.bold('Commands:\n'));
  console.log(`  kdm show runners\n  kdm health all\n  kdm watch\n  kdm logs <name>\n`);
}

/**
 * Runs the fallback non-interactive connection check and prints output.
 */
async function runNonInteractiveSummary(): Promise<void> {
  showWelcomeBanner(VERSION);
  const spinner = createSpinner('Checking connections...').start();
  let hadError = false;
  try {
    const [dockerStatus, k8sStatus, minikubeStatus] = await Promise.all([
      checkDockerConnection(),
      checkK8sConnection(),
      checkMinikubeConnection(),
    ]);
    spinner.stop('Connection check complete');
    console.log();
    printStatusBadges(dockerStatus, k8sStatus, minikubeStatus);
  } catch (error) {
    hadError = true;
    spinner.fail(`Connection check failed: ${(error as Error).message}`);
  } finally {
    program.outputHelp();
    process.exit(hadError ? 1 : 0);
  }
}

/**
 * Launches the interactive InitialDashboard TUI.
 */
async function launchInteractiveDashboard(): Promise<void> {
  process.stdout.write('\x1Bc');
  const instance = render(
    React.createElement(InitialDashboard, {
      version: VERSION,
      onSelect: async (cmdArgs: string[]) => {
        instance.unmount();
        process.stdout.write('\x1Bc');
        try {
          if (cmdArgs.length === 0) {
            process.exit(0);
          } else if (cmdArgs.includes('--help')) {
            program.outputHelp();
            process.exit(0);
          } else {
            await program.parseAsync(['node', 'kdm', ...cmdArgs]);
          }
        } catch (error) {
          console.error(chalk.red(`Command failed: ${(error as Error).message}`));
          process.exit(1);
        }
      },
      onExit: () => {
        instance.unmount();
        process.exit(0);
      },
    })
  );
  await instance.waitUntilExit();
}

const run = async () => {
  if (!process.argv.slice(2).length) {
    if (process.stdout.isTTY && process.stdin.isTTY) {
      await launchInteractiveDashboard();
      return;
    }
    await runNonInteractiveSummary();
    return;
  }

  program.parse(process.argv);

  // Non-blocking version check (fires after command execution)
  checkForUpdates();
};

run();

