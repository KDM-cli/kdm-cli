/**
 * Bridge between KDM CLI (Node.js) and the Python Ollama Multi-Agent Council.
 *
 * Implements:
 * - Unbuffered execution (python3 -u) with JSON argument passing.
 * - Non-blocking NDJSON streaming via readline.createInterface.
 * - Watchdog timer with SIGTERM and 1.5s delayed SIGKILL escalation.
 * - Signal trapping for SIGINT (Ctrl+C) to prevent zombie processes.
 * - Capture of stderr diagnostic output on non-zero exit codes.
 */

import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseNDJSONLine } from './event-schema';
import type { ConsensusDiagnosis, AgentProgressEvent, NDJSONEvent } from './types';

const DEFAULT_TIMEOUT_MS = 45_000;
const SIGKILL_GRACE_PERIOD_MS = 1_500;
const DEFAULT_MODEL = 'llama3.1';
const DEFAULT_BASE_URL = 'http://localhost:11434';

/**
 * Options for executing the Python agent council subprocess bridge.
 */
export interface CouncilBridgeOptions {
  /** The error or failure message text from the workload. */
  failureText: string;
  /** Contextual workload information (namespace, workload kind, name). */
  context: {
    namespace?: string;
    kind?: string;
    name?: string;
  };
  /** Local Ollama model name (e.g. 'llama3.1'). */
  model?: string;
  /** Base URL for Ollama API (default: 'http://localhost:11434'). */
  baseUrl?: string;
  /** Maximum execution duration in milliseconds before watchdog triggers SIGTERM/SIGKILL (default: 45000). */
  timeoutMs?: number;
  /** Callback invoked on parsed NDJSON streaming events. */
  onEvent?: (event: NDJSONEvent) => void;
  /** Callback invoked on stderr output chunks. */
  onStderr?: (chunk: string) => void;
  /** Optional callback invoked on agent progress events. */
  onProgress?: (event: AgentProgressEvent) => void;
  /** Optional custom spawn function (primarily for testing). */
  spawnFn?: typeof spawn;
}

/**
 * Execution parameters for the Python agent council (backward-compatibility alias).
 */
export interface CouncilExecutionParams extends CouncilBridgeOptions {}

/**
 * Checks whether Python 3 and the official ollama package are available.
 *
 * @param spawnFn Optional custom spawn implementation.
 * @returns Promise resolving to true if Python and ollama are functional.
 */
export async function isPythonAgentAvailable(spawnFn: typeof spawn = spawn): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawnFn('python3', ['-c', 'import ollama'], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Resolves the absolute path to the Python agent council runner script.
 * Prefers the packaged script location by default to prevent untrusted execution (CWE-426).
 * Working directory lookup is permitted only when explicit development opt-in is enabled.
 */
export function getCouncilScriptPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const distPkgPath = path.resolve(currentDir, '..', 'agents', 'council.py');
  const srcPkgPath = path.resolve(currentDir, '..', '..', 'agents', 'council.py');
  const pkgPath = fs.existsSync(distPkgPath) ? distPkgPath : srcPkgPath;

  const allowLocal =
    process.env.KDM_ALLOW_LOCAL_AGENTS === '1' ||
    process.env.KDM_ALLOW_LOCAL_AGENTS === 'true' ||
    process.env.NODE_ENV === 'development';

  if (allowLocal) {
    const cwdPath = path.resolve(process.cwd(), 'agents', 'council.py');
    if (fs.existsSync(cwdPath)) {
      return cwdPath;
    }
  }

  return pkgPath;
}

interface LineParseOutcome {
  ndjsonEvent?: NDJSONEvent;
  consensus?: ConsensusDiagnosis;
  error?: string;
  legacyProgress?: AgentProgressEvent;
}

/**
 * Extracts parsed data from a standard NDJSON protocol event.
 */
function extractNdjsonOutcome(ndjson: NDJSONEvent): LineParseOutcome {
  const outcome: LineParseOutcome = { ndjsonEvent: ndjson };
  if (ndjson.event === 'diagnosis_ready') {
    outcome.consensus = ndjson.consensus;
  } else if (ndjson.event === 'error' && ndjson.fatal) {
    outcome.error = ndjson.message;
  }
  return outcome;
}

/**
 * Extracts legacy progress event payloads from legacy JSON format.
 */
function extractLegacyProgress(raw: Record<string, unknown>): AgentProgressEvent | null {
  if (raw.type === 'progress') {
    return {
      role: raw.role as AgentProgressEvent['role'],
      agentName: String(raw.agent ?? ''),
      status: (raw.status as AgentProgressEvent['status']) || 'running',
      message: String(raw.message ?? ''),
      icon: raw.icon ? String(raw.icon) : undefined,
    };
  }
  if (raw.type === 'agent_completed') {
    const finding = (raw.finding as Record<string, unknown>) || {};
    return {
      role: finding.role as AgentProgressEvent['role'],
      agentName: String(raw.agent ?? ''),
      status: 'completed',
      message: `${raw.agent} finished inspection`,
      icon: finding.icon ? String(finding.icon) : undefined,
    };
  }
  return null;
}

/**
 * Parses legacy JSON protocol format for backward compatibility.
 */
function extractLegacyOutcome(trimmed: string): LineParseOutcome {
  try {
    const raw = JSON.parse(trimmed);
    if (typeof raw !== 'object' || raw === null) return {};

    if (raw.type === 'complete' && raw.consensus) {
      return { consensus: raw.consensus as ConsensusDiagnosis };
    }
    if (raw.type === 'error' && raw.message) {
      return { error: String(raw.message) };
    }
    const legacyProg = extractLegacyProgress(raw as Record<string, unknown>);
    if (legacyProg) {
      return { legacyProgress: legacyProg };
    }
  } catch {
    // Non-JSON diagnostic or warning output
  }
  return {};
}

/**
 * Parses a raw line from stdout, trying Phase 11 NDJSON schema first,
 * with graceful fallback to legacy JSON formats.
 */
function parseStreamLine(line: string): LineParseOutcome {
  const trimmed = line.trim();
  if (!trimmed) return {};

  const ndjson = parseNDJSONLine(trimmed);
  if (ndjson) {
    return extractNdjsonOutcome(ndjson);
  }

  return extractLegacyOutcome(trimmed);
}

/**
 * Converts Phase 11 NDJSON events into legacy AgentProgressEvents for UI loaders.
 */
function ndjsonToProgressEvent(event: NDJSONEvent): AgentProgressEvent | null {
  switch (event.event) {
    case 'agent_start':
      return {
        role: event.role,
        agentName: event.role,
        status: 'running',
        message: event.message,
      };
    case 'agent_progress':
      return {
        role: event.role as AgentProgressEvent['role'],
        agentName: event.role,
        status: 'running',
        message: event.message,
      };
    case 'agent_complete':
      return {
        role: event.role as AgentProgressEvent['role'],
        agentName: event.role,
        status: 'completed',
        message: event.summary,
      };
    case 'agent_failed':
      return {
        role: event.role as AgentProgressEvent['role'],
        agentName: event.role,
        status: 'failed',
        message: event.error,
      };
    default:
      return null;
  }
}

/**
 * Manages child process timeout watchdogs, SIGKILL escalation, and SIGINT cleanup.
 */
class ProcessLifecycleWatcher {
  private watchdogTimer: NodeJS.Timeout | null = null;
  private killTimer: NodeJS.Timeout | null = null;
  private sigintListener: (() => void) | null = null;
  private isTerminated = false;
  private hasTimedOut = false;
  private hasReceivedSigint = false;

  constructor(
    private readonly proc: ChildProcess,
    private readonly timeoutMs: number,
    private readonly onTermination: (reason: 'timeout' | 'sigint') => void
  ) {
    this.armWatchdog();
    this.trapSigint();
  }

  private armWatchdog(): void {
    if (this.timeoutMs > 0 && Number.isFinite(this.timeoutMs)) {
      this.watchdogTimer = setTimeout(() => {
        this.hasTimedOut = true;
        this.terminate();
        this.onTermination('timeout');
      }, this.timeoutMs);

      if (this.watchdogTimer.unref) {
        this.watchdogTimer.unref();
      }
    }
  }

  private trapSigint(): void {
    this.sigintListener = () => {
      this.hasReceivedSigint = true;
      this.terminate();
      this.onTermination('sigint');
    };
    process.on('SIGINT', this.sigintListener);
  }

  public terminate(): void {
    if (this.isTerminated) return;
    this.isTerminated = true;

    this.sendSignal('SIGTERM');

    this.killTimer = setTimeout(() => {
      this.sendSignal('SIGKILL');
    }, SIGKILL_GRACE_PERIOD_MS);

    if (this.killTimer.unref) {
      this.killTimer.unref();
    }
  }

  private sendSignal(signal: 'SIGTERM' | 'SIGKILL'): void {
    try {
      if (typeof this.proc.kill === 'function') {
        this.proc.kill(signal);
      }
    } catch {
      // Process may already have terminated
    }
  }

  public removeSigintTrap(): void {
    if (this.sigintListener) {
      process.removeListener('SIGINT', this.sigintListener);
      this.sigintListener = null;
    }
  }

  public cleanup(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    this.removeSigintTrap();
  }

  public get timedOut(): boolean {
    return this.hasTimedOut;
  }

  public get sigintReceived(): boolean {
    return this.hasReceivedSigint;
  }
}

/**
 * Writes JSON payload to process stdin and gracefully ends stream.
 */
function writePayloadToStdin(proc: ChildProcess, payload: string): void {
  if (proc.stdin && typeof proc.stdin.write === 'function' && !proc.stdin.destroyed) {
    proc.stdin.on?.('error', () => {
      // Child closed stdin early; close/exit handling reports the failure.
    });
    try {
      proc.stdin.write(payload);
      proc.stdin.end();
    } catch {
      // Safe fallback if stream closed or mocked without write
    }
  }
}

/**
 * Builds diagnostic error message from process exit parameters and stderr.
 */
function buildCloseErrorMessage(
  code: number | null,
  signal: NodeJS.Signals | null,
  errorMessage: string | null,
  stderr: string
): string {
  if (errorMessage) return errorMessage;
  const trimmedStderr = stderr.trim();
  if (trimmedStderr) return trimmedStderr;
  if (code !== null) {
    return `Python agent exited with code ${code} without producing a consensus diagnosis`;
  }
  return `Python agent terminated by signal ${signal ?? 'unknown'}`;
}

/**
 * Spawns and supervises the Python Multi-Agent Council subprocess.
 *
 * Enforces:
 * - Unbuffered execution (`python3 -u`) with JSON payload argument.
 * - Non-blocking NDJSON streaming via `readline.createInterface`.
 * - Watchdog timer with `SIGTERM` and 1.5s delayed `SIGKILL` escalation.
 * - Instant child process termination on `SIGINT` (Ctrl+C).
 * - Real-time error capturing from `stderr` on non-zero exit.
 *
 * @param options Council bridge execution options.
 * @returns Promise resolving to the final consensus diagnosis.
 */
export async function runAgentCouncilProcess(
  options: CouncilBridgeOptions
): Promise<ConsensusDiagnosis> {
  const scriptPath = getCouncilScriptPath();
  const spawnImpl = options.spawnFn || spawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const payload = JSON.stringify({
    failureText: options.failureText,
    context: options.context,
    ...(options.model ? { model: options.model } : {}),
    baseUrl: options.baseUrl || DEFAULT_BASE_URL,
  });

  return new Promise<ConsensusDiagnosis>((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawnImpl('python3', ['-u', scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (spawnErr) {
      reject(new Error(`Failed to spawn Python agent runner: ${(spawnErr as Error).message}`));
      return;
    }

    let isSettled = false;
    let consensusResult: ConsensusDiagnosis | null = null;
    let errorMessage: string | null = null;
    let stderr = '';

    const safeResolve = (consensus: ConsensusDiagnosis) => {
      if (isSettled) return;
      isSettled = true;
      watcher.cleanup();
      resolve(consensus);
    };

    const safeReject = (err: Error) => {
      if (isSettled) return;
      isSettled = true;
      watcher.removeSigintTrap();
      reject(err);
    };

    const watcher = new ProcessLifecycleWatcher(proc, timeoutMs, (reason) => {
      const err =
        reason === 'timeout'
          ? new Error(`Python agent council timed out after ${timeoutMs}ms`)
          : new Error('Python agent council terminated by SIGINT');
      safeReject(err);
    });

    writePayloadToStdin(proc, payload);

    if (proc.stderr) {
      proc.stderr.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        stderr += text;
        options.onStderr?.(text);
      });
    }

    if (proc.stdout) {
      const rl = readline.createInterface({
        input: proc.stdout,
        crlfDelay: Infinity,
      });

      rl.on('line', (line: string) => {
        const outcome = parseStreamLine(line);
        if (outcome.ndjsonEvent) {
          options.onEvent?.(outcome.ndjsonEvent);
          if (options.onProgress) {
            const prog = ndjsonToProgressEvent(outcome.ndjsonEvent);
            if (prog) options.onProgress(prog);
          }
        }
        if (outcome.legacyProgress && options.onProgress) {
          options.onProgress(outcome.legacyProgress);
        }
        if (outcome.consensus) {
          consensusResult = outcome.consensus;
          safeResolve(consensusResult);
        }
        if (outcome.error) {
          errorMessage = outcome.error;
        }
      });
    }

    proc.on('close', (code, signal) => {
      setImmediate(() => {
        watcher.cleanup();
        if (isSettled) return;

        if (consensusResult) {
          safeResolve(consensusResult);
          return;
        }

        safeReject(new Error(buildCloseErrorMessage(code, signal, errorMessage, stderr)));
      });
    });

    proc.on('error', (err) => {
      watcher.cleanup();
      safeReject(new Error(`Failed to spawn Python agent runner: ${err.message}`));
    });
  });
}

/**
 * Executes the Python Multi-Agent Council using the Ollama Python SDK.
 * Backward-compatible wrapper delegating to {@link runAgentCouncilProcess}.
 *
 * @param params Execution parameters.
 * @returns Promise resolving to the consensus diagnosis.
 */
export async function runPythonAgentCouncil(
  params: CouncilExecutionParams
): Promise<ConsensusDiagnosis> {
  return runAgentCouncilProcess(params);
}
