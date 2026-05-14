import { Command } from 'commander';
import { logger } from '../utils/logger';
import { createSpinner } from '../ui/spinner';

export const registerLogsCommand = (program: Command) => {
  program
    .command('logs <name>')
    .description('Show logs for a container or pod')
    .action(async (name) => {
      const spinner = createSpinner(`Fetching logs for ${name}...`).start();
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 500));
      spinner.stop(`Logs for ${name} fetched`);
      logger.info(`Showing logs for ${name}...`);
    });
};
