/**
 * Remediation Tool Executor — KDM v4.0.0
 * =====================================
 * Auditable Remediation Tool Executor that executes user-approved remediation
 * commands safely using parameterized child_process.execFile with stdout/stderr
 * capture, wall-clock duration measurement, rollback recommendation, and
 * in-memory audit trail logging.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Default execution timeout: 30 seconds. */
export const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Result returned after executing a remediation command.
 */
export interface ExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  command?: string;
  rollbackCommand?: string;
}

/**
 * Configuration options for remediation command execution.
 */
export interface ExecutionOptions {
  timeoutMs?: number;
  rollbackCommand?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  execFileFn?: (
    file: string,
    args: string[],
    options: { timeout: number; cwd?: string; env?: NodeJS.ProcessEnv }
  ) => Promise<{ stdout: string; stderr: string }>;
  auditTrail?: RemediationAuditTrail;
}

/**
 * Extended execution options that include an optional terminal printer.
 */
export interface ExecuteWithFeedbackOptions extends ExecutionOptions {
  printFn?: (line: string) => void;
}

/**
 * Immutable audit log record capturing command execution details.
 */
export interface RemediationAuditRecord {
  auditId: string;
  timestamp: string;
  command: string;
  executable: string;
  args: string[];
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  rollbackCommand?: string;
}

/**
 * Thread-safe in-memory audit trail for remediation commands.
 */
export class RemediationAuditTrail {
  private readonly records: RemediationAuditRecord[] = [];

  record(
    result: ExecutionResult,
    command: string,
    executable: string,
    args: string[]
  ): RemediationAuditRecord {
    const record: RemediationAuditRecord = {
      auditId: `audit-rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      command,
      executable,
      args,
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      rollbackCommand: result.rollbackCommand,
    };
    this.records.push(record);
    return record;
  }

  getRecords(): RemediationAuditRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records.length = 0;
  }

  exportJson(indent?: number): string {
    return JSON.stringify(this.records, null, indent);
  }
}

/**
 * Singleton instance of the default audit trail.
 */
export const defaultAuditTrail = new RemediationAuditTrail();

/**
 * Safely strips surrounding quotation marks from a token string.
 */
function stripQuotes(token: string): string {
  const isDoubleQuoted = token.startsWith('"') && token.endsWith('"');
  const isSingleQuoted = token.startsWith("'") && token.endsWith("'");
  if (isDoubleQuoted || isSingleQuoted) {
    return token.slice(1, -1);
  }
  return token;
}

/**
 * Splits a command string into the executable file and argument array,
 * safely preserving quoted arguments and preventing raw shell injection.
 *
 * @param commandStr - The raw command string to tokenize.
 * @returns Object containing executable `file` and `args` array.
 */
export function splitCommand(commandStr: string): { file: string; args: string[] } {
  const trimmed = commandStr.trim();
  if (!trimmed) {
    return { file: '', args: [] };
  }

  const matches = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const parts = matches.map(stripQuotes);
  const file = parts[0] || '';
  const args = parts.slice(1);
  return { file, args };
}

/**
 * Resolves a numeric exit code from an execFile error.
 */
function resolveExitCode(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'number') {
      return code;
    }
  }
  return 1;
}

/**
 * Resolves standard error text from an execFile failure.
 */
function resolveStderr(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const errObj = error as { stderr?: unknown; message?: unknown };
    if (typeof errObj.stderr === 'string' && errObj.stderr.trim()) {
      return errObj.stderr.trim();
    }
    if (typeof errObj.message === 'string' && errObj.message.trim()) {
      return errObj.message.trim();
    }
  }
  return 'Execution failed';
}

/**
 * Resolves standard output text from an execFile failure.
 */
function resolveStdout(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stdout' in error) {
    const stdout = (error as { stdout: unknown }).stdout;
    if (typeof stdout === 'string') {
      return stdout.trim();
    }
  }
  return '';
}

/**
 * Constructs an ExecutionResult representing an empty command error.
 */
function buildEmptyCommandResult(startTime: number, rollbackCommand?: string): ExecutionResult {
  return {
    success: false,
    exitCode: 1,
    stdout: '',
    stderr: 'Command string cannot be empty',
    durationMs: Date.now() - startTime,
    rollbackCommand,
  };
}

/**
 * Constructs an ExecutionResult representing a successful command run.
 */
function buildSuccessResult(
  stdout: string,
  stderr: string,
  startTime: number,
  command?: string,
  rollbackCommand?: string
): ExecutionResult {
  return {
    success: true,
    exitCode: 0,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    durationMs: Date.now() - startTime,
    command,
    rollbackCommand,
  };
}

/**
 * Constructs an ExecutionResult representing a failed command run.
 */
function buildFailureResult(
  error: unknown,
  startTime: number,
  command?: string,
  rollbackCommand?: string
): ExecutionResult {
  return {
    success: false,
    exitCode: resolveExitCode(error),
    stdout: resolveStdout(error),
    stderr: resolveStderr(error),
    durationMs: Date.now() - startTime,
    command,
    rollbackCommand,
  };
}

/**
 * Dispatches recording of the execution into the specified or default audit trail.
 */
function recordAuditEntry(
  auditTrail: RemediationAuditTrail | undefined,
  result: ExecutionResult,
  command: string,
  executable: string,
  args: string[]
): void {
  const trail = auditTrail ?? defaultAuditTrail;
  trail.record(result, command, executable, args);
}

/**
 * Executes a single remediation command safely using parameterized execFile.
 *
 * @param commandStr - Command string to execute (e.g. `kubectl set resources deployment checkout-api --limits=memory=512Mi`).
 * @param options - Optional configuration for timeout, rollback command, custom runner, and audit trail.
 * @returns Promise resolving to ExecutionResult with stdout, stderr, exit code, and duration.
 */
export async function executeRemediationCommand(
  commandStr: string,
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const { file, args } = splitCommand(commandStr);
  const rollback = options.rollbackCommand;

  if (!file) {
    const emptyResult = buildEmptyCommandResult(startTime, rollback);
    recordAuditEntry(options.auditTrail, emptyResult, commandStr, file, args);
    return emptyResult;
  }

  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const execFn = options.execFileFn ?? execFileAsync;

  try {
    const { stdout, stderr } = await execFn(file, args, {
      timeout,
      cwd: options.cwd,
      env: options.env,
    });
    const result = buildSuccessResult(stdout, stderr, startTime, commandStr, rollback);
    recordAuditEntry(options.auditTrail, result, commandStr, file, args);
    return result;
  } catch (error: unknown) {
    const result = buildFailureResult(error, startTime, commandStr, rollback);
    recordAuditEntry(options.auditTrail, result, commandStr, file, args);
    return result;
  }
}

/**
 * Formats the initial "Applying remediation..." terminal banner.
 */
export function formatApplyingFeedback(command: string): string[] {
  return ['⚡ Applying remediation...', `   $ ${command.trim()}`];
}

/**
 * Formats the terminal message for successful command execution.
 */
export function formatSuccessFeedback(durationMs: number, stdout: string): string {
  const details = stdout ? `: ${stdout}` : '';
  return `✓ Command succeeded in ${durationMs}ms${details}`;
}

/**
 * Formats the terminal message for failed command execution.
 */
export function formatFailureFeedback(exitCode: number, stderr: string): string {
  const details = stderr ? `: ${stderr}` : '';
  return `✖ Command failed (exit code ${exitCode})${details}`;
}

/**
 * Formats the recommended rollback command notice.
 */
export function formatRollbackFeedback(rollbackCommand: string): string {
  return `⚠️ Recommended Rollback: ${rollbackCommand.trim()}`;
}

/**
 * Formats full execution feedback lines for terminal display.
 *
 * @param result - The completed command execution result.
 * @param rollbackCommand - Optional rollback command string override.
 * @returns Array of formatted feedback strings.
 */
export function formatExecutionFeedback(
  result: ExecutionResult,
  rollbackCommand?: string
): string[] {
  if (result.success) {
    return [formatSuccessFeedback(result.durationMs, result.stdout)];
  }

  const lines = [formatFailureFeedback(result.exitCode, result.stderr)];
  const rollback = rollbackCommand || result.rollbackCommand;
  if (rollback) {
    lines.push(formatRollbackFeedback(rollback));
  }
  return lines;
}

/**
 * Executes a remediation command and outputs user-facing status feedback.
 *
 * @param commandStr - Command string to execute.
 * @param options - Execution options including rollbackCommand and optional printFn.
 * @returns Promise resolving to ExecutionResult.
 */
export async function executeRemediationWithFeedback(
  commandStr: string,
  options: ExecuteWithFeedbackOptions = {}
): Promise<ExecutionResult> {
  const print = options.printFn ?? console.log;
  for (const line of formatApplyingFeedback(commandStr)) {
    print(line);
  }

  const result = await executeRemediationCommand(commandStr, options);
  for (const line of formatExecutionFeedback(result, options.rollbackCommand)) {
    print(line);
  }

  return result;
}
