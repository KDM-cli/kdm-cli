import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { AgentRegistry } from '../agent/registry.js';
import { AgentTool } from '../agent/agent-tool.js';
import { CodebaseInvestigatorAgent } from '../agent/investigator.js';
import {
  EventTranslator,
  translateNDJSONToSubagentProgress,
} from '../agent/event-translator.js';
import type { AgentDefinition, AgentContext, NDJSONEvent } from '../agent/types.js';

describe('Multi-Agent Coordination Protocol (F-04, F-05)', () => {
  let registry: AgentRegistry;
  let agentTool: AgentTool;

  beforeEach(() => {
    registry = new AgentRegistry();
    agentTool = new AgentTool(registry, 2);
  });

  it('TC-COORD-01: Orchestrator delegates to registered agent via AgentTool', async () => {
    registry.register({
      name: 'RuntimeLogAgent',
      description: 'Analyzes runtime logs and exit codes',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ finding: z.string(), exitCode: z.number() }),
      run: async (input) => ({
        finding: `Analyzed logs for: ${input.prompt}`,
        exitCode: 137,
      }),
    });

    const result = await agentTool.execute({
      agent_name: 'RuntimeLogAgent',
      prompt: 'pod payment-api-7b89 crashed',
    });

    expect(result.exitCode).toBe(137);
    expect(result.finding).toContain('pod payment-api-7b89 crashed');
  });

  it('TC-COORD-02: Delegation to missing agent throws informative error', async () => {
    registry.register({
      name: 'ConfigDependencyAgent',
      description: 'Config specialist',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      run: async () => ({ ok: true }),
    });

    await expect(
      agentTool.execute({
        agent_name: 'UnknownSpecialist',
        prompt: 'investigate',
      })
    ).rejects.toThrow(/Agent 'UnknownSpecialist' not found\. Available: ConfigDependencyAgent/);
  });

  it('TC-COORD-03: Max delegation recursion depth throws MaxDelegationDepthExceededError', async () => {
    registry.register({
      name: 'RecursiveAgent',
      description: 'Calls itself',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      run: async (_input, ctx) => {
        // Delegate again using tool
        return agentTool.execute({
          agent_name: 'RecursiveAgent',
          prompt: 'recursive call',
          depth: (ctx?.depth ?? 0),
        });
      },
    });

    // Start at depth 2 (maxDepth is 2)
    await expect(
      agentTool.execute({
        agent_name: 'RecursiveAgent',
        prompt: 'trigger recursion',
        depth: 2,
      })
    ).rejects.toThrow(/MaxDelegationDepthExceededError: Depth 2 exceeded max limit 2/);
  });

  it('TC-COORD-04: Parameter and output schema validation across delegation boundary', async () => {
    registry.register({
      name: 'StrictAgent',
      description: 'Strict schema agent',
      inputSchema: z.object({
        prompt: z.string(),
        mode: z.enum(['fast', 'deep']),
      }),
      outputSchema: z.object({
        status: z.literal('SUCCESS'),
        score: z.number().min(0).max(100),
      }),
      run: async (input) => ({
        status: 'SUCCESS' as const,
        score: input.mode === 'deep' ? 95 : 60,
      }),
    });

    // Valid call with direct input object
    const validResult = await agentTool.execute({
      agent_name: 'StrictAgent',
      prompt: 'diagnose',
      input: { prompt: 'diagnose', mode: 'deep' },
    });
    expect(validResult.score).toBe(95);

    // Invalid call violating agent inputSchema
    await expect(
      agentTool.execute({
        agent_name: 'StrictAgent',
        prompt: 'diagnose',
        input: { prompt: 'diagnose', mode: 'invalid-mode' as any },
      })
    ).rejects.toThrow();
  });

  it('TC-COORD-05: Context propagation through delegation tool', async () => {
    let capturedContext: AgentContext | undefined;

    registry.register({
      name: 'ContextObservingAgent',
      description: 'Inspects context',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ captured: z.boolean() }),
      run: async (_input, ctx) => {
        capturedContext = ctx;
        return { captured: true };
      },
    });

    const abortController = new AbortController();
    await agentTool.execute(
      {
        agent_name: 'ContextObservingAgent',
        prompt: 'test context',
        context: { namespace: 'production', clusterContext: 'gke-us-east1' },
      },
      {
        signal: abortController.signal,
        dryRun: true,
      }
    );

    expect(capturedContext).toBeDefined();
    expect(capturedContext?.namespace).toBe('production');
    expect(capturedContext?.clusterContext).toBe('gke-us-east1');
    expect(capturedContext?.signal).toBe(abortController.signal);
    expect(capturedContext?.dryRun).toBe(true);
    expect(capturedContext?.depth).toBe(1);
  });

  it('TC-COORD-06: Unified OOMKill triage pipeline with specialists + CodebaseInvestigator', async () => {
    // 1. Register domain specialists
    registry.register({
      name: 'RuntimeLogAgent',
      description: 'Container logs and exit code specialist',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ exitCode: z.number(), reason: z.string() }),
      run: async () => ({ exitCode: 137, reason: 'OOMKilled' }),
    });

    registry.register({
      name: 'ClusterResourceAgent',
      description: 'Node pressure and cgroup specialist',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ containerLimit: z.string(), nodePressure: z.boolean() }),
      run: async () => ({ containerLimit: '512Mi', nodePressure: false }),
    });

    // 2. Register CodebaseInvestigatorAgent
    registry.register(CodebaseInvestigatorAgent.toDefinition());

    // 3. Execute specialist diagnostics
    const runtimeResult = await agentTool.execute({
      agent_name: 'RuntimeLogAgent',
      prompt: 'Check auth-service pod termination',
    });
    expect(runtimeResult.exitCode).toBe(137);

    const resourceResult = await agentTool.execute({
      agent_name: 'ClusterResourceAgent',
      prompt: 'Check auth-service memory limits',
    });
    expect(resourceResult.containerLimit).toBe('512Mi');

    // 4. Codebase investigator searches workspace manifests with cluster context
    const codebaseResult = await agentTool.execute({
      agent_name: 'CodebaseInvestigatorAgent',
      prompt: 'Inspect workspace Dockerfiles and manifests for JVM memory mismatch',
      input: {
        workspaceFiles: {
          Dockerfile:
            'FROM eclipse-temurin:17\nENV JAVA_OPTS="-Xmx768m"\nENTRYPOINT ["java", "$JAVA_OPTS", "-jar", "app.jar"]\n',
        },
        liveClusterState: {
          memoryLimit: resourceResult.containerLimit,
          exitCode: runtimeResult.exitCode,
        },
      },
    });

    expect(codebaseResult.driftDetected).toBe(true);
    expect(codebaseResult.findings).toHaveLength(1);
    expect(codebaseResult.findings[0].issue).toContain('-Xmx768m');
    expect(codebaseResult.findings[0].issue).toContain('512Mi');
  });

  it('TC-COORD-07: Multi-agent stream event translation to UI progress state', () => {
    const translator = new EventTranslator();
    const timestamp = '2026-11-15T12:00:00Z';

    const events: NDJSONEvent[] = [
      { event: 'agent_start', role: 'runtime', message: 'Analyzing container crash', timestamp },
      {
        event: 'agent_tool_call',
        role: 'runtime',
        tool: 'k8s_get_logs',
        args: { pod: 'auth-api' },
        timestamp,
      },
      {
        event: 'agent_tool_result',
        role: 'runtime',
        tool: 'k8s_get_logs',
        durationMs: 45,
        timestamp,
      },
      { event: 'agent_complete', role: 'runtime', summary: 'Exit code 137 verified', timestamp },
      {
        event: 'diagnosis_ready',
        timestamp,
        consensus: {
          rootCause: 'OOMKilled due to JVM heap mismatch',
          confidence: 'high',
          findings: [],
          bestSolution: {
            actionTitle: 'Increase memory limit',
            steps: ['Apply manifest patch'],
            riskLevel: 'low',
          },
        },
      },
    ];

    const streamChunk = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    const progressList = translator.pushChunk(streamChunk);

    expect(progressList).toHaveLength(5);
    expect(progressList[0].state).toBe('running');
    expect(progressList[1].toolCall?.name).toBe('k8s_get_logs');
    expect(progressList[2].toolCall?.status).toBe('success');
    expect(progressList[3].state).toBe('completed');
    expect(progressList[4].agentName).toBe('SynthesizerAgent');
    expect(progressList[4].result).toContain('OOMKilled due to JVM heap mismatch');
  });

  it('TC-COORD-08: Gemini FunctionDeclaration conversion via toGeminiToolDeclaration()', () => {
    const declaration = agentTool.toGeminiToolDeclaration();
    expect(declaration.name).toBe('delegate_to_agent');
    expect(declaration.description).toContain('Delegates a specialized investigation');
    expect(declaration.parameters).toBeDefined();
    expect(declaration.parameters?.type).toBe('OBJECT');
  });
});
