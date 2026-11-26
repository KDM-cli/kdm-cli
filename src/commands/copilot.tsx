/**
 * Copilot Command — KDM CLI
 * Launches the interactive Gemini + Multi-Agent SRE Copilot Shell.
 */

import React from 'react';
import { Command } from 'commander';
import { render } from 'ink';
import { CopilotShell } from '../ui/CopilotShell.js';

export const registerCopilotCommand = (program: Command) => {
  program
    .command('copilot [resource]')
    .alias('agent')
    .alias('chat')
    .description('Interactive AI SRE Copilot Shell with Gemini & Multi-Agent Council')
    .option('-t, --tab <number>', 'Initial tab (1: Monitor, 2: Agents, 3: Diffs, 4: Settings)', '1')
    .action(async (resource, options) => {
      // Clear terminal screen before launching the shell
      process.stdout.write('\x1Bc');

      const initialTab = parseInt(options.tab, 10) || 1;
      let appInstance: any = null;

      const handleExit = () => {
        appInstance?.unmount();
        process.exit(0);
      };

      appInstance = render(
        <CopilotShell
          targetResource={resource}
          initialTab={initialTab}
          onExit={handleExit}
        />
      );

      await appInstance?.waitUntilExit?.();
    });
};
