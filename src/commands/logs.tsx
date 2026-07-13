import React from 'react';
import { Command } from 'commander';
import { render } from 'ink';
import { LogsDashboard } from '../ui/LogsDashboard';

export const registerLogsCommand = (program: Command): void => {
  program
    .command('logs [name]')
    .description(
      'Show logs for a container or pod.\n' +
      'Accepts an optional container ID prefix, container name, or pod name.',
    )
    .action((name) => {
      // Clear terminal screen before showing the dashboard
      process.stdout.write('\x1Bc');
      render(<LogsDashboard initialName={name} />);
    });
};