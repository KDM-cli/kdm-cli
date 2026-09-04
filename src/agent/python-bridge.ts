/**
 * Bridge between KDM CLI (Node.js) and the Python Ollama Multi-Agent Council.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { ConsensusDiagnosis, AgentProgressEvent } from './types';

/**
 * Execution parameters for the Python agent council.
 */
export interface CouncilExecutionParams {
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
  /** Optional callback invoked on agent progress events. */
  onProgress?: (event: AgentProgressEvent) => void;
  /** Optional custom spawn function (primarily for testing). */
  spawnFn?: typeof spawn;
}

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
 */
function getCouncilScriptPath(): string {
  // In development and production, agents/ directory is located at repository root
  return path.resolve(process.cwd(), 'agents', 'council.py');
}

/**
 * Processes incoming NDJSON lines from the Python child process.
 */
function processEventLine(
  line: string,
  onProgress?: (event: AgentProgressEvent) => void
): { consensus?: ConsensusDiagnosis; error?: string } {
  const trimmed = line.trim();
  if (!trimmed) return {};

  try {
    const data = JSON.parse(trimmed);
    if (data.type === 'progress' && onProgress) {
      onProgress({
        role: data.role,
        agentName: data.agent,
        status: data.status,
        message: data.message,
        icon: data.icon,
      });
    } else if (data.type === 'complete') {
      return { consensus: data.consensus as ConsensusDiagnosis };
    } else if (data.type === 'error') {
      return { error: data.message };
    }
  } catch {
    // Ignore non-JSON lines (e.g. standard warnings)
  }
  return {};
}

/**
 * Executes the Python Multi-Agent Council using the Ollama Python SDK.
 * Streams real-time progress events over NDJSON and returns the consensus diagnosis.
 *
 * @param params Execution parameters.
 * @returns Promise resolving to the consensus diagnosis.
 */
export async function runPythonAgentCouncil(
  params: CouncilExecutionParams
): Promise<ConsensusDiagnosis> {
  const scriptPath = getCouncilScriptPath();
  const spawnImpl = params.spawnFn || spawn;

  return new Promise((resolve, reject) => {
    const proc = spawnImpl('python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let consensusResult: ConsensusDiagnosis | null = null;
    let errorMessage: string | null = null;

    const rl = readline.createInterface({ input: proc.stdout });

    rl.on('line', (line) => {
      const result = processEventLine(line, params.onProgress);
      if (result.consensus) {
        consensusResult = result.consensus;
      }
      if (result.error) {
        errorMessage = result.error;
      }
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (consensusResult) {
        resolve(consensusResult);
        return;
      }
      const failureReason = errorMessage || stderr || `Python agent exited with code ${code}`;
      reject(new Error(failureReason));
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Python agent runner: ${err.message}`));
    });

    // Write input payload to stdin and close stream
    const payload = JSON.stringify({
      failureText: params.failureText,
      context: params.context,
      model: params.model || 'llama3.1',
      baseUrl: params.baseUrl || 'http://localhost:11434',
    });

    proc.stdin.write(payload);
    proc.stdin.end();
  });
}
