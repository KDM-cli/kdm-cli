import { Command } from 'commander';
import chalk from 'chalk';
import { getRunningContainers } from '../docker/containers';
import { getRunningPods } from '../kubernetes/pods';
import { logger } from '../utils/logger';
import { createSpinner } from '../ui/spinner';
import { renderTable } from '../ui/table';

const healthColor = (status: string) => {
  if (status === 'healthy' || status === 'running' || status === 'Running') {
    return chalk.green(status);
  }

  if (status === 'unhealthy' || status === 'exited' || status === 'Failed') {
    return chalk.red(status);
  }

  return chalk.yellow(status);
};

export const showHealth = async (target: string) => {
  logger.info?.(`Showing health for ${target}...`);

  if (target !== 'all' && target !== 'containers' && target !== 'pods') {
    logger.error?.(`Unknown target: ${target}. Valid targets are: all, pods, containers.`);
    return;
  }

  const spinner = createSpinner(`Checking ${target} health...`).start();

  try {
    const rows: (string | number)[][] = [];

    if (target === 'all' || target === 'containers') {
      const containers = await getRunningContainers();
      rows.push(...containers.map((container) => [
        'container',
        container.name,
        healthColor(container.state),
        container.status,
      ]));
    }

    if (target === 'all' || target === 'pods') {
      const pods = await getRunningPods();
      rows.push(...pods.map((pod) => [
        'pod',
        pod.name,
        healthColor(pod.status),
        `namespace: ${pod.namespace}, restarts: ${pod.restarts}`,
      ]));
    }

    spinner.stop();

    if (rows.length === 0) {
      logger.warn(`No ${target === 'all' ? 'workloads' : target} found.`);
      return;
    }

    renderTable({
      head: ['TYPE', 'NAME', 'HEALTH', 'DETAILS'],
      rows,
    });
  } catch (error) {
    spinner.stop();
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to check ${target} health: ${message}`);
  }
};

export const registerHealthCommand = (program: Command) => {
  program
    .command('health <target>')
    .description('Show health status for pods, containers, or all workloads')
    .action(showHealth);
};
