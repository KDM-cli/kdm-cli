# [DevBounty AI]: File optimized for resolution.



```javascript
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
      try {
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
      } catch (error) {
        logger.error(`An error occurred: ${error.message}`);
      }
    });
};

const showContainers = async () => {
  const spinner = createSpinner('Fetching Docker containers...').start();
  try {
    const containers = await getRunningContainers();
    spinner.stop();

    if (containers.length === 0) {
      logger.warn('No running Docker containers found or Docker is not running.');
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
    spinner.stop();
    logger.error(`Failed to fetch Docker containers: ${error.message}`);
  }
};

const showPods = async () => {
  const spinner = createSpinner('Fetching Kubernetes pods...').start();
  try {
    const pods = await getRunningPods();
    spinner.stop();

    if (pods.length === 0) {
      logger.warn('No running Kubernetes pods found or cluster is unreachable.');
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
    spinner.stop();
    logger.error(`Failed to fetch Kubernetes pods: ${error.message}`);
  }
};

const showRunners = async () => {
  const spinner = createSpinner('Fetching runners (Containers + Pods)...').start();
  try {
    const [containers, pods] = await Promise.all([
      getRunningContainers(),
      getRunningPods()
    ]);
    spinner.stop();

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
  } catch (error) {
    spinner.stop();
    logger.error(`Failed to fetch runners: ${error.message}`);
  }
};

const showMinikube = async () => {
  const spinner = createSpinner('Fetching Minikube status...').start();
  try {
    const conn = await checkMinikubeConnection();
    if (!conn.installed) {
      spinner.stop();
      logger.warn('Minikube is not installed on this system.');
      return;
    }
    
    const statusList = await getMinikubeStatus();
    spinner.stop();

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
  } catch (error) {
    spinner.stop();
    logger.error(`Failed to fetch Minikube status: ${error.message}`);
  }
};