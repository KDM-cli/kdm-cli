/**
 * Baseline regression tests for the legacy kdm analyze pipeline.
 *
 * These tests verify that the frozen analysis flow produces stable, deterministic
 * results for 4 canonical Kubernetes failure modes. All tests run fully offline
 * with mocked analyzers and AI clients — no live cluster or active AI server required.
 *
 * Part of Phase 0: Baseline Pipeline Mapping and Contract Freeze (Issue #271).
 *
 * @module analysis-baseline.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAnalysis, explainSingleResult, resolveBackend } from '../analysis';
import { clearConfig } from '../../config/store';
import {
  registry,
  PodAnalyzer,
  DeploymentAnalyzer,
  ServiceAnalyzer,
  PersistentVolumeClaimAnalyzer,
  NodeAnalyzer,
} from '../../analyzers';
import type { AnalysisOptions } from '../types';
import type { Analyzer, AnalyzerResult } from '../../analyzers/types';
import {
  OOM_KILLED_FIXTURE,
  OOM_KILLED_LLM_RESPONSE,
  CRASH_LOOP_FIXTURE,
  CRASH_LOOP_LLM_RESPONSE,
  IMAGE_PULL_BACKOFF_FIXTURE,
  IMAGE_PULL_BACKOFF_LLM_RESPONSE,
  PROBE_FAILURE_FIXTURE,
  PROBE_FAILURE_LLM_RESPONSE,
} from './baseline-fixtures';

// ─── Module Mocks ────────────────────────────────────────────────────────────

vi.mock('conf', () => {
  const mockConfigStore = new Map<string, any>();
  const mockConfInstance = {
    get store() {
      return Object.fromEntries(mockConfigStore.entries());
    },
    set: vi.fn((key: string, val: any) => {
      mockConfigStore.set(key, val);
    }),
    get: vi.fn((key: string) => mockConfigStore.get(key)),
    delete: vi.fn((key: string) => {
      mockConfigStore.delete(key);
    }),
    clear: vi.fn(() => {
      mockConfigStore.clear();
    }),
  };
  return {
    default: class MockConf {
      constructor() {
        return mockConfInstance;
      }
    },
  };
});

vi.mock('../../kubernetes/resources', () => ({
  listPods: vi.fn(async () => []),
  listDeployments: vi.fn(async () => []),
  listServices: vi.fn(async () => []),
  listPersistentVolumeClaims: vi.fn(async () => []),
  listNodes: vi.fn(async () => []),
  readEndpoints: vi.fn(async () => undefined),
  labelsToSelector: (labels: Record<string, string> = {}) =>
    Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(','),
}));

const mockGetCompletion = vi.fn();

vi.mock('../../ai/factory', () => ({
  createAIClient: vi.fn(async () => ({
    getCompletion: mockGetCompletion,
    model: 'test-model',
  })),
}));

vi.mock('../../agent/python-bridge', () => ({
  runPythonAgentCouncil: vi.fn(),
  isPythonAgentAvailable: vi.fn(async () => false),
}));

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a mock analyzer that returns the given fixture results.
 */
function createMockAnalyzer(name: string, results: AnalyzerResult[]): Analyzer {
  return {
    name,
    analyze: vi.fn(async () => results),
  };
}

/**
 * Holds the original value of process.env.KDM_MULTI_AGENT so we can restore it.
 */
let originalMultiAgentEnv: string | undefined;

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Baseline Pipeline Regression Tests', () => {
  beforeEach(() => {
    clearConfig();
    registry.clear();
    registry.register(PodAnalyzer);
    registry.register(DeploymentAnalyzer);
    registry.register(ServiceAnalyzer);
    registry.register(PersistentVolumeClaimAnalyzer);
    registry.register(NodeAnalyzer);
    mockGetCompletion.mockReset();
    originalMultiAgentEnv = process.env.KDM_MULTI_AGENT;
    delete process.env.KDM_MULTI_AGENT;
  });

  afterEach(() => {
    if (originalMultiAgentEnv !== undefined) {
      process.env.KDM_MULTI_AGENT = originalMultiAgentEnv;
    } else {
      delete process.env.KDM_MULTI_AGENT;
    }
  });

  // ─── Test 1: OOMKilled ───────────────────────────────────────────────────

  it('parses OOMKilled exit code 137 correctly in legacy flow', async () => {
    // Set up a mock Pod analyzer that returns the OOMKilled fixture
    registry.clear();
    const mockPodAnalyzer = createMockAnalyzer('Pod', [OOM_KILLED_FIXTURE]);
    registry.register(mockPodAnalyzer);

    mockGetCompletion.mockResolvedValueOnce(OOM_KILLED_LLM_RESPONSE);

    const options: AnalysisOptions = {
      filters: ['Pod'],
      namespace: 'production',
      explain: true,
      backend: 'openai',
      noCache: true,
    };

    const result = await runAnalysis(options);

    expect(result.status).toBe('ProblemDetected');
    expect(result.problems).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('auth-service-7bbd8f4b5-9x7q2');
    expect(result.results[0].errors[0].text).toContain('exit code 137');
    expect(result.results[0].errors[0].text).toContain('OOMKilled');
    // AI explanation should have been attached
    expect(result.results[0].details).toBe(OOM_KILLED_LLM_RESPONSE);
  });

  // ─── Test 2: CrashLoopBackOff ────────────────────────────────────────────

  it('handles CrashLoopBackOff with non-zero exit code', async () => {
    registry.clear();
    const mockPodAnalyzer = createMockAnalyzer('Pod', [CRASH_LOOP_FIXTURE]);
    registry.register(mockPodAnalyzer);

    mockGetCompletion.mockResolvedValueOnce(CRASH_LOOP_LLM_RESPONSE);

    const options: AnalysisOptions = {
      filters: ['Pod'],
      namespace: 'payments',
      explain: true,
      backend: 'openai',
      noCache: true,
    };

    const result = await runAnalysis(options);

    expect(result.status).toBe('ProblemDetected');
    expect(result.problems).toBe(1);
    expect(result.results[0].name).toBe('payment-gateway-6c9d4f5c8-4kp2m');
    expect(result.results[0].errors[0].text).toContain('CrashLoopBackOff');
    expect(result.results[0].errors[0].text).toContain('exit code 1');
    expect(result.results[0].details).toBe(CRASH_LOOP_LLM_RESPONSE);
  });

  // ─── Test 3: ImagePullBackOff ────────────────────────────────────────────

  it('handles ImagePullBackOff with authorization failure', async () => {
    registry.clear();
    const mockPodAnalyzer = createMockAnalyzer('Pod', [IMAGE_PULL_BACKOFF_FIXTURE]);
    registry.register(mockPodAnalyzer);

    mockGetCompletion.mockResolvedValueOnce(IMAGE_PULL_BACKOFF_LLM_RESPONSE);

    const options: AnalysisOptions = {
      filters: ['Pod'],
      namespace: 'staging',
      explain: true,
      backend: 'openai',
      noCache: true,
    };

    const result = await runAnalysis(options);

    expect(result.status).toBe('ProblemDetected');
    expect(result.problems).toBe(1);
    expect(result.results[0].name).toBe('frontend-app-5b7d6f4a3-2zt8n');
    expect(result.results[0].errors[0].text).toContain('ImagePullBackOff');
    expect(result.results[0].errors[0].text).toContain('unauthorized');
    expect(result.results[0].details).toBe(IMAGE_PULL_BACKOFF_LLM_RESPONSE);
  });

  // ─── Test 4: Probe Failure ───────────────────────────────────────────────

  it('gracefully handles probe threshold timeouts', async () => {
    registry.clear();
    const mockPodAnalyzer = createMockAnalyzer('Pod', [PROBE_FAILURE_FIXTURE]);
    registry.register(mockPodAnalyzer);

    mockGetCompletion.mockResolvedValueOnce(PROBE_FAILURE_LLM_RESPONSE);

    const options: AnalysisOptions = {
      filters: ['Pod'],
      namespace: 'default',
      explain: true,
      backend: 'openai',
      noCache: true,
    };

    const result = await runAnalysis(options);

    expect(result.status).toBe('ProblemDetected');
    expect(result.problems).toBe(1);
    expect(result.results[0].name).toBe('api-server-8f6d5c4a2-7mk3p');
    expect(result.results[0].errors[0].text).toContain('Readiness probe failed');
    expect(result.results[0].errors[0].text).toContain('500');
    expect(result.results[0].details).toBe(PROBE_FAILURE_LLM_RESPONSE);
  });

  // ─── Test 5: Cloud backend fallback ──────────────────────────────────────

  it('preserves cloud backend fallback (OpenAI/Claude)', () => {
    // When no backend is explicitly set and no config exists, should default to 'openai'
    const resolved = resolveBackend({});
    expect(resolved).toBe('openai');

    // When backend is explicitly set, should use it
    const resolvedExplicit = resolveBackend({ backend: 'claude' });
    expect(resolvedExplicit).toBe('claude');

    // When backend is ollama, should return ollama
    const resolvedOllama = resolveBackend({ backend: 'ollama' });
    expect(resolvedOllama).toBe('ollama');
  });

  // ─── Test 6: Feature Flag Toggle ─────────────────────────────────────────

  it('respects KDM_MULTI_AGENT feature flag toggle', async () => {
    registry.clear();
    const mockPodAnalyzer = createMockAnalyzer('Pod', [OOM_KILLED_FIXTURE]);
    registry.register(mockPodAnalyzer);
    mockGetCompletion.mockResolvedValue(OOM_KILLED_LLM_RESPONSE);

    // Test 1: Without the flag, legacy pipeline runs normally
    const legacyResult = await runAnalysis({
      filters: ['Pod'],
      explain: true,
      backend: 'openai',
      noCache: true,
    });
    expect(legacyResult.status).toBe('ProblemDetected');
    expect(legacyResult.results[0].details).toBe(OOM_KILLED_LLM_RESPONSE);

    // Test 2: With env var flag set, pipeline still works (falls through to legacy)
    process.env.KDM_MULTI_AGENT = 'true';
    mockGetCompletion.mockResolvedValue(OOM_KILLED_LLM_RESPONSE);

    const multiAgentResult = await runAnalysis({
      filters: ['Pod'],
      explain: true,
      backend: 'openai',
      noCache: true,
    });
    // Should still produce valid results since multi-agent falls through to legacy
    expect(multiAgentResult.status).toBe('ProblemDetected');
    expect(multiAgentResult.results[0].details).toBe(OOM_KILLED_LLM_RESPONSE);

    // Test 3: With options.multiAgent flag set
    delete process.env.KDM_MULTI_AGENT;
    mockGetCompletion.mockResolvedValue(OOM_KILLED_LLM_RESPONSE);

    const optionsFlagResult = await runAnalysis({
      filters: ['Pod'],
      explain: true,
      backend: 'openai',
      noCache: true,
      multiAgent: true,
    });
    expect(optionsFlagResult.status).toBe('ProblemDetected');
    expect(optionsFlagResult.results[0].details).toBe(OOM_KILLED_LLM_RESPONSE);
  });
});
