/**
 * Tool Registry — KDM v4.0.0
 * ==========================
 * Discovery, registration, safety filtering, and execution dispatch
 * of declarative tools with @google/genai tool declaration integration.
 */

import type { FunctionDeclaration, Tool } from '@google/genai';
import {
  BaseDeclarativeTool,
  type ToolSafetyLevel,
  type ToolRiskLevel,
  type ToolExecutionContext,
} from './declarative-tool';
import {
  k8sGetResourcesTool,
  k8sDescribeResourceTool,
  k8sGetLogsTool,
  k8sGetEventsTool,
  k8sApplyManifestTool,
  k8sDeleteResourceTool,
  k8sGetPodTool,
  k8sListPodsTool,
  k8sApplyPatchTool,
} from './k8s-tools';
import {
  dockerListContainersTool,
  dockerInspectContainerTool,
  dockerGetLogsTool,
  dockerRestartContainerTool,
} from './docker-tools';

export class ToolRegistry {
  private readonly tools = new Map<string, BaseDeclarativeTool>();

  /**
   * Registers a single declarative tool in the registry.
   */
  register(tool: BaseDeclarativeTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Registers multiple declarative tools in bulk.
   */
  registerAll(tools: BaseDeclarativeTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Retrieves a tool by name.
   */
  get(name: string): BaseDeclarativeTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Checks whether a tool with the specified name is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Lists all registered tools.
   */
  list(): BaseDeclarativeTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Filters tools by safety level ('read_only' | 'mutating').
   */
  filterBySafety(safety: ToolSafetyLevel): BaseDeclarativeTool[] {
    return this.list().filter((t) => t.safetyLevel === safety || t.safety === safety);
  }

  /**
   * Filters tools by risk level ('low' | 'medium' | 'high').
   */
  filterByRisk(riskLevel: ToolRiskLevel): BaseDeclarativeTool[] {
    return this.list().filter((t) => t.riskLevel === riskLevel);
  }

  /**
   * Converts all registered tools into @google/genai FunctionDeclaration array.
   */
  getDeclarations(): FunctionDeclaration[] {
    return this.list().map((tool) => tool.toGeminiToolDeclaration());
  }

  /**
   * Alias for getDeclarations() matching SCOPE.md interface contract.
   */
  getGeminiTools(): FunctionDeclaration[] {
    return this.getDeclarations();
  }

  /**
   * Converts all registered tools into @google/genai Tool array for model configuration.
   */
  toGeminiTools(): Tool[] {
    return [
      {
        functionDeclarations: this.getDeclarations(),
      },
    ];
  }

  /**
   * Validates arguments against the tool schema and executes the tool.
   * Throws Error if tool not found, or ZodError if validation fails.
   */
  async invoke(name: string, rawArgs: unknown, context?: ToolExecutionContext): Promise<any> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Declarative tool '${name}' not found.`);
    }

    // Parameter schema validation before execution
    const validated = tool.validate(rawArgs);
    return await tool.execute(validated, context);
  }

  /**
   * Alias for invoke() matching standard dispatch convention.
   */
  async execute(name: string, rawArgs: unknown, context?: ToolExecutionContext): Promise<any> {
    return this.invoke(name, rawArgs, context);
  }
}

/**
 * Compatibility alias for DeclarativeToolRegistry expected by tests and harness.
 */
export class DeclarativeToolRegistry extends ToolRegistry {}

/**
 * Default pre-configured singleton registry with all standard K8s and Docker tools.
 */
export const defaultToolRegistry = new ToolRegistry();
defaultToolRegistry.registerAll([
  k8sGetResourcesTool,
  k8sDescribeResourceTool,
  k8sGetLogsTool,
  k8sGetEventsTool,
  k8sApplyManifestTool,
  k8sDeleteResourceTool,
  k8sGetPodTool,
  k8sListPodsTool,
  k8sApplyPatchTool,
  dockerListContainersTool,
  dockerInspectContainerTool,
  dockerGetLogsTool,
  dockerRestartContainerTool,
]);
