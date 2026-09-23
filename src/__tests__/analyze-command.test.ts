import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerAnalyzeCommand } from '../commands/analyze';
import { runAnalysis } from '../analysis/analysis';

vi.mock('../analysis/analysis', () => ({
  runAnalysis: vi.fn(async () => ({
    errors: [],
    status: 'OK',
    problems: 0,
    results: [],
  })),
}));

vi.mock('../ui/spinner', () => ({
  createSpinner: vi.fn(() => ({
    start: vi.fn(function (this: any) { return this; }),
    stop: vi.fn(),
    fail: vi.fn(),
  })),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    dim: vi.fn(),
    newline: vi.fn(),
  },
}));

describe('analyze command', () => {
  let program: Command;
  let logSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    registerAnalyzeCommand(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('passes Kubernetes analysis options to runAnalysis', async () => {
    await program.parseAsync([
      'node',
      'test',
      'analyze',
      '--namespace',
      'default',
      '--selector',
      'app=api',
      '--filter',
      'Pod',
      '--filter',
      'Deployment',
      '--output',
      'json',
      '--max-concurrency',
      '3',
      '--with-stat',
      '--with-doc',
      '--kubeconfig',
      '/tmp/kubeconfig',
      '--kubecontext',
      'minikube',
    ]);

    expect(runAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      filters: ['Pod', 'Deployment'],
      namespace: 'default',
      labelSelector: 'app=api',
      output: 'json',
      maxConcurrency: 3,
      withStats: true,
      withDocs: true,
      kubeconfig: '/tmp/kubeconfig',
      kubecontext: 'minikube',
    }));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"status": "OK"'));
  });

  it('reports invalid output formats', async () => {
    const { logger } = await import('../utils/logger');
    await program.parseAsync(['node', 'test', 'analyze', '--output', 'yaml']);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Output format must be either'));
    expect(process.exitCode).toBe(1);
  });

  it('handles runAnalysis failures gracefully', async () => {
    vi.mocked(runAnalysis).mockRejectedValueOnce(new Error('K8s connection failed'));
    await program.parseAsync(['node', 'test', 'analyze']);

    expect(process.exitCode).toBe(1);
  });

  it('handles ProblemDetected status output', async () => {
    vi.mocked(runAnalysis).mockResolvedValueOnce({
      errors: [],
      status: 'ProblemDetected',
      problems: 2,
      results: [
        {
          kind: 'Pod',
          name: 'broken-pod',
          namespace: 'default',
          errors: [{ text: 'CrashLoopBackOff' }, { text: 'Container not ready' }],
        },
      ],
    });
    await program.parseAsync(['node', 'test', 'analyze', '--output', 'json']);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"status": "ProblemDetected"'));
  });

  it('runs with default options when no flags provided', async () => {
    await program.parseAsync(['node', 'test', 'analyze']);

    expect(runAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      filters: undefined,
      namespace: undefined,
      output: 'text',
      maxConcurrency: 10,
      withStats: false,
      withDocs: false,
    }));
  });

  it('keeps json output machine readable', async () => {
    await program.parseAsync(['node', 'test', 'analyze', '--output', 'json']);
    expect(logSpy).toHaveBeenCalled();
  });
});
