import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { AgentRegistry, defaultAgentRegistry } from '../agent/registry.js';
import type { AgentDefinition, AgentContext } from '../agent/types.js';
import { CodebaseInvestigatorAgent } from '../agent/investigator.js';

describe('AgentRegistry (F-04)', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it('TC-REG-01: Agent registration and listing', () => {
    const runtimeAgent: AgentDefinition = {
      name: 'RuntimeLogAgent',
      description: 'Analyzes container logs and exit codes',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ finding: z.string() }),
      run: async (input) => ({ finding: `Logs checked for ${input.prompt}` }),
    };

    const configAgent: AgentDefinition = {
      name: 'ConfigDependencyAgent',
      description: 'Validates Kubernetes ConfigMaps, Secrets, Volumes',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ finding: z.string() }),
      run: async (input) => ({ finding: `Config verified for ${input.prompt}` }),
    };

    registry.register(runtimeAgent);
    registry.register(configAgent);

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(registry.getNames()).toEqual(['RuntimeLogAgent', 'ConfigDependencyAgent']);
  });

  it('TC-REG-02: Agent retrieval by name', () => {
    const resourceAgent: AgentDefinition = {
      name: 'ClusterResourceAgent',
      description: 'Evaluates node memory pressure and cgroups',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ status: z.string() }),
      run: async () => ({ status: 'healthy' }),
    };

    registry.register(resourceAgent);

    expect(registry.get('ClusterResourceAgent')?.name).toBe('ClusterResourceAgent');
    expect(registry.get('NonExistentAgent')).toBeUndefined();
    expect(registry.has('ClusterResourceAgent')).toBe(true);
    expect(registry.has('NonExistentAgent')).toBe(false);
  });

  it('TC-REG-03: Name, schema, and run validation on registration', () => {
    // Missing or invalid object
    expect(() => registry.register(null as any)).toThrow(/Agent definition must be a valid object/);
    expect(() => registry.register(undefined as any)).toThrow(/Agent definition must be a valid object/);

    // Missing name
    expect(() =>
      registry.register({
        name: '',
        description: 'No name',
        inputSchema: z.any(),
        outputSchema: z.any(),
        run: async () => {},
      } as any)
    ).toThrow(/Agent name must be defined/);

    // Missing inputSchema
    expect(() =>
      registry.register({
        name: 'BadAgent',
        description: 'Missing inputSchema',
        inputSchema: null as any,
        outputSchema: z.any(),
        run: async () => {},
      })
    ).toThrow(/must define inputSchema and outputSchema/);

    // Missing outputSchema
    expect(() =>
      registry.register({
        name: 'BadAgent',
        description: 'Missing outputSchema',
        inputSchema: z.any(),
        outputSchema: null as any,
        run: async () => {},
      })
    ).toThrow(/must define inputSchema and outputSchema/);

    // Missing run function
    expect(() =>
      registry.register({
        name: 'BadAgent',
        description: 'Missing run',
        inputSchema: z.any(),
        outputSchema: z.any(),
        run: 'not a function' as any,
      })
    ).toThrow(/must define an executable run\(\) function/);
  });

  it('TC-REG-04: Input schema validation by agent definition', () => {
    const agent: AgentDefinition<{ podName: string; tailLines: number }, { logs: string[] }> = {
      name: 'LogAgent',
      description: 'Fetches logs',
      inputSchema: z.object({
        podName: z.string().min(1),
        tailLines: z.number().int().positive(),
      }),
      outputSchema: z.object({ logs: z.array(z.string()) }),
      run: async (input) => ({ logs: [`log line from ${input.podName}`] }),
    };

    registry.register(agent);

    const valid = agent.inputSchema.parse({ podName: 'payment-api', tailLines: 100 });
    expect(valid.podName).toBe('payment-api');

    expect(() => agent.inputSchema.parse({ podName: '', tailLines: 100 })).toThrow();
    expect(() => agent.inputSchema.parse({ podName: 'payment-api', tailLines: -5 })).toThrow();
  });

  it('TC-REG-05: Output schema validation by agent definition', () => {
    const agent: AgentDefinition<{ prompt: string }, { finding: string; confidence: number }> = {
      name: 'DiagnosticAgent',
      description: 'Diagnoses issues',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({
        finding: z.string(),
        confidence: z.number().min(0).max(1),
      }),
      run: async () => ({ finding: 'OOM error', confidence: 0.95 }),
    };

    registry.register(agent);

    const validOutput = agent.outputSchema.parse({ finding: 'OOM error', confidence: 0.95 });
    expect(validOutput.confidence).toBe(0.95);

    expect(() => agent.outputSchema.parse({ finding: 'OOM error', confidence: 1.5 })).toThrow();
  });

  it('TC-REG-06: Registry clear, unregister, and state isolation', () => {
    const agentA: AgentDefinition = {
      name: 'AgentA',
      description: 'Agent A',
      inputSchema: z.any(),
      outputSchema: z.any(),
      run: async () => ({}),
    };
    const agentB: AgentDefinition = {
      name: 'AgentB',
      description: 'Agent B',
      inputSchema: z.any(),
      outputSchema: z.any(),
      run: async () => ({}),
    };

    registry.registerAll([agentA, agentB]);
    expect(registry.list()).toHaveLength(2);

    expect(registry.unregister('AgentA')).toBe(true);
    expect(registry.has('AgentA')).toBe(false);
    expect(registry.list()).toHaveLength(1);

    expect(registry.unregister('NonExistent')).toBe(false);

    registry.clear();
    expect(registry.list()).toHaveLength(0);

    // Isolation check: another registry instance is unaffected
    const otherRegistry = new AgentRegistry();
    otherRegistry.register(agentA);
    expect(otherRegistry.list()).toHaveLength(1);
    expect(registry.list()).toHaveLength(0);
  });

  it('TC-REG-07: Specialist agent registration including CodebaseInvestigatorAgent', () => {
    const codebaseAgentDef = CodebaseInvestigatorAgent.toDefinition();
    expect(codebaseAgentDef.name).toBe('CodebaseInvestigatorAgent');

    registry.register(codebaseAgentDef);
    expect(registry.has('CodebaseInvestigatorAgent')).toBe(true);

    const retrieved = registry.get('CodebaseInvestigatorAgent');
    expect(retrieved?.description).toContain('Specialized agent that inspects local workspace manifests');
  });

  it('TC-REG-08: defaultAgentRegistry singleton operations', () => {
    defaultAgentRegistry.clear();
    expect(defaultAgentRegistry.list()).toHaveLength(0);

    const testAgent: AgentDefinition = {
      name: 'SingletonTestAgent',
      description: 'Testing singleton',
      inputSchema: z.any(),
      outputSchema: z.any(),
      run: async () => ({ ok: true }),
    };

    defaultAgentRegistry.register(testAgent);
    expect(defaultAgentRegistry.has('SingletonTestAgent')).toBe(true);
    defaultAgentRegistry.clear();
  });
});
