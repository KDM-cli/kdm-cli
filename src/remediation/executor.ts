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
 * Data payload for recording an audit entry.
 */
export interface AuditRecordPayload {
  result: ExecutionResult;
  command: string;
  executable: string;
  args: string[];
}

/**
 * Payload used to construct an ExecutionResult.
 */
export interface ExecutionPayload {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  command?: string;
  rollbackCommand?: string;
}

/**
 * Common shape for Node.js process execution errors.
 */
interface ProcessError {
  code?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  message?: unknown;
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

  record(payload: AuditRecordPayload): RemediationAuditRecord {
    const record: RemediationAuditRecord = {
      auditId: `audit-rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      command: payload.command,
      executable: payload.executable,
      args: payload.args,
      success: payload.result.success,
      exitCode: payload.result.exitCode,
      stdout: payload.result.stdout,
      stderr: payload.result.stderr,
      durationMs: payload.result.durationMs,
      rollbackCommand: payload.result.rollbackCommand,
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
  const parts = matches.map((token) => {
    if (token.startsWith('"') && token.endsWith('"')) {
      return token.slice(1, -1);
    }
    if (token.startsWith("'") && token.endsWith("'")) {
      return token.slice(1, -1);
    }
    return token;
  });

  const file = parts[0] || '';
  const args = parts.slice(1);
  return { file, args };
}

/**
 * Safely casts an unknown error into a ProcessError structure.
 */
function asProcessError(err: unknown): ProcessError | null {
  if (!err) {
    return null;
  }
  if (typeof err !== 'object') {
    return null;
  }
  return err as ProcessError;
}

/**
 * Resolves a numeric exit code from an execFile error.
 */
function resolveExitCode(err: ProcessError | null): number {
  if (typeof err?.code === 'number') {
    return err.code;
  }
  return 1;
}

/**
 * Resolves standard error text from an execFile failure.
 */
function resolveStderr(err: ProcessError | null): string {
  if (typeof err?.stderr === 'string') {
    return err.stderr.trim();
  }
  if (typeof err?.message === 'string') {
    return err.message.trim();
  }
  return 'Execution failed';
}

/**
 * Resolves standard output text from an execFile failure.
 */
function resolveStdout(err: ProcessError | null): string {
  if (typeof err?.stdout === 'string') {
    return err.stdout.trim();
  }
  return '';
}

/**
 * Unified factory constructing normalized ExecutionResult instances.
 */
function createResult(payload: ExecutionPayload): ExecutionResult {
  return {
    success: payload.success,
    exitCode: payload.exitCode,
    stdout: payload.stdout.trim(),
    stderr: payload.stderr.trim(),
    durationMs: payload.durationMs,
    command: payload.command,
    rollbackCommand: payload.rollbackCommand,
  };
}

/**
 * Dispatches recording of the execution into the specified or default audit trail.
 */
function recordAuditEntry(
  auditTrail: RemediationAuditTrail | undefined,
  payload: AuditRecordPayload
): void {
  const trail = auditTrail ?? defaultAuditTrail;
  trail.record(payload);
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
    const emptyResult = createResult({
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Command string cannot be empty',
      durationMs: Date.now() - startTime,
      command: commandStr,
      rollbackCommand: rollback,
    });
    recordAuditEntry(options.auditTrail, {
      result: emptyResult,
      command: commandStr,
      executable: file,
      args,
    });
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
    const result = createResult({
      success: true,
      exitCode: 0,
      stdout,
      stderr,
      durationMs: Date.now() - startTime,
      command: commandStr,
      rollbackCommand: rollback,
    });
    recordAuditEntry(options.auditTrail, {
      result,
      command: commandStr,
      executable: file,
      args,
    });
    return result;
  } catch (rawError: unknown) {
    const err = asProcessError(rawError);
    const result = createResult({
      success: false,
      exitCode: resolveExitCode(err),
      stdout: resolveStdout(err),
      stderr: resolveStderr(err),
      durationMs: Date.now() - startTime,
      command: commandStr,
      rollbackCommand: rollback,
    });
    recordAuditEntry(options.auditTrail, {
      result,
      command: commandStr,
      executable: file,
      args,
    });
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
    const details = result.stdout ? `: ${result.stdout}` : '';
    return [`✓ Command succeeded in ${result.durationMs}ms${details}`];
  }

  const errorDetails = result.stderr ? `: ${result.stderr}` : '';
  const lines = [`✖ Command failed (exit code ${result.exitCode})${errorDetails}`];
  const rollback = rollbackCommand || result.rollbackCommand;
  if (rollback) {
    lines.push(`⚠️ Recommended Rollback: ${rollback.trim()}`);
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
