import { Command } from 'commander';
import { logger } from '../utils/logger';

export const registerLogsCommand = (program: Command) => {
  program
    .command('logs <name>')
    .description('Show logs for a container or pod')
    .action((name) => {
      logger.info(`Showing logs for ${name}...`);
    });
};
