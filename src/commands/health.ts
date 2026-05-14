import { Command } from 'commander';
import { logger } from '../utils/logger';
import { createSpinner } from '../ui/spinner';

export const registerHealthCommand = (program: Command) => {
  program
    .command('health <target>')
    .description('Show health status for pods or containers')
    .action(async (target) => {
      const spinner = createSpinner(`Checking health for ${target}...`).start();
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 1000));
      spinner.stop(`Health check for ${target} complete`);
      logger.info(`Showing health for ${target}...`);
    });
};
