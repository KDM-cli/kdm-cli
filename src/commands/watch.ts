import { Command } from 'commander';
import { logger } from '../utils/logger';

export const registerWatchCommand = (program: Command) => {
  program
    .command('watch')
    .description('Live monitoring mode')
    .action(() => {
      logger.info('Starting live monitoring...');
    });
};
