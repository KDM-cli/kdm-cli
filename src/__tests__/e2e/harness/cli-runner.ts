import { Command } from 'commander';
import { vi } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerShowCommand } from '../../../commands/show';
import { registerHealthCommand } from '../../../commands/health';
import { registerWatchCommand } from '../../../commands/watch';
import { registerLogsCommand } from '../../../commands/logs';
import { registerConfigCommand } from '../../../commands/config';
import { registerAnalyzeCommand } from '../../../commands/analyze';
import { registerFiltersCommand } from '../../../commands/filters';
import { registerAuthCommand } from '../../../commands/auth';
import { registerCacheCommand } from '../../../commands/cache';
import { registerServeCommand } from '../../../commands/serve';
import { registerCustomAnalyzerCommand } from '../../../commands/custom-analyzer';
import { registerIntegrations } from '../../../integrations/integrations';
import { getInstalledVersion } from '../../../utils/version-check';
import { checkDockerConnection } from '../../../docker/client';
import { checkK8sConnection } from '../../../kubernetes/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../../../');

export interface CLIExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunCLIOptions {
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/**
 * Creates a fresh, isolated Commander instance with all KDM commands registered,
 * exitOverride() enabled, and no global side-effects.
 */
export function createE2EProgram(): Command {
  const program = new Command();
  const version = getInstalledVersion();

  program
    .name('kdm')
    .description('Kubernetes and Docker Monitoring CLI')
    .version(version)
    .exitOverride()
    .action(async () => {
      if (process.stdout.isTTY && process.stdin.isTTY) {
        // TTY interactive mode
        console.log('Launching interactive copilot shell...');
      } else {
        // Non-interactive fallback summary
        try {
          const [dockerRes, k8sRes] = await Promise.allSettled([
            checkDockerConnection(),
            checkK8sConnection(),
          ]);
          console.log('KDM Non-Interactive Status Summary:');
          console.log(
            `Docker: ${dockerRes.status === 'fulfilled' && dockerRes.value ? 'Connected' : 'Disconnected'}`
          );
          console.log(
            `Kubernetes: ${k8sRes.status === 'fulfilled' && k8sRes.value ? 'Connected' : 'Disconnected'}`
          );
          program.outputHelp();
        } catch {
          // ignore in fallback
        }
      }
    });

  registerShowCommand(program);
  registerHealthCommand(program);
  registerWatchCommand(program);
  registerLogsCommand(program);
  registerConfigCommand(program);
  registerAnalyzeCommand(program);
  registerFiltersCommand(program);
  registerAuthCommand(program);
  registerCacheCommand(program);
  registerServeCommand(program);
  registerCustomAnalyzerCommand(program);

  registerIntegrations();

  return program;
}

/**
 * Executes a CLI command string in-process with full stream capture and process.exit protection.
 */
export async function runCLI(
  args: string[],
  options: RunCLIOptions = {}
): Promise<CLIExecutionResult> {
  const program = createE2EProgram();
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalStdinIsTTY = process.stdin.isTTY;

  if (options.isTTY !== undefined) {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: options.isTTY,
      configurable: true,
    });
    Object.defineProperty(process.stdin, 'isTTY', {
      value: options.isTTY,
      configurable: true,
    });
  }

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...msgs: unknown[]) => {
    stdout += msgs.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ') + '\n';
  });

  const errSpy = vi.spyOn(console, 'error').mockImplementation((...msgs: unknown[]) => {
    stderr += msgs.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ') + '\n';
  });

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...msgs: unknown[]) => {
    stderr += msgs.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ') + '\n';
  });

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const stdoutWriteSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: any, encoding?: any, cb?: any) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString(encoding);
      stdout += str;
      if (typeof cb === 'function') cb();
      return true;
    }) as any);

  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const stderrWriteSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: any, encoding?: any, cb?: any) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString(encoding);
      stderr += str;
      if (typeof cb === 'function') cb();
      return true;
    }) as any);

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = typeof code === 'number' ? code : 0;
    const err: any = new Error(`process.exit(${exitCode})`);
    err.exitCode = exitCode;
    throw err;
  }) as any);

  try {
    await program.parseAsync(['node', 'kdm', ...args]);
  } catch (err: any) {
    if (err.exitCode !== undefined) {
      exitCode = err.exitCode;
    } else if (err.code === 'commander.helpDisplayed') {
      exitCode = 0;
    } else if (err.code === 'commander.version') {
      exitCode = 0;
    } else if (exitCode === 0) {
      exitCode = 1;
    }
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    exitSpy.mockRestore();

    if (options.isTTY !== undefined) {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalStdoutIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalStdinIsTTY,
        configurable: true,
      });
    }
  }

  return { stdout, stderr, exitCode };
}

/**
 * Executes the compiled KDM CLI binary as an external child process (black-box).
 */
export function execCLI(
  args: string[],
  options: { timeout?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {}
): Promise<CLIExecutionResult> {
  const binaryPath = path.join(ROOT_DIR, 'bin', 'kdm.js');
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [binaryPath, ...args],
      {
        cwd: options.cwd || ROOT_DIR,
        timeout: options.timeout || 15000,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          ...options.env,
        },
      },
      (error, stdout, stderr) => {
        const exitCode = error ? (error.code as number) || error.signal ? 1 : (error as any).status ?? 1 : 0;
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: typeof error?.code === 'number' ? error.code : exitCode,
        });
      }
    );
  });
}
