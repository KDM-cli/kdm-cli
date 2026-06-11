// import { Command } from 'commander';
// import { logger } from '../utils/logger';
// import { createSpinner } from '../ui/spinner';

// export const registerHealthCommand = (program: Command) => {
//   program
//     .command('health <target>')
//     .description('Show health status for pods or containers')
//     .action(async (target) => {
//       const spinner = createSpinner(`Checking health for ${target}...`).start();
//       try {
//         // TODO: Implement actual health check logic
//         spinner.stop(`Health check for ${target} complete`);
//         logger.info(`Showing health for ${target}...`);
//       } catch (error) {
//         const errorMessage = (error as Error).message;
//         spinner.fail(`Health check for ${target} failed: ${errorMessage}`);
//         logger.error(`Health check for ${target} failed: ${errorMessage}`, error);
//         throw error;
//       }
//     });
// };


// updated

import { Command } from 'commander';
import chalk from 'chalk';
import { getRunningContainers, type ContainerData } from '../docker/containers';
import { getRunningPods, type PodData } from '../kubernetes/pods';
import { logger } from '../utils/logger';
import { createSpinner } from '../ui/spinner';
import { renderTable } from '../ui/table';

export interface HealthOptions {
  watch?: boolean;
  interval?: string;
  signal?: AbortSignal;
}

const healthColor = (status: string): string => {
  if (status === 'healthy' || status === 'running' || status === 'Running') {
    return chalk.green(status);
  }
  if (status === 'unhealthy' || status === 'exited' || status === 'Failed') {
    return chalk.red(status);
  }
  return chalk.yellow(status);
};

const getContainerRows = (
  result: PromiseSettledResult<ContainerData[]>,
  shouldFetch: boolean
): (string | number)[][] => {
  if (!shouldFetch) return [];
  if (result.status === 'fulfilled') {
    return result.value.map((container) => [
      'container',
      container.name,
      healthColor(container.state),
      container.status,
    ]);
  }
  const message = result.reason instanceof Error
    ? result.reason.message
    : String(result.reason);
  logger.warn?.(`Docker unavailable: ${message}`);
  return [];
};

const getPodRows = (
  result: PromiseSettledResult<PodData[]>,
  shouldFetch: boolean
): (string | number)[][] => {
  if (!shouldFetch) return [];
  if (result.status === 'fulfilled') {
    return result.value.map((pod) => [
      'pod',
      pod.name,
      healthColor(pod.status),
      `namespace: ${pod.namespace}, restarts: ${pod.restarts}`,
    ]);
  }
  const message = result.reason instanceof Error
    ? result.reason.message
    : String(result.reason);
  logger.warn?.(`Kubernetes unavailable: ${message}`);
  return [];
};

const fetchHealthRows = async (target: string, options?: { forceAlert?: boolean }): Promise<(string | number)[][]> => {
  const shouldFetchContainers = target === 'all' || target === 'containers';
  const shouldFetchPods = target === 'all' || target === 'pods';

  const [containerResult, podResult] = await Promise.allSettled([
    shouldFetchContainers ? getRunningContainers({ forceAlert: options?.forceAlert }) : Promise.resolve([]),
    shouldFetchPods ? getRunningPods({ forceAlert: options?.forceAlert }) : Promise.resolve([]),
  ]);

  return [
    ...getContainerRows(containerResult, shouldFetchContainers),
    ...getPodRows(podResult, shouldFetchPods),
  ];
};

export const showHealth = async (target: string, options: HealthOptions = {}): Promise<void> => {
  logger.info?.(`Showing health for ${target}...`);

  const validTargets = ['all', 'containers', 'pods'];
  if (!validTargets.includes(target)) {
    logger.error?.(
      `Unknown target: ${target}. Valid targets are: ${validTargets.join(', ')}.`,
    );
    process.exitCode = 1;
    return;
  }

  if (options.watch) {
    const intervalStr = options.interval || '5';
    if (!/^\d+$/.test(intervalStr)) {
      logger.error?.('Invalid interval. Please provide a positive integer number of seconds.');
      process.exitCode = 1;
      return;
    }
    const intervalSeconds = parseInt(intervalStr, 10);
    if (intervalSeconds <= 0) {
      logger.error?.('Invalid interval. Please provide a positive integer number of seconds.');
      process.exitCode = 1;
      return;
    }

    let isRunning = true;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      isRunning = false;
      if (timer) {
        clearTimeout(timer);
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', cleanup);
      }
    };

    if (options.signal) {
      if (options.signal.aborted) {
        cleanup();
        return;
      }
      options.signal.addEventListener('abort', cleanup);
    }

    const poll = async () => {
      if (!isRunning || (options.signal && options.signal.aborted)) {
        cleanup();
        return;
      }

      const rows = await fetchHealthRows(target, { forceAlert: true });

      // Clear terminal screen
      process.stdout.write('\x1Bc');

      const timestamp = new Date().toLocaleTimeString();
      logger.info?.(
        chalk.bold.cyan(`[KDM Health] Target: ${target} | Last updated: ${timestamp} (Interval: ${intervalSeconds}s)`)
      );
      logger.info?.(chalk.dim('Press Ctrl+C to exit\n'));

      if (rows.length === 0) {
        logger.warn?.(`No ${target === 'all' ? 'workloads' : target} found.`);
      } else {
        renderTable({
          head: ['TYPE', 'NAME', 'HEALTH', 'DETAILS'],
          rows,
        });
      }

      if (isRunning && (!options.signal || !options.signal.aborted)) {
        timer = setTimeout(poll, intervalSeconds * 1000);
      } else {
        cleanup();
      }
    };

    await poll();
  } else {
    const spinner = createSpinner(`Checking ${target} health...`).start();
    const rows = await fetchHealthRows(target, { forceAlert: true });
    spinner.stop();

    if (rows.length === 0) {
      logger.warn?.(`No ${target === 'all' ? 'workloads' : target} found.`);
      return;
    }

    renderTable({
      head: ['TYPE', 'NAME', 'HEALTH', 'DETAILS'],
      rows,
    });
  }
};

export const registerHealthCommand = (program: Command): void => {
  program
    .command('health <target>')
    .description(
      'Show health status for pods, containers, or all workloads.\n' +
      'Valid targets: all | containers | pods',
    )
    .option('-w, --watch', 'Watch mode: continuously refresh health output')
    .option('-i, --interval <number>', 'Refresh interval in seconds', '5')
    .action(async (target, options) => {
      if (options.watch) {
        const controller = new AbortController();
        const sigintHandler = () => {
          controller.abort();
          process.exit(0);
        };
        process.once('SIGINT', sigintHandler);
        process.once('SIGTERM', sigintHandler);

        try {
          await showHealth(target, { ...options, signal: controller.signal });
        } finally {
          process.off('SIGINT', sigintHandler);
          process.off('SIGTERM', sigintHandler);
        }
      } else {
        await showHealth(target, options);
      }
    });
};