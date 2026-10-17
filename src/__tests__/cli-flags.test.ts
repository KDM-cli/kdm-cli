import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { runAnalysis } from '../analysis/analysis';
import { registerAnalyzeCommand } from '../commands/analyze';
import { registerConfigCommand } from '../commands/config';
import * as pythonBridge from '../agent/python-bridge';
import { clearConfig, getConfig, setMultiAgentConfig } from '../config/store';
import { logger } from '../utils/logger';
import type { ConsensusDiagnosis } from '../agent/types';

const LEGACY_DEPRECATION_WARNING = 'Legacy single-prompt mode will be deprecated in v4.1.0';

const MOCK_CONSENSUS: ConsensusDiagnosis = {
  rootCause: 'Pod evicted due to node memory pressure',
  confidence: 'high',
  findings: [
    {
      role: 'resource',
      agentName: 'Resource Agent',
      icon: '🛡️',
      status: 'completed',
      statusText: 'Detected memory pressure condition',
      summary: 'Node memory exceeded 90%',
    },
  ],
  bestSolution: {
    actionTitle: 'Increase memory limits on the pod manifest',
    steps: ['Adjust resources.limits.memory to 512Mi', 'Apply updated manifest'],
    riskLevel: 'low',
  },
};

vi.mock('../agent/python-bridge', () => ({
  runAgentCouncilProcess: vi.fn(),
  runPythonAgentCouncil: vi.fn(),
  isPythonAgentAvailable: vi.fn(async () => true),
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

vi.mock('conf', () => {
  const store = new Map<string, any>();
  const instance = {
    get store() {
      return Object.fromEntries(store.entries());
    },
    set: vi.fn((key: string, val: any) => store.set(key, val)),
    get: vi.fn((key: string) => store.get(key)),
    delete: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  };
  return {
    default: class MockConf {
      constructor() {
        return instance;
      }
    },
  };
});

describe('Phase 23 - Feature Flags, Rollout Modes & Legacy Fallback (Issue #294)', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    clearConfig();
    originalEnv = process.env.KDM_MULTI_AGENT;
    delete process.env.KDM_MULTI_AGENT;

    vi.mocked(pythonBridge.runAgentCouncilProcess).mockResolvedValue(MOCK_CONSENSUS);
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.KDM_MULTI_AGENT = originalEnv;
    } else {
      delete process.env.KDM_MULTI_AGENT;
    }
  });

  describe('Flag & Config Routing in Analysis Engine', () => {
    it('asserts --multi-agent flag routes to multi-agent bridge', async () => {
      const output = await runAnalysis({
        multiAgent: true,
        namespace: 'production',
        labelSelector: 'app=payment',
      });

      expect(pythonBridge.runAgentCouncilProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            namespace: 'production',
            name: 'app=payment',
          }),
        }),
      );
      expect(output.results[0]?.details).toContain('Root Cause (HIGH confidence):');
      expect(output.results[0]?.details).toContain('Increase memory limits on the pod manifest');
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining(LEGACY_DEPRECATION_WARNING),
      );
    });

    it('asserts absence of flag routes to legacy pipeline and emits deprecation notice', async () => {
      const output = await runAnalysis({
        multiAgent: false,
        namespace: 'default',
      });

      expect(pythonBridge.runAgentCouncilProcess).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(LEGACY_DEPRECATION_WARNING),
      );
      expect(output.status).toBe('OK');
    });

    it('routes to multi-agent bridge when KDM_MULTI_AGENT environment variable is true', async () => {
      process.env.KDM_MULTI_AGENT = 'true';

      await runAnalysis({ namespace: 'default' });

      expect(pythonBridge.runAgentCouncilProcess).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining(LEGACY_DEPRECATION_WARNING),
      );
    });

    it('routes to multi-agent bridge when config store multi_agent is true', async () => {
      setMultiAgentConfig(true);
      expect(getConfig().multi_agent).toBe(true);

      await runAnalysis({ namespace: 'default' });

      expect(pythonBridge.runAgentCouncilProcess).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining(LEGACY_DEPRECATION_WARNING),
      );
    });

    it('routes to legacy pipeline when config store multi_agent is false', async () => {
      setMultiAgentConfig(false);

      await runAnalysis({ namespace: 'default' });

      expect(pythonBridge.runAgentCouncilProcess).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(LEGACY_DEPRECATION_WARNING),
      );
    });

    it('gracefully degrades to explain fallback when multi-agent council bridge throws', async () => {
      vi.mocked(pythonBridge.runAgentCouncilProcess).mockRejectedValueOnce(
        new Error('Ollama process crashed'),
      );

      const output = await runAnalysis({
        multiAgent: true,
        namespace: 'default',
      });

      expect(pythonBridge.runAgentCouncilProcess).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Multi-agent council bridge failed: Ollama process crashed'),
      );
      expect(output).toBeDefined();
    });
  });

  describe('CLI Command Flag Registration', () => {
    it('registers --multi-agent option on analyze command and passes to analysis options', () => {
      const program = new Command();
      registerAnalyzeCommand(program);

      const analyzeCmd = program.commands.find((c) => c.name() === 'analyze');
      const multiAgentOpt = analyzeCmd?.options.find((o) => o.name() === 'multi-agent');
      expect(multiAgentOpt).toBeDefined();
      expect(multiAgentOpt?.description).toContain('Enable experimental multi-agent SRE council');
    });
  });

  describe('Config Command Store (kdm config set multi_agent true/false)', () => {
    let program: Command;
    let consoleLogSpy: any;
    let consoleErrorSpy: any;

    beforeEach(() => {
      program = new Command();
      registerConfigCommand(program);
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('allows "kdm config set multi_agent true" to enable multi-agent mode', async () => {
      await program.parseAsync(['node', 'test', 'config', 'set', 'multi_agent', 'true']);

      expect(getConfig().multi_agent).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✓ Set multi_agent to true'));
    });

    it('allows "kdm config set multi_agent false" to disable multi-agent mode', async () => {
      setMultiAgentConfig(true);
      await program.parseAsync(['node', 'test', 'config', 'set', 'multi_agent', 'false']);

      expect(getConfig().multi_agent).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✓ Set multi_agent to false'));
    });

    it('rejects invalid boolean values for multi_agent with a helpful error message', async () => {
      await program.parseAsync(['node', 'test', 'config', 'set', 'multi_agent', 'not-a-bool']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid boolean value for "multi_agent". Expected "true" or "false".'),
      );
    });
  });
});
