import { Command } from 'commander';
import { logger } from '../utils/logger';

export const registerHealthCommand = (program: Command) => {
  program
    .command('health <target>')
    .description('Show health status for pods or containers')
    .action((target) => {
      logger.info(`Showing health for ${target}...`);
    });
};
