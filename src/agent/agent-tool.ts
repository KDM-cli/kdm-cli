import { z } from 'zod';
import { BaseDeclarativeTool, type ToolExecutionContext } from '../tools/declarative-tool.js';
import { AgentRegistry, defaultAgentRegistry } from './registry.js';
import type { AgentContext, DelegateToAgentParams } from './types.js';

export const DelegateToAgentInputSchema = z.object({
  agent_name: z
    .string()
    .min(1, 'Agent name is required')
    .describe(
      'The name of the registered specialist subagent to invoke (e.g. RuntimeLogAgent, ConfigDependencyAgent, ClusterResourceAgent, SynthesizerAgent, CodebaseInvestigatorAgent)'
    ),
  prompt: z
    .string()
    .describe('The diagnostic prompt, inspection goal, or query for the specialist agent'),
  depth: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe('Current delegation recursion depth level'),
  input: z
    .record(z.unknown())
    .optional()
    .describe('Optional structured input arguments passed directly to the subagent'),
  context: z
    .record(z.unknown())
    .optional()
    .describe('Optional context parameters (e.g. namespace, clusterContext)'),
});

export type DelegateToAgentInput = z.infer<typeof DelegateToAgentInputSchema>;

/**
 * AgentTool (`delegate_to_agent`) — Declarative tool enabling orchestrators
 * and Gemini sessions to dispatch subtasks to specialized subagents.
 *
 * Conforms to BaseDeclarativeTool and PROJECT.md § Interface Contracts.
 */
export class AgentTool extends BaseDeclarativeTool<DelegateToAgentInput, any> {
  readonly name = 'delegate_to_agent';
  readonly description =
    'Delegates a specialized investigation, diagnostic, or remediating subtask to a registered specialist agent in the KDM multi-agent council (e.g. RuntimeLogAgent, ConfigDependencyAgent, ClusterResourceAgent, SynthesizerAgent, CodebaseInvestigatorAgent).';
  readonly safetyLevel = 'read_only' as const;
  readonly riskLevel = 'low' as const;
  readonly schema: z.ZodType<DelegateToAgentInput> = DelegateToAgentInputSchema as any;

  constructor(
    private registry: AgentRegistry = defaultAgentRegistry,
    private maxDepth: number = 2
  ) {
    super();
  }

  /**
   * Executes the agent delegation with recursion protection, parameter validation,
   * context propagation, and result schema validation.
   */
  async execute(input: DelegateToAgentInput, context?: ToolExecutionContext): Promise<any> {
    const depth = input.depth ?? 0;
    if (depth >= this.maxDepth) {
      throw new Error(
        `MaxDelegationDepthExceededError: Depth ${depth} exceeded max limit ${this.maxDepth}`
      );
    }

    const agent = this.registry.get(input.agent_name);
    if (!agent) {
      const available = this.registry.list().map((a) => a.name).join(', ');
      throw new Error(
        `Agent '${input.agent_name}' not found. Available: ${available || 'none'}`
      );
    }

    const { agent_name: _, depth: _d, input: directInput, context: directContext, prompt, ...rest } = input as any;

    let rawInput: unknown;
    if (directInput !== undefined) {
      rawInput = directInput;
    } else if (Object.keys(rest).length > 0) {
      rawInput = { prompt, ...rest, ...(directContext || {}) };
    } else {
      rawInput = { prompt, ...(directContext || {}) };
    }

    // Validate subagent input against agent's inputSchema
    let validatedInput: any;
    try {
      validatedInput = agent.inputSchema.parse(rawInput);
    } catch (err) {
      // Fallback strategies for flexible agent inputs
      let parsed = false;
      if (prompt !== undefined) {
        try {
          validatedInput = agent.inputSchema.parse({ prompt });
          parsed = true;
        } catch {
          try {
            validatedInput = agent.inputSchema.parse(prompt);
            parsed = true;
          } catch {
            // keep parsed false
          }
        }
      }
      if (!parsed) {
        throw err;
      }
    }

    // Construct subagent context
    const agentContext: AgentContext = {
      cwd: (context as any)?.cwd ?? process.cwd(),
      namespace: context?.namespace ?? (input.context?.namespace as string | undefined),
      clusterContext: input.context?.clusterContext as string | undefined,
      signal: context?.signal,
      dryRun: context?.dryRun,
      depth: depth + 1,
      maxDepth: this.maxDepth,
      registry: this.registry,
      ...input.context,
      ...context,
    };

    // Execute subagent
    const rawOutput = await agent.run(validatedInput, agentContext);

    // Validate subagent output against agent's outputSchema
    return agent.outputSchema.parse(rawOutput);
  }
}
