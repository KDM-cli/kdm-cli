import { Command } from 'commander';
import { getDockerClient } from '../docker/client';
import { getK8sApi } from '../kubernetes/client';
import { logger } from '../utils/logger';
import { createSpinner } from '../ui/spinner';

const printStream = (value: unknown) => {
  if (Buffer.isBuffer(value)) {
    process.stdout.write(value.toString());
    return;
  }

  process.stdout.write(String(value));
};

export const showLogs = async (name: string) => {
  logger.info?.(`Showing logs for ${name}...`);
  const spinner = createSpinner(`Fetching logs for ${name}...`).start();

  try {
    const docker = getDockerClient();
    const containers = await docker.listContainers({ all: true });
    const match = containers.find((container) =>
      container.Id.startsWith(name) ||
      container.Names.some((containerName) => containerName.replace(/^\//, '') === name)
    );

    if (match) {
      const output = await docker.getContainer(match.Id).logs({ stdout: true, stderr: true, tail: 100 });
      spinner.stop();
      printStream(output);
      return;
    }
  } catch {
    // Fall through to Kubernetes logs when Docker is unavailable or has no match.
  }

  try {
    const api = getK8sApi();
    const pods = await api.listPodForAllNamespaces();
    const pod = pods.body.items.find((item) => item.metadata?.name === name);

    if (!pod?.metadata?.name || !pod.metadata.namespace) {
      spinner.stop();
      logger.error?.(`No container or pod named ${name} found.`);
      return;
    }

    const response = await api.readNamespacedPodLog(pod.metadata.name, pod.metadata.namespace, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 100);
    spinner.stop();
    printStream(response.body);
  } catch (error) {
    spinner.stop();
    const message = error instanceof Error ? error.message : String(error);
    logger.error?.(`Failed to fetch logs for ${name}: ${message}`);
  }
};

export const registerLogsCommand = (program: Command) => {
  program
    .command('logs <name>')
    .description('Show logs for a container or pod')
    .action(showLogs);
};
