import React from 'react';
import { Command } from 'commander';
import { render } from 'ink';
import { HealthDashboard } from '../ui/HealthDashboard';
import { logger } from '../utils/logger';

export const registerHealthCommand = (program: Command): void => {
  program
    .command('health <target>')
    .description(
      'Show health status for pods, containers, or all workloads.\n' +
      'Valid targets: all | containers | pods',
    )
    .option('-w, --watch', 'Watch mode: continuously refresh health output')
    .option('-i, --interval <number>', 'Refresh interval in seconds', '5')
    .action(async (target, options) => {
      const validTargets = ['all', 'containers', 'pods'];
      if (!validTargets.includes(target)) {
        logger.error?.(
          `Unknown target: ${target}. Valid targets are: ${validTargets.join(', ')}.`,
        );
        process.exitCode = 1;
        return;
      }
      
      const intervalVal = parseInt(options.interval, 10) || 5;

      // Clear terminal screen before showing the dashboard
      process.stdout.write('\x1Bc');
      render(<HealthDashboard initialTarget={target} initialWatch={!!options.watch} initialInterval={intervalVal} />);
    });
};