import { Command } from 'commander';
import { logger } from '../utils/logger';

export const registerShowCommand = (program: Command) => {
  program
    .command('show <target>')
    .description('Show running runners, pods, or containers')
    .action((target) => {
      logger.info(`Showing ${target}...`);
      // Future: Implementation for showing specific targets
    });
};
