import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registry,
  PodAnalyzer,
  DeploymentAnalyzer,
  ServiceAnalyzer,
  PersistentVolumeClaimAnalyzer,
  NodeAnalyzer,
} from '../analyzers';
import { runAnalysis } from '../analysis/analysis';
import { formatTextOutput, formatJsonOutput } from '../analysis/output';
import { clearConfig } from '../config/store';

vi.mock('conf', () => {
  const mockConfigStore = new Map<string, any>();
  const mockConfInstance = {
    get store() {
      return Object.fromEntries(mockConfigStore.entries());
    },
    set: vi.fn((key, val) => {
      mockConfigStore.set(key, val);
    }),
    get: vi.fn((key) => mockConfigStore.get(key)),
    delete: vi.fn((key) => {
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

describe('Analysis Engine', () => {
  beforeEach(() => {
    clearConfig();
    // Ensure no analyzer registrations leak between tests.
    registry.clear();
    // Re-register core analyzers after clearing.
    registry.register(PodAnalyzer);
    registry.register(DeploymentAnalyzer);
    registry.register(ServiceAnalyzer);
    registry.register(PersistentVolumeClaimAnalyzer);
    registry.register(NodeAnalyzer);
  });

  it('runs no-op analyzers and returns OK when no issues are found', async () => {
    const output = await runAnalysis({
      filters: ['Pod', 'Deployment'],
    });

    expect(output.status).toBe('OK');
    expect(output.problems).toBe(0);
    expect(output.results).toEqual([]);
    expect(output.errors).toEqual([]);
  });

  it('returns ProblemDetected when an analyzer reports issues', async () => {
    const errorAnalyzer = {
      name: 'ErroneousPod',
      analyze: async () => [
        {
          kind: 'Pod',
          name: 'failing-pod',
          namespace: 'kube-system',
          errors: [{ text: 'CrashLoopBackOff', kubernetesDoc: 'See doc link' }],
          details: 'Pod failed due to OOMKilled',
        },
      ],
    };

    registry.register(errorAnalyzer);

    const output = await runAnalysis({
      filters: ['ErroneousPod'],
    });

    expect(output.status).toBe('ProblemDetected');
    expect(output.problems).toBe(1);
    expect(output.results.length).toBe(1);
    expect(output.results[0].name).toBe('failing-pod');
    expect(output.results[0].errors[0].text).toBe('CrashLoopBackOff');
  });

  it('handles unknown filters by adding them as errors', async () => {
    const output = await runAnalysis({
      filters: ['NonExistentFilter'],
    });

    expect(output.errors).toContain('Unknown filter: NonExistentFilter');
  });

  it('respects concurrency limit settings', async () => {
    let activeCalls = 0;
    let maxConcurrentCalls = 0;

    // Controlled promise helpers for deterministic concurrency testing
    const createDeferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => { resolve = r; });
      return { promise, resolve };
    };

    const gate1 = createDeferred();
    const gate2 = createDeferred();

    const delayAnalyzer1 = {
      name: 'Delay1',
      analyze: async () => {
        activeCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
        await gate1.promise;
        activeCalls--;
        return [];
      },
    };

    const delayAnalyzer2 = {
      name: 'Delay2',
      analyze: async () => {
        activeCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
        await gate2.promise;
        activeCalls--;
        return [];
      },
    };

    registry.register(delayAnalyzer1);
    registry.register(delayAnalyzer2);

    const analysisPromise = runAnalysis({
      filters: ['Delay1', 'Delay2'],
      maxConcurrency: 1,
    });

    // Release gates sequentially to let the analysis complete
    gate1.resolve();
    gate2.resolve();

    await analysisPromise;

    expect(maxConcurrentCalls).toBe(1);
  });

  it('handles concurrency limit default fallback for invalid inputs', async () => {
    const output = await runAnalysis({
      filters: ['Pod'],
      maxConcurrency: -5,
    });
    expect(output.status).toBe('OK');
  });

  it('formats text output correctly', async () => {
    const testOutput = {
      status: 'ProblemDetected' as const,
      problems: 1,
      errors: [],
      results: [
        {
          kind: 'Pod',
          name: 'my-pod',
          namespace: 'default',
          errors: [{ text: 'OOMKilled', kubernetesDoc: 'https://k8s.io' }],
          details: 'Resource exhausted',
        },
      ],
    };

    const formatted = formatTextOutput(testOutput);
    expect(formatted).toContain('Status: ProblemDetected (1 problem)');
    expect(formatted).toContain('Pods:');
    expect(formatted).toContain('my-pod');
    expect(formatted).toContain('Error: OOMKilled');
    expect(formatted).toContain('Kubernetes Doc: https://k8s.io');
  });

  it('formats json output correctly', async () => {
    const testOutput = {
      status: 'OK' as const,
      problems: 0,
      errors: [],
      results: [],
    };

    const formatted = formatJsonOutput(testOutput);
    const parsed = JSON.parse(formatted);
    expect(parsed.status).toBe('OK');
    expect(parsed.problems).toBe(0);
  });

  it('collects execution stats when withStats option is true', async () => {
    const output = await runAnalysis({
      filters: ['Pod'],
      withStats: true,
    });

    expect(output.stats).toBeDefined();
    expect(output.stats!.length).toBe(1);
    expect(output.stats![0].analyzer).toBe('Pod');
    expect(typeof output.stats![0].durationMs).toBe('number');
  });

  it('survives individual analyzer failure without stopping execution', async () => {
    const failingAnalyzer = {
      name: 'Failing',
      analyze: async () => {
        throw new Error('Something went wrong');
      },
    };
    registry.register(failingAnalyzer);

    const output = await runAnalysis({
      filters: ['Failing', 'Pod'],
    });

    expect(output.errors.length).toBe(1);
    expect(output.errors[0]).toContain('Analyzer Failing failed: Something went wrong');
    expect(output.status).toBe('OK');
  });
});
