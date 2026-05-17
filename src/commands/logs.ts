// import { Command } from 'commander';
// import { logger } from '../utils/logger';
// import { createSpinner } from '../ui/spinner';

// export const registerLogsCommand = (program: Command) => {
//   program
//     .command('logs <name>')
//     .description('Show logs for a container or pod')
//     .action(async (name) => {
//       const spinner = createSpinner(`Fetching logs for ${name}...`).start();
//       try {
//         // TODO: Implement actual log fetching logic
//         spinner.stop(`Logs for ${name} fetched`);
//         logger.info(`Showing logs for ${name}...`);
//       } catch (error) {
//         const errorMessage = (error as Error).message;
//         spinner.fail(`Failed to fetch logs for ${name}: ${errorMessage}`);
//         logger.error(`Failed to fetch logs for ${name}: ${errorMessage}`, error);
//         throw error;
//       }
//     });
// };


// updated

import { Command } from 'commander';
import { getDockerClient } from '../docker/client';
import { getK8sApi } from '../kubernetes/client';
import { logger } from '../utils/logger';
import { createSpinner } from '../ui/spinner';

// ✅ CodeRabbit (Nitpick): simplified — Buffer and non-Buffer values both
//    convert correctly with String(), no branch needed
const printStream = (value: unknown): void =>
  void process.stdout.write(String(value));

export const showLogs = async (name: string): Promise<void> => {
  logger.info?.(`Showing logs for ${name}...`);
  const spinner = createSpinner(`Fetching logs for ${name}...`).start();

  // Docker first
  try {
    const docker = getDockerClient();
    const containers = await docker.listContainers({ all: true });

    const match = containers.find(
      (container) =>
        container.Id.startsWith(name) ||
        container.Names.some(
          (containerName) => containerName.replace(/^\//, '') === name,
        ),
    );

    if (match) {
      const output = await docker
        .getContainer(match.Id)
        .logs({ stdout: true, stderr: true, tail: 100 });
      spinner.stop();
      printStream(output);
      return;
    }
  } catch (error) {
    // ✅ CodeRabbit (Minor): log why Docker failed instead of swallowing silently
    logger.debug?.(
      `Docker unavailable, trying Kubernetes: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Kubernetes fallback
  try {
    const api = getK8sApi();
    const pods = await api.listPodForAllNamespaces();
    const pod = pods.body.items.find((item) => item.metadata?.name === name);

    if (!pod?.metadata?.name || !pod.metadata.namespace) {
      spinner.stop();
      logger.error?.(`No container or pod named "${name}" found.`);
      return;
    }

    // ✅ CodeRabbit (Major): use options-object form — NOT 10 positional undefineds
    //    The original: readNamespacedPodLog(name, ns, undef, undef, ... x8 ..., 100)
    //    is fragile; this form is forward-compatible with library version changes.
    const response = await api.readNamespacedPodLog({
      name: pod.metadata.name,
      namespace: pod.metadata.namespace,
      tailLines: 100,
    });

    spinner.stop();
    printStream(response.body);
  } catch (error) {
    spinner.stop();
    const message = error instanceof Error ? error.message : String(error);
    logger.error?.(`Failed to fetch logs for "${name}": ${message}`);
  }
};

export const registerLogsCommand = (program: Command): void => {
  program
    .command('logs <name>')
    .description(
      'Show logs for a container or pod.\n' +
      'Accepts a container ID prefix, container name, or pod name.',
    )
    .action(showLogs);
};