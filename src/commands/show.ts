import { Command } from 'commander';
import { logger } from '../utils/logger';
import { createSpinner } from '../ui/spinner';
import { renderTable } from '../ui/table';
import { getRunningContainers } from '../docker/containers';
import { getRunningPods } from '../kubernetes/pods';
import { getMinikubeStatus, checkMinikubeConnection } from '../minikube/client';
import chalk from 'chalk';

export const registerShowCommand = (program: Command) => {
  program
    .command('show <target>')
    .description('Show running runners, pods, containers, or minikube')
    .action(async (target) => {
      if (target === 'containers') {
        await showContainers();
      } else if (target === 'pods') {
        await showPods();
      } else if (target === 'runners') {
        await showRunners();
      } else if (target === 'minikube') {
        await showMinikube();
      } else {
        logger.error(`Unknown target: ${target}. Valid targets are: runners, pods, containers, minikube.`);
      }
    });
};

export const showContainers = async () => {
  const spinner = createSpinner('Fetching Docker containers...').start();
  try {
    const containers = await getRunningContainers();
    spinner.stop('Docker containers fetched successfully');

    if (containers.length === 0) {
      logger.warn('No running Docker containers found.');
      return;
    }

    renderTable({
      head: ['CONTAINER ID', 'NAME', 'IMAGE', 'STATUS', 'STATE'],
      rows: containers.map((c) => [
        c.id,
        c.name,
        c.image.substring(0, 30) + (c.image.length > 30 ? '...' : ''),
        c.status,
        c.state === 'running' ? chalk.green(c.state) : chalk.red(c.state),
      ]),
    });
  } catch (error) {
    spinner.fail('Failed to fetch Docker containers');
    // Error is already logged by getRunningContainers
  }
};

export const showPods = async () => {
  const spinner = createSpinner('Fetching Kubernetes pods...').start();
  try {
    const pods = await getRunningPods();
    spinner.stop('Kubernetes pods fetched successfully');

    if (pods.length === 0) {
      logger.warn('No running Kubernetes pods found.');
      return;
    }

    renderTable({
      head: ['POD NAME', 'NAMESPACE', 'STATUS', 'RESTARTS', 'NODE'],
      rows: pods.map((p) => [
        p.name,
        p.namespace,
        p.status === 'Running' ? chalk.green(p.status) : chalk.yellow(p.status),
        p.restarts > 0 ? chalk.red(p.restarts) : chalk.green('0'),
        p.node,
      ]),
    });
  } catch (error) {
    spinner.fail('Failed to fetch Kubernetes pods');
    // Error is already logged by getRunningPods
  }
};

export const showRunners = async () => {
  const spinner = createSpinner('Fetching runners (Containers + Pods)...').start();
  
  const [containerRes, podRes] = await Promise.allSettled([
    getRunningContainers(),
    getRunningPods()
  ]);
  
  const anyFailed = containerRes.status === 'rejected' || podRes.status === 'rejected';
  if (anyFailed) {
    spinner.warn('Some runners could not be fetched');
  } else {
    spinner.stop('Runners fetched successfully');
  }

  const containers = containerRes.status === 'fulfilled' ? containerRes.value : [];
  const pods = podRes.status === 'fulfilled' ? podRes.value : [];

  if (containerRes.status === 'rejected') {
    logger.warn('Docker is unreachable, showing only Kubernetes pods (if any).');
  }
  if (podRes.status === 'rejected') {
    logger.warn('Kubernetes is unreachable, showing only Docker containers (if any).');
  }

  if (containers.length === 0 && pods.length === 0) {
    logger.warn('No running containers or pods found.');
    return;
  }

  renderTable({
    head: ['TYPE', 'NAME / ID', 'NAMESPACE / IMAGE', 'STATUS', 'NODE / STATE'],
    rows: [
      ...pods.map((p) => [
        chalk.blue('Pod'),
        p.name,
        p.namespace,
        p.status === 'Running' ? chalk.green(p.status) : chalk.yellow(p.status),
        p.node,
      ]),
      ...containers.map((c) => [
        chalk.cyan('Container'),
        c.name,
        c.image.substring(0, 30) + (c.image.length > 30 ? '...' : ''),
        c.status,
        c.state === 'running' ? chalk.green(c.state) : chalk.red(c.state),
      ])
    ],
  });
};

const showMinikube = async () => {
  const spinner = createSpinner('Fetching Minikube status...').start();
  const conn = await checkMinikubeConnection();
  if (!conn.installed) {
    spinner.fail('Minikube is not installed on this system');
    return;
  }
  
  const statusList = await getMinikubeStatus();
  spinner.stop('Minikube status fetched successfully');

  if (statusList.length === 0) {
    logger.warn('No Minikube profiles found or status is unknown.');
    return;
  }

  renderTable({
    head: ['NAME', 'HOST', 'KUBELET', 'APISERVER', 'MESSAGE'],
    rows: statusList.map((s) => [
      s.Name || '-',
      s.Host === 'Running' ? chalk.green(s.Host) : (s.Host === 'Stopped' ? chalk.red(s.Host) : chalk.yellow(s.Host || '-')),
      s.Kubelet === 'Running' ? chalk.green(s.Kubelet) : chalk.yellow(s.Kubelet || '-'),
      s.APIServer === 'Running' ? chalk.green(s.APIServer) : chalk.yellow(s.APIServer || '-'),
      s.Message || '-',
    ]),
  });
};
