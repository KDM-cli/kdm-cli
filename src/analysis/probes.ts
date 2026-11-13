/**
 * Dependency Probes — KDM v4.0.0
 *
 * Implements Task 18.1:
 * Non-blocking, bounded dependency checks for Python 3 runtime and Ollama HTTP service.
 */

import { getAIConfig } from '../config/store';
import { isPythonAgentAvailable } from '../agent/python-bridge';

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_PROBE_TIMEOUT_MS = 1000;

/**
 * Resolves the configured base URL for the local Ollama provider.
 */
export function resolveOllamaBaseUrl(): string {
  try {
    const aiConfig = getAIConfig();
    const ollamaProvider = aiConfig?.providers?.find(
      (p) => p.name.toLowerCase() === 'ollama'
    );
    if (ollamaProvider?.baseUrl) {
      return ollamaProvider.baseUrl;
    }
  } catch {
    // Fall back to default if store is unavailable
  }
  return DEFAULT_OLLAMA_BASE_URL;
}

/**
 * Checks whether the local Ollama HTTP service is reachable within a bounded ping timeout.
 *
 * @param baseUrl Base URL of the Ollama service (default: http://localhost:11434).
 * @param timeoutMs Ping timeout in milliseconds (default: 1000ms).
 * @param fetchFn Optional fetch implementation override (for testing).
 * @returns Promise resolving to true if Ollama is reachable, false otherwise.
 */
export async function isOllamaAvailable(
  baseUrl: string = resolveOllamaBaseUrl(),
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(normalizedBase, {
      method: 'GET',
      signal: controller.signal,
    });
    return Boolean(res && (res.ok || res.status < 500));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface DependencyCheckResult {
  pythonAvailable: boolean;
  ollamaAvailable: boolean;
  canRunCouncil: boolean;
  degradationReason?: string;
}

/**
 * Executes unified dependency probe checks for the Multi-Agent Council.
 */
export async function checkCouncilDependencies(
  baseUrl: string = resolveOllamaBaseUrl(),
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
  customProbes?: {
    pythonCheck?: () => Promise<boolean>;
    ollamaCheck?: (url: string, timeout: number) => Promise<boolean>;
  }
): Promise<DependencyCheckResult> {
  const pythonCheck = customProbes?.pythonCheck ?? isPythonAgentAvailable;
  const ollamaCheck = customProbes?.ollamaCheck ?? isOllamaAvailable;

  const [pythonAvailable, ollamaAvailable] = await Promise.all([
    pythonCheck().catch(() => false),
    ollamaCheck(baseUrl, timeoutMs).catch(() => false),
  ]);

  if (!ollamaAvailable) {
    return {
      pythonAvailable,
      ollamaAvailable,
      canRunCouncil: false,
      degradationReason: `Local Ollama service is unreachable (${baseUrl})`,
    };
  }

  if (!pythonAvailable) {
    return {
      pythonAvailable,
      ollamaAvailable,
      canRunCouncil: false,
      degradationReason: 'Python 3 or ollama package is not available',
    };
  }

  return {
    pythonAvailable: true,
    ollamaAvailable: true,
    canRunCouncil: true,
  };
}
