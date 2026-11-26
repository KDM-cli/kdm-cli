import type { AgentDefinition } from './types.js';

/**
 * AgentRegistry — Registry for discovering, registering, and retrieving
 * specialist AI agents (local, bridged, or council) in KDM CLI.
 *
 * Conforms strictly to PROJECT.md § Interface Contracts.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  /**
   * Registers a specialist agent definition in the registry.
   */
  register(agent: AgentDefinition): void {
    if (!agent || typeof agent !== 'object') {
      throw new Error('Agent definition must be a valid object');
    }
    if (!agent.name || typeof agent.name !== 'string' || !agent.name.trim()) {
      throw new Error('Agent name must be defined');
    }
    if (!agent.inputSchema || !agent.outputSchema) {
      throw new Error(`Agent '${agent.name}' must define inputSchema and outputSchema`);
    }
    if (typeof agent.run !== 'function') {
      throw new Error(`Agent '${agent.name}' must define an executable run() function`);
    }
    this.agents.set(agent.name, agent);
  }

  /**
   * Registers multiple agents in bulk.
   */
  registerAll(agents: AgentDefinition[]): void {
    for (const agent of agents) {
      this.register(agent);
    }
  }

  /**
   * Retrieves a registered agent by name.
   */
  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /**
   * Checks whether an agent is registered by name.
   */
  has(name: string): boolean {
    return this.agents.has(name);
  }

  /**
   * Lists all registered agents.
   */
  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Returns names of all registered agents.
   */
  getNames(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Unregisters an agent by name.
   */
  unregister(name: string): boolean {
    return this.agents.delete(name);
  }

  /**
   * Clears all registered agents.
   */
  clear(): void {
    this.agents.clear();
  }
}

/**
 * Singleton default AgentRegistry instance for KDM CLI.
 */
export const defaultAgentRegistry = new AgentRegistry();
