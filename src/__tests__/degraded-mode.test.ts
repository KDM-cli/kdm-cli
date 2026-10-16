/**
 * Fault Injection & Graceful Degradation Test Suite — KDM v4.0.0
 *
 * Implements Task 18.3 (Issue #289):
 * Verifies the 4-step Fallback Ladder under simulated system failures:
 * - Missing Python runtime (isPythonAgentAvailable -> false)
 * - Ollama HTTP connection refused / timeout (ECONNREFUSED)
 * - Multi-Agent Council subprocess crashes
 * - Inconclusive rule fallbacks to legacy cloud AI and raw K8s summaries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AnalyzerResult } from '../analyzers/types';
import { registry } from '../analyzers';
import {
  explainSingleResult,
  runAnalysis,
  isOllamaAvailable,
  checkCouncilDependencies,
  RuleEngine,
} from '../analysis/analysis';
import * as pythonBridge from '../agent/python-bridge';
import * as probesModule from '../analysis/probes';
import * as factoryModule from '../ai/factory';
import { logger } from '../utils/logger';
import { clearConfig, setAIConfig } from '../config/store';

// ─── Test Fixtures & Helpers ──────────────────────────────────────────────────

function createProblemResult(
  kind: string,
  name: string,
  errorText: string,
  namespace = 'production'
): AnalyzerResult {
  return {
    kind,
    name,
    namespace,
    errors: [{ text: errorText }],
  };
}

const OOM_KILLED_FAILURE =
  'Container "checkout" terminated with exit code 137 (OOMKilled). Last restart 2 minutes ago. Restart count: 4. Memory limit: 256Mi.';

const CRASH_LOOP_FAILURE =
  'Container "api" is in CrashLoopBackOff. Application exit code 1. Restart count: 8.';

const IMAGE_PULL_FAILURE =
  'Failed to pull image "registry.example.com/api:v2.1": rpc error: code = Unknown desc = Error response from daemon: repository does not exist. ImagePullBackOff.';

const UNKNOWN_FAILURE =
  'Workload state unknown: internal custom RPC timeout communicating with external sidecar daemon.';

async function explainDegradedProblem(
  kind: string,
  name: string,
  failureText: string,
  deps: Partial<probesModule.CouncilDependencies> = {}
): Promise<AnalyzerResult> {
  const resolvedDeps: probesModule.CouncilDependencies = {
    pythonAvailable: false,
    ollamaAvailable: false,
    canRunCouncil: false,
    degradationReason: 'Local Ollama service is unreachable (http://localhost:11434)',
    ...deps,
  };
  vi.spyOn(probesModule, 'checkCouncilDependencies').mockResolvedValue(resolvedDeps);

  const result = createProblemResult(kind, name, failureText);
  await explainSingleResult({
    result,
    backend: 'ollama',
    language: 'english',
    shouldAnonymize: false,
    noCache: true,
  });
  return result;
}

describe('Graceful Degradation & Fallback Ladder (Phase 18)', () => {
  let loggerInfoSpy: ReturnType<typeof vi.spyOn>;
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearConfig();
    registry.clear();
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Task 18.1: Dependency Probes ───────────────────────────────────────────

  describe('Task 18.1: Dependency Probes', () => {
    it('isOllamaAvailable returns true when HTTP ping returns 200', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      } as any);

      const available = await isOllamaAvailable('http://localhost:11434', 500, mockFetch as any);
      expect(available).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('isOllamaAvailable returns false when fetch rejects with ECONNREFUSED', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));

      const available = await isOllamaAvailable('http://localhost:11434', 500, mockFetch as any);
      expect(available).toBe(false);
    });

    it('isOllamaAvailable returns false when HTTP probe exceeds timeout', async () => {
      const mockFetch = vi.fn().mockImplementation((_url, opts) => {
        return new Promise((_, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            reject(new Error('The operation was aborted due to timeout'));
          });
        });
      });

      const available = await isOllamaAvailable('http://localhost:11434', 50, mockFetch as any);
      expect(available).toBe(false);
    });

    it('checkCouncilDependencies identifies missing Python runtime', async () => {
      const deps = await checkCouncilDependencies('http://localhost:11434', 100, {
        pythonCheck: async () => false,
        ollamaCheck: async () => true,
      });

      expect(deps.canRunCouncil).toBe(false);
      expect(deps.pythonAvailable).toBe(false);
      expect(deps.ollamaAvailable).toBe(true);
      expect(deps.degradationReason).toContain('Python 3');
    });

    it('checkCouncilDependencies identifies unreachable Ollama service', async () => {
      const deps = await checkCouncilDependencies('http://localhost:11434', 100, {
        pythonCheck: async () => true,
        ollamaCheck: async () => false,
      });

      expect(deps.canRunCouncil).toBe(false);
      expect(deps.ollamaAvailable).toBe(false);
      expect(deps.degradationReason).toContain('Local Ollama service is unreachable');
    });
  });

  // ─── Task 18.2 & 18.3: Fault Injection Tests ───────────────────────────────

  describe('Task 18.2 & 18.3: Degradation Ladder & Fault Injection', () => {
    it('simulates missing Python -> cleanly falls back to Deterministic Rule Engine', async () => {
      const result = await explainDegradedProblem('Deployment', 'checkout-api', OOM_KILLED_FAILURE, {
        pythonAvailable: false,
        ollamaAvailable: true,
        degradationReason: 'Python 3 or ollama package is not available',
      });

      expect(result.fallbackBadge).toBe('DETERMINISTIC RULE MODE');
      expect(result.fallbackStep).toBe('rule_engine');
      expect(result.fallbackReason).toContain('Python 3');
      expect(result.details).toContain('✔ Root Cause Identified: Container Out-Of-Memory (OOMKilled)');
      expect(result.details).toContain("Exit code 137 detected in container 'checkout'");
      expect(result.details).toContain('Memory limit 256Mi exceeded');
      expect(result.details).toContain('Confidence: 100%');
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Python 3 or ollama package is not available')
      );
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Running in Deterministic Rule Mode')
      );
    });

    it('simulates Ollama connection refused -> cleanly falls back to Deterministic Rule Engine', async () => {
      const result = await explainDegradedProblem('Pod', 'api-server', CRASH_LOOP_FAILURE, {
        pythonAvailable: true,
        ollamaAvailable: false,
      });

      expect(result.fallbackBadge).toBe('DETERMINISTIC RULE MODE');
      expect(result.fallbackStep).toBe('rule_engine');
      expect(result.fallbackReason).toContain('Local Ollama service is unreachable');
      expect(result.details).toContain('✔ Root Cause Identified: Container CrashLoopBackOff');
      expect(result.details).toContain("Container 'api' repeatedly crashing on startup");
      expect(result.details).toContain('Exit code 1 detected');
      expect(result.details).toContain('Restart count: 8');
      expect(result.details).toContain('Confidence: 100%');
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Local Ollama service is unreachable')
      );
    });

    it('simulates ImagePull failure under Ollama outage -> triggers ImagePull rule', async () => {
      const result = await explainDegradedProblem('Pod', 'web-frontend', IMAGE_PULL_FAILURE);

      expect(result.fallbackBadge).toBe('DETERMINISTIC RULE MODE');
      expect(result.details).toContain('ImagePull');
      expect(result.details).toContain('Failed to pull container image');
      expect(result.details).toContain('Confidence: 100%');
    });

    it('simulates Council subprocess crash -> safely degrades to Deterministic Rule Engine', async () => {
      vi.spyOn(pythonBridge, 'isPythonAgentAvailable').mockResolvedValue(true);
      vi.spyOn(pythonBridge, 'runPythonAgentCouncil').mockRejectedValue(
        new Error('ChildProcess exited with code 1: Out of memory in worker')
      );

      const result = await explainDegradedProblem('Deployment', 'checkout-api', OOM_KILLED_FAILURE, {
        pythonAvailable: true,
        ollamaAvailable: true,
        canRunCouncil: true,
      });

      expect(result.fallbackBadge).toBe('DETERMINISTIC RULE MODE');
      expect(result.fallbackStep).toBe('rule_engine');
      expect(result.details).toContain('✔ Root Cause Identified: Container Out-Of-Memory (OOMKilled)');
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Multi-agent council failed')
      );
    });

    it('simulates inconclusive rule match with cloud AI available -> degrades to Step 3 (Legacy AI)', async () => {
      setAIConfig({
        providers: [
          { name: 'ollama', model: 'llama3.1' },
          { name: 'openai', model: 'gpt-4o', password: 'sk-mock-key' },
        ],
      });

      const mockOpenAiClient = {
        name: 'openai',
        model: 'gpt-4o',
        getCompletion: vi.fn().mockResolvedValue('OpenAI Cloud Diagnosis: Intermittent network partition.'),
      };
      vi.spyOn(factoryModule, 'createAIClient').mockImplementation(async (name) => {
        if (name === 'openai') return mockOpenAiClient as any;
        return { name, getCompletion: vi.fn() } as any;
      });

      const result = await explainDegradedProblem('Pod', 'custom-service', UNKNOWN_FAILURE);

      expect(result.fallbackBadge).toBe('LEGACY CLOUD AI');
      expect(result.fallbackStep).toBe('legacy_ai');
      expect(result.details).toContain('OpenAI Cloud Diagnosis');
    });

    it('simulates inconclusive rules and zero AI available -> degrades to Step 4 (Raw K8s Summary)', async () => {
      setAIConfig({ providers: [{ name: 'ollama', model: 'llama3.1' }] });

      const result = await explainDegradedProblem('Pod', 'custom-service', UNKNOWN_FAILURE);

      expect(result.fallbackBadge).toBe('RAW K8S SUMMARY');
      expect(result.fallbackStep).toBe('raw_summary');
      expect(result.details).toContain('[RAW KUBERNETES SUMMARY]');
      expect(result.details).toContain('Zero AI available');
      expect(result.details).toContain(UNKNOWN_FAILURE);
    });

    it('executes full runAnalysis in degraded mode without unhandled rejections', async () => {
      vi.spyOn(probesModule, 'checkCouncilDependencies').mockResolvedValue({
        pythonAvailable: false,
        ollamaAvailable: false,
        canRunCouncil: false,
        degradationReason: 'Local Ollama service is unreachable (http://localhost:11434)',
      });

      const mockPodAnalyzer = {
        name: 'Pod',
        analyze: vi.fn().mockResolvedValue([
          createProblemResult('Pod', 'auth-worker', OOM_KILLED_FAILURE),
        ]),
      };
      registry.register(mockPodAnalyzer);

      const output = await runAnalysis({
        filters: ['Pod'],
        explain: true,
        backend: 'ollama',
        noCache: true,
      });

      expect(output.status).toBe('ProblemDetected');
      expect(output.problems).toBe(1);
      expect(output.results[0].fallbackBadge).toBe('DETERMINISTIC RULE MODE');
      expect(output.results[0].details).toContain('Container Out-Of-Memory (OOMKilled)');
    });
  });

  // ─── Rule Engine Unit Guarantees ───────────────────────────────────────────

  describe('RuleEngine Evaluator Direct Contracts', () => {
    it('evaluates ProbeFailure rule accurately', () => {
      const engine = new RuleEngine();
      const match = engine.evaluate(
        'Liveness probe failed: HTTP probe failed with statuscode: 500 for container "web"'
      );

      expect(match).not.toBeNull();
      expect(match?.ruleId).toBe('rule.kubernetes.probe_failure');
      expect(match?.title).toContain('Liveness Probe Failure');
      expect(match?.confidence).toBe(1.0);
    });

    it('evaluates Scheduling rule accurately', () => {
      const engine = new RuleEngine();
      const match = engine.evaluate(
        '0/5 nodes are available: 5 Insufficient memory. Pod FailedScheduling.'
      );

      expect(match).not.toBeNull();
      expect(match?.ruleId).toBe('rule.kubernetes.failed_scheduling');
      expect(match?.title).toContain('Pod Scheduling Failure');
      expect(match?.confidence).toBe(1.0);
    });

    it('returns null when failure does not match any deterministic rule', () => {
      const engine = new RuleEngine();
      const match = engine.evaluate('Arbitrary unexpected internal error');
      expect(match).toBeNull();
    });
  });
});
