import { runAnalysis } from '../analysis/analysis';
import { registry } from '../analyzers';
import { getInstalledVersion } from '../utils/version-check';

/**
 * MCP tool definition.
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<unknown>;
}

/**
 * Creates MCP tool definitions that reuse the analysis engine.
 * These tools are designed to be served via a stdio MCP server.
 * @returns Array of MCP tool definitions.
 */
export function createMCPTools(): MCPTool[] {
  return [
    createAnalyzeClusterTool(),
    createListFiltersTool(),
    createGetClusterHealthTool(),
    createGetResourceIssuesTool(),
  ];
}

/**
 * MCP tool: analyze_cluster — runs full analysis across all or selected filters.
 * @returns MCPTool definition.
 */
function createAnalyzeClusterTool(): MCPTool {
  return {
    name: 'analyze_cluster',
    description: 'Run Kubernetes cluster analysis to detect workload problems',
    inputSchema: {
      type: 'object',
      properties: {
        filters: { type: 'array', items: { type: 'string' }, description: 'Analyzer filters to run' },
        namespace: { type: 'string', description: 'Namespace to analyze' },
        explain: { type: 'boolean', description: 'Enable AI explanations' },
        backend: { type: 'string', description: 'AI backend provider' },
      },
    },
    handler: async (args: any) => {
      return runAnalysis({
        filters: args.filters,
        namespace: args.namespace,
        explain: args.explain,
        backend: args.backend,
        output: 'json',
      });
    },
  };
}

/**
 * MCP tool: list_filters — returns available analyzer names.
 * @returns MCPTool definition.
 */
function createListFiltersTool(): MCPTool {
  return {
    name: 'list_filters',
    description: 'List all available Kubernetes analyzers',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({
      filters: registry.list().map((a) => a.name),
    }),
  };
}

/**
 * MCP tool: get_cluster_health — returns a summary health status.
 * @returns MCPTool definition.
 */
function createGetClusterHealthTool(): MCPTool {
  return {
    name: 'get_cluster_health',
    description: 'Get a summary health status of the Kubernetes cluster',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Namespace to check' },
      },
    },
    handler: async (args: any) => {
      const result = await runAnalysis({ namespace: args.namespace, output: 'json' });
      return { status: result.status, problems: result.problems, errors: result.errors };
    },
  };
}

/**
 * MCP tool: get_resource_issues — returns issues filtered by resource kind.
 * @returns MCPTool definition.
 */
function createGetResourceIssuesTool(): MCPTool {
  return {
    name: 'get_resource_issues',
    description: 'Get issues for a specific Kubernetes resource kind',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Resource kind (e.g., Pod, Deployment)' },
        namespace: { type: 'string', description: 'Namespace to check' },
      },
      required: ['kind'],
    },
    handler: async (args: any) => {
      const result = await runAnalysis({
        filters: [args.kind],
        namespace: args.namespace,
        output: 'json',
      });
      return result;
    },
  };
}

/**
 * Starts a stdio-based MCP server that exposes analysis tools.
 * Reads JSON-RPC messages from stdin and writes responses to stdout.
 */
export async function startMCPServer(): Promise<void> {
  const tools = createMCPTools();
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  process.stdin.setEncoding('utf-8');
  let buffer = '';

  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      await handleMCPMessage(line, toolMap);
    }
  });
}

/**
 * Handles a single MCP JSON-RPC message by dispatching to the appropriate tool.
 * @param line Raw JSON-RPC message string.
 * @param toolMap Map of tool name to MCPTool definitions.
 */
async function handleMCPMessage(
  line: string,
  toolMap: Map<string, MCPTool>,
): Promise<void> {
  try {
    const msg = JSON.parse(line);
    if (!Object.prototype.hasOwnProperty.call(msg, 'id')) {
      return;
    }
    const response = await dispatchMCPRequest(msg, toolMap);
    process.stdout.write(JSON.stringify(response) + '\n');
  } catch (error) {
    const errorResponse = {
      jsonrpc: '2.0',
      error: { code: -32603, message: (error as Error).message },
      id: null,
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
  }
}

/**
 * Dispatches an MCP request to the correct handler based on the method name.
 * @param msg Parsed JSON-RPC message.
 * @param toolMap Map of tool definitions.
 * @returns JSON-RPC response object.
 */
async function dispatchMCPRequest(
  msg: any,
  toolMap: Map<string, MCPTool>,
): Promise<any> {
  if (msg.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'kdm',
          version: getInstalledVersion(),
        },
      },
      id: msg.id,
    };
  }
  if (msg.method === 'tools/list') {
    return buildToolListResponse(msg, toolMap);
  }
  if (msg.method === 'tools/call') {
    return buildToolCallResponse(msg, toolMap);
  }
  return { jsonrpc: '2.0', result: {}, id: msg.id };
}

/**
 * Builds the tools/list response.
 * @param msg The incoming message.
 * @param toolMap Map of tool definitions.
 * @returns JSON-RPC response.
 */
function buildToolListResponse(msg: any, toolMap: Map<string, MCPTool>): any {
  const toolList = Array.from(toolMap.values()).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  return { jsonrpc: '2.0', result: { tools: toolList }, id: msg.id };
}

/**
 * Builds the tools/call response by executing the requested tool.
 * @param msg The incoming message with tool name and arguments.
 * @param toolMap Map of tool definitions.
 * @returns JSON-RPC response.
 */
async function buildToolCallResponse(msg: any, toolMap: Map<string, MCPTool>): Promise<any> {
  const tool = toolMap.get(msg.params?.name);
  if (!tool) {
    return {
      jsonrpc: '2.0',
      error: { code: -32601, message: `Unknown tool: ${msg.params?.name}` },
      id: msg.id,
    };
  }
  const result = await tool.handler(msg.params?.arguments ?? {});
  return {
    jsonrpc: '2.0',
    result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
    id: msg.id,
  };
}
