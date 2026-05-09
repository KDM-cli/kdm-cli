import React from 'react';
import { Command } from 'commander';
import { render } from 'ink';
import { WatchDashboard } from '../ui/WatchDashboard';

export const registerWatchCommand = (program: Command) => {
  program
    .command('watch')
    .description('Live monitoring mode using Ink dashboard')
    .action(() => {
      // Clear terminal screen before showing the dashboard
      process.stdout.write('\x1Bc');
      render(<WatchDashboard />);
    });
};
