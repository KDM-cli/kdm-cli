import { Command } from 'commander';
import chalk from 'chalk';
import { createServer } from '../server/server';
import { runDashboard } from '../ui/dashboard';
import { startMCPServer } from '../server/mcp';
import { logger } from '../utils/logger';

/**
 * Helper to collect multiple filter flags for serve command.
 * @param value The newly passed filter option.
 * @param previous Accumulator list of previously collected filters.
 * @returns Array containing all collected filters.
 */
const collectFilter = (value: string, previous: string[]) => [...previous, value];

/**
 * Handler for the serve command in HTTP mode.
 * @param options CLI parsed options.
 */
async function handleHTTPServe(options: any): Promise<void> {
  const port = Number.parseInt(options.port, 10);
  logger.info(`Launching interactive dashboard for KDM on port ${port}...`);

  try {
    // Launch the interactive Ink dashboard which will manage start/stop/restart
    await runDashboard({
      port,
      backend: options.backend,
      filter: options.filter?.length ? options.filter : undefined,
    } as any);
  } catch (error) {
    logger.error(`Dashboard failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

/**
 * Handler for the serve command in MCP mode.
 */
async function handleMCPServe(): Promise<void> {
  await startMCPServer();
}

/**
 * Registers the `serve` command and its options on the Commander program.
 * @param program Commander program instance.
 */
export const registerServeCommand = (program: Command) => {
  program
    .command('serve')
    .description('Start KDM in server mode (HTTP or MCP)')
    .option('-p, --port <port>', 'HTTP server port', '8080')
    .option('--metrics-port <port>', 'Metrics server port')
    .option('-b, --backend <backend>', 'Default AI backend provider')
    .option('--http', 'Force HTTP mode (default)')
    .option('-f, --filter <filter>', 'Default analyzer filter', collectFilter, [])
    .option('--mcp', 'Start in MCP (Model Context Protocol) mode')
    .action(async (options) => {
      if (options.mcp) {
        await handleMCPServe();
      } else {
        await handleHTTPServe(options);
      }
    });
};
