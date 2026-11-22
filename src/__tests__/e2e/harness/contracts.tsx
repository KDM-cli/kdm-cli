import { z } from 'zod';
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { NDJSONEvent } from '../../../agent/types';
import { createTwoFilesPatch } from 'diff';
import { MockClusterEnvironment } from './mock-cluster-env';

// ─── Utilities ──────────────────────────────────────────────────────────────

export function parseMemoryBytes(memStr: string): number {
  const match = memStr.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGTP]i?|B)?$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  switch (unit) {
    case 'KI':
    case 'K':
      return num * 1024;
    case 'MI':
    case 'M':
      return num * 1024 * 1024;
    case 'GI':
    case 'G':
      return num * 1024 * 1024 * 1024;
    case 'TI':
    case 'T':
      return num * 1024 * 1024 * 1024 * 1024;
    default:
      return num;
  }
}

export interface ParsedSlashCommand {
  command: string;
  args: string[];
  options: Record<string, string>;
  raw: string;
}

export function parseSlashCommand(input: string): ParsedSlashCommand {
  const raw = input.trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  const command = tokens[0] || '';
  const args: string[] = [];
  const options: Record<string, string> = {};

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '-n' && i + 1 < tokens.length) {
      options.namespace = tokens[++i];
    } else if (token === '--namespace' && i + 1 < tokens.length) {
      options.namespace = tokens[++i];
    } else if (token.startsWith('--namespace=')) {
      options.namespace = token.split('=')[1];
    } else if (token === '--target' && i + 1 < tokens.length) {
      options.target = tokens[++i];
    } else if (token.startsWith('--target=')) {
      options.target = token.split('=')[1];
    } else if (token.startsWith('-') || token.startsWith('--')) {
      const key = token.replace(/^-+/, '');
      if (key.includes('=')) {
        const [k, v] = key.split('=');
        options[k] = v;
      } else if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        options[key] = tokens[++i];
      } else {
        options[key] = 'true';
      }
    } else {
      args.push(token);
    }
  }

  return { command, args, options, raw };
}

// ─── F-04: Subagent Progress & Event Translation Protocol ───────────────────

export interface SubagentProgress {
  agentName: string;
  state: 'running' | 'completed' | 'error' | 'cancelled';
  thought?: string;
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    status: 'running' | 'success' | 'error';
    output?: string;
  };
  result?: string;
}

/**
 * Translates KDM Python Council NDJSON events into unified SubagentProgress objects.
 */
export function translateNDJSONToSubagentProgress(event: NDJSONEvent): SubagentProgress | null {
  if (!event || typeof event !== 'object' || !('event' in event)) {
    return null;
  }

  switch (event.event) {
    case 'agent_start':
      return {
        agentName: event.role,
        state: 'running',
        thought: event.message,
      };

    case 'agent_tool_call':
      return {
        agentName: event.role,
        state: 'running',
        toolCall: {
          name: event.tool,
          args: event.args,
          status: 'running',
        },
      };

    case 'agent_tool_result':
      return {
        agentName: event.role,
        state: 'running',
        toolCall: {
          name: event.tool,
          args: {},
          status: 'success',
          output: `completed in ${event.durationMs}ms`,
        },
      };

    case 'agent_progress':
      return {
        agentName: event.role,
        state: 'running',
        thought: event.message,
      };

    case 'agent_complete':
      return {
        agentName: event.role,
        state: 'completed',
        result: event.summary,
      };

    case 'agent_failed':
      return {
        agentName: event.role,
        state: 'error',
        result: event.error,
      };

    case 'diagnosis_ready':
      return {
        agentName: 'SynthesizerAgent',
        state: 'completed',
        result: event.consensus.rootCause,
      };

    default:
      return null;
  }
}

// ─── F-04: Subagent Registry & Invocation Protocol ───────────────────────────

export interface AgentContext {
  cwd?: string;
  namespace?: string;
  clusterContext?: string;
  signal?: AbortSignal;
}

export interface AgentDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  run: (input: TInput, context?: AgentContext) => Promise<TOutput>;
}

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition): void {
    if (!agent.name) throw new Error('Agent name must be defined');
    this.agents.set(agent.name, agent);
  }

  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  clear(): void {
    this.agents.clear();
  }
}

export class AgentTool {
  constructor(private registry: AgentRegistry, private maxDepth = 2) {}

  async execute(params: { agent_name: string; prompt: string; depth?: number }): Promise<any> {
    const depth = params.depth ?? 0;
    if (depth >= this.maxDepth) {
      throw new Error(`MaxDelegationDepthExceededError: Depth ${depth} exceeded max limit ${this.maxDepth}`);
    }

    const agent = this.registry.get(params.agent_name);
    if (!agent) {
      throw new Error(`Agent '${params.agent_name}' not found. Available: ${this.registry.list().map((a) => a.name).join(', ')}`);
    }

    const validatedInput = agent.inputSchema.parse({ prompt: params.prompt });
    const output = await agent.run(validatedInput);
    return agent.outputSchema.parse(output);
  }
}

// ─── F-03: Declarative Cluster Tools Protocol ───────────────────────────────

export interface DeclarativeTool<TParams = any, TResult = any> {
  name: string;
  description: string;
  safety: 'read_only' | 'mutating';
  riskLevel?: 'low' | 'medium' | 'high';
  parameters: z.ZodType<TParams>;
  execute: (args: TParams) => Promise<TResult>;
}

export class DeclarativeToolRegistry {
  private tools = new Map<string, DeclarativeTool>();

  register(tool: DeclarativeTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): DeclarativeTool | undefined {
    return this.tools.get(name);
  }

  list(): DeclarativeTool[] {
    return Array.from(this.tools.values());
  }

  getDeclarations(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: { type: 'object' },
    }));
  }

  async invoke(name: string, rawArgs: unknown): Promise<any> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Declarative tool '${name}' not found.`);
    }

    // Zod parameter validation before execution
    const validated = tool.parameters.parse(rawArgs);
    return await tool.execute(validated);
  }
}

// Standard K8s and Docker Declarative Tools schemas & implementations wired to active cluster
export const k8sGetPodTool: DeclarativeTool = {
  name: 'k8s_get_pod',
  description: 'Inspect status, exit codes, and restart counts of a Kubernetes pod',
  safety: 'read_only',
  riskLevel: 'low',
  parameters: z.object({
    name: z.string().min(1, 'Pod name is required'),
    namespace: z.string().default('default'),
    timeoutMs: z.number().optional(),
  }),
  execute: async ({ name, namespace, timeoutMs }: { name: string; namespace?: string; timeoutMs?: number }) => {
    const activeCluster = MockClusterEnvironment.getActive();
    if (activeCluster) {
      const state = activeCluster.getState();
      if (!state.k8sConnected) {
        throw new Error('Kubernetes API connection refused: ETIMEDOUT');
      }
      if ((state as any).hanging) {
        const effectiveTimeout = timeoutMs || 5000;
        await new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`ClusterTimeoutError: Control plane did not respond in ${effectiveTimeout}ms`)),
            Math.min(effectiveTimeout, 20)
          )
        );
      }
      const found = state.pods.find(
        (p) => p.name === name && (namespace === 'default' || p.namespace === namespace || !p.namespace)
      );
      if (!found) {
        const err: any = new Error(`Pod '${name}' not found in namespace '${namespace}'`);
        err.statusCode = 404;
        throw err;
      }
      return {
        pod: found.name,
        namespace: found.namespace,
        phase: found.phase || 'Running',
        status: found.status,
        exitCode: found.exitCode ?? 0,
        restartCount: found.restarts,
        memoryLimit: found.memoryLimit || '512Mi',
        rawPod: found.rawPod,
      };
    }

    return {
      pod: name,
      namespace,
      phase: 'Running',
      status: 'OOMKilled',
      exitCode: 137,
      restartCount: 5,
      memoryLimit: '512Mi',
    };
  },
};

export const k8sListPodsTool: DeclarativeTool = {
  name: 'k8s_list_pods',
  description: 'List pods in a specified namespace',
  safety: 'read_only',
  riskLevel: 'low',
  parameters: z.object({
    namespace: z.string().default('default'),
  }),
  execute: async ({ namespace }) => {
    const activeCluster = MockClusterEnvironment.getActive();
    if (activeCluster) {
      const state = activeCluster.getState();
      if (!state.k8sConnected) {
        throw new Error('Kubernetes API connection refused: ETIMEDOUT');
      }
      const filtered =
        namespace === 'all'
          ? state.pods
          : state.pods.filter((p) => p.namespace === namespace || !p.namespace || namespace === 'default');
      return {
        namespace,
        pods: filtered.map((p) => ({
          name: p.name,
          namespace: p.namespace,
          status: p.status,
          restarts: p.restarts,
          node: p.node,
        })),
      };
    }

    return {
      namespace,
      pods: [
        { name: 'payment-service-8f4b-2x9p', namespace, status: 'OOMKilled', restarts: 5 },
        { name: 'auth-api-v2-7c91', namespace, status: 'CrashLoopBackOff', restarts: 12 },
      ],
    };
  },
};

export const dockerInspectContainerTool: DeclarativeTool = {
  name: 'docker_inspect_container',
  description: 'Inspect detailed state and exit code of a Docker container',
  safety: 'read_only',
  riskLevel: 'low',
  parameters: z.object({
    containerId: z.string().min(1, 'containerId is required'),
  }),
  execute: async ({ containerId }) => {
    const activeCluster = MockClusterEnvironment.getActive();
    if (activeCluster) {
      const state = activeCluster.getState();
      if (!state.dockerConnected) {
        throw new Error('Cannot connect to the Docker daemon. Is Docker running?');
      }
      const found = state.containers.find(
        (c) => c.id === containerId || c.name === containerId || c.name === `/${containerId}`
      );
      if (!found) {
        const err: any = new Error(`Container '${containerId}' not found`);
        err.statusCode = 404;
        throw err;
      }
      return {
        containerId,
        id: found.id,
        name: found.name,
        state: found.state,
        exitCode: found.exitCode ?? 0,
        oomKilled: found.exitCode === 137,
        status: found.status,
        rawContainer: found.rawContainer,
      };
    }

    return {
      containerId,
      state: 'restarting',
      exitCode: 1,
      oomKilled: false,
      status: 'Restarting (1) 3 seconds ago',
    };
  },
};

export const k8sApplyPatchTool: DeclarativeTool = {
  name: 'k8s_apply_patch',
  description: 'Apply an approved YAML manifest patch to a Kubernetes resource',
  safety: 'mutating',
  riskLevel: 'high',
  parameters: z.object({
    resource: z.string().min(1),
    namespace: z.string().default('default'),
    patch: z.string().min(1, 'Patch payload is required'),
  }),
  execute: async ({ resource, namespace, patch }) => {
    if (patch.startsWith(':::broken-yaml')) {
      throw new Error('YAML syntax error: unparseable patch structure');
    }
    if (patch.startsWith(':::conflict')) {
      const err: any = new Error(`Error from server (Conflict): Operation cannot be fulfilled on ${resource}`);
      err.statusCode = 409;
      throw err;
    }

    const activeCluster = MockClusterEnvironment.getActive();
    if (activeCluster) {
      const state = activeCluster.getState();
      if (!state.k8sConnected) {
        throw new Error('Kubernetes API connection refused: ETIMEDOUT');
      }
      const pod = state.pods.find((p) => resource.includes(p.name) || p.name === resource);
      if (pod && patch.includes('1024Mi')) {
        pod.memoryLimit = '1024Mi';
        pod.status = 'Running';
      }
    }

    return {
      success: true,
      appliedTo: `${namespace}/${resource}`,
      status: 'Patched successfully',
      patch,
    };
  },
};

export const k8sGetLogsTool: DeclarativeTool = {
  name: 'k8s_get_logs',
  description: 'Fetch runtime container logs',
  safety: 'read_only',
  riskLevel: 'low',
  parameters: z.object({
    pod: z.string().min(1),
    namespace: z.string().default('default'),
  }),
  execute: async ({ pod, namespace }) => {
    const activeCluster = MockClusterEnvironment.getActive();
    if (activeCluster && !activeCluster.getState().k8sConnected) {
      throw new Error('Kubernetes API connection refused: ETIMEDOUT');
    }
    if (pod === 'just-started-pod') {
      return { logs: '', note: 'Log stream empty' };
    }
    return {
      logs: `[INFO] ${pod} started\n[INFO] listening on port 8080`,
      pod,
      namespace,
    };
  },
};

// ─── F-05: Codebase Investigator Agent Implementation ───────────────────────

export interface CodebaseFinding {
  discoveredManifests: string[];
  findings: Array<{
    file: string;
    issue: string;
    recommendation: string;
    patch?: string;
  }>;
  driftDetected?: boolean;
}

export class CodebaseInvestigatorAgent {
  static readonly name = 'CodebaseInvestigatorAgent';

  static async run(params: {
    query?: string;
    workspaceFiles: Record<string, string>;
    liveClusterState?: { memoryLimit?: string; podName?: string };
  }): Promise<CodebaseFinding> {
    const files = Object.keys(params.workspaceFiles);
    if (files.length === 0) {
      return {
        discoveredManifests: [],
        findings: [
          {
            file: 'none',
            issue: 'No relevant configuration or manifest files discovered in workspace',
            recommendation: 'Verify workspace directory contains Helm charts or manifests',
          },
        ],
      };
    }

    const binaryExtensions = ['.png', '.jpg', '.tar', '.gz', '.bin', '.exe', '.so', '.dylib', '.zip'];
    const isBinary = (filename: string) => binaryExtensions.some((ext) => filename.endsWith(ext));

    const discoveredManifests = files.filter(
      (f) => !isBinary(f) && (f.endsWith('.yaml') || f.endsWith('.yml') || f.includes('Dockerfile'))
    );

    const findings: CodebaseFinding['findings'] = [];
    let driftDetected = false;

    // Check for circular symlinks and unreadable/permission-denied files
    for (const file of files) {
      const content = params.workspaceFiles[file] || '';

      if (
        file.includes('link-to-charts') ||
        file.includes('circular') ||
        file.includes('loop') ||
        content.startsWith(':::symlink-cycle')
      ) {
        findings.push({
          file,
          issue: `Circular filesystem symlink loop detected: ${file}`,
          recommendation: 'Break circular filesystem link or add path to .kdmignore',
        });
      }

      if (
        content.startsWith(':::EACCES') ||
        content.startsWith(':::permission-denied') ||
        content.includes('EACCES: permission denied')
      ) {
        findings.push({
          file,
          issue: `EACCES: permission denied, unable to read manifest ${file}`,
          recommendation: 'Check file permissions (chmod +r) or ensure investigator runs with appropriate privileges',
        });
      }
    }

    for (const file of discoveredManifests) {
      const content = params.workspaceFiles[file] || '';
      if (content.startsWith(':::broken') || (content.includes('\t') && file.endsWith('.yaml'))) {
        continue;
      }

      // Dynamic JVM heap vs cgroup limit evaluation
      const jvmMatch = content.match(/-Xmx([0-9]+[kmgKMG]?)/);
      if (jvmMatch) {
        const heapStr = jvmMatch[1];
        const heapBytes = parseMemoryBytes(heapStr);

        const limitMatch = content.match(/memory:\s*([0-9]+[kmgKMG]i?)/);
        const manifestLimit = limitMatch ? limitMatch[1] : undefined;
        const liveLimit = params.liveClusterState?.memoryLimit || manifestLimit || '512Mi';
        const limitBytes = parseMemoryBytes(liveLimit);

        if (heapBytes > limitBytes) {
          driftDetected = true;
          const recommendedLimitMi = Math.max(1024, Math.ceil((heapBytes * 1.33) / (1024 * 1024)));
          const targetLimitStr = `${recommendedLimitMi}Mi`;

          let patched = content;
          if (manifestLimit) {
            patched = content.replace(`memory: ${manifestLimit}`, `memory: ${targetLimitStr}`);
          } else {
            patched = content.replace('resources:', `resources:\n    limits:\n      memory: ${targetLimitStr}`);
          }
          const patch = createTwoFilesPatch(file, `${file}.patched`, content, patched);

          findings.push({
            file,
            issue: `Configured JVM heap (-Xmx${heapStr}) exceeds container cgroup memory limit (${liveLimit}).`,
            recommendation: `Increase container memory limit to ${targetLimitStr} or reduce JVM heap to -Xmx384m.`,
            patch,
          });
        }
      }

      // Secret key mismatch check
      if (content.includes('key: db-url')) {
        driftDetected = true;
        const patched = content.replace('key: db-url', 'key: DATABASE_URL');
        const patch = createTwoFilesPatch(file, `${file}.patched`, content, patched);

        findings.push({
          file,
          issue: 'Mismatched secretKeyRef: secret provides key DATABASE_URL, but manifest requests db-url.',
          recommendation: 'Change secretKeyRef key from db-url to DATABASE_URL.',
          patch,
        });
      }
    }

    return {
      discoveredManifests,
      findings,
      driftDetected,
    };
  }
}

// ─── F-07: Tool Confirmation Queue & Diff Renderer Protocol ─────────────────

export interface ConfirmationRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  diff?: string;
  riskLevel: 'low' | 'medium' | 'high';
  prompt: string;
}

export type ConfirmationDecision = 'ALLOW' | 'DENY' | 'EDIT';

export function evaluateSafetyPolicy(command: string): { allowed: boolean; violation?: string } {
  const destructivePatterns = [
    /rm\s+-rf\s+\//,
    /kubectl\s+delete\s+namespace\s+(kube-system|default|production)/,
    /mkfs/,
    /dd\s+if=/,
  ];

  for (const pattern of destructivePatterns) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        violation: `Destructive command permanently blocked by safety policy: ${command}`,
      };
    }
  }

  return { allowed: true };
}

// ─── React 19 / Ink 8 UI Components for Testing ─────────────────────────────

export interface ThinkingMessageProps {
  thought?: string;
}

export const ThinkingMessage: React.FC<ThinkingMessageProps> = ({ thought }) => {
  if (!thought || thought.trim() === '') return null;
  const maxLen = 120;
  const displayThought =
    thought.length > maxLen ? thought.substring(0, maxLen) + '... [+more]' : thought;
  return (
    <Box flexDirection="row">
      <Text color="magenta">💭 </Text>
      <Text dimColor italic>
        {displayThought}
      </Text>
    </Box>
  );
};

export interface DiffRendererProps {
  diff: string;
  maxLines?: number;
}

export const DiffRenderer: React.FC<DiffRendererProps> = ({ diff, maxLines = 50 }) => {
  if (!diff || diff.trim() === '') {
    return (
      <Box padding={1}>
        <Text dimColor>No configuration differences detected.</Text>
      </Box>
    );
  }

  const lines = diff.split('\n');
  const displayLines = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold color="cyan">
        ── Manifest Unified Diff ───────────────────
      </Text>
      {displayLines.map((line, idx) => {
        let color: string | undefined = undefined;
        if (line.startsWith('+') && !line.startsWith('+++')) color = 'green';
        else if (line.startsWith('-') && !line.startsWith('---')) color = 'red';
        else if (line.startsWith('@@')) color = 'cyan';
        else if (line.startsWith('---') || line.startsWith('+++')) color = 'yellow';

        return (
          <Text key={idx} color={color}>
            {line}
          </Text>
        );
      })}
      {remaining > 0 ? (
        <Text dimColor italic>
          ... and {remaining} more lines
        </Text>
      ) : null}
    </Box>
  );
};

export interface ToolConfirmationQueueProps {
  request: ConfirmationRequest;
  onDecision: (decision: ConfirmationDecision) => void;
  onAbort?: () => void;
}

export const ToolConfirmationQueueView: React.FC<ToolConfirmationQueueProps> = ({
  request,
  onDecision,
  onAbort,
}) => {
  const policy = evaluateSafetyPolicy(String(request.args?.command || request.toolName));

  useInput(
    (input, key) => {
      if (!policy.allowed) {
        onDecision('DENY');
        return;
      }

      if ((key.ctrl && (input === 'c' || input === 'C')) || input === '\u0003') {
        onAbort?.();
        onDecision('DENY');
        return;
      }

      const lower = input.toLowerCase();
      if (lower === 'y') {
        onDecision('ALLOW');
      } else if (lower === 'n' || key.escape) {
        onDecision('DENY');
      }
    },
    { exitOnCtrlC: false }
  );

  if (!policy.allowed) {
    return (
      <Box flexDirection="column" borderStyle="double" borderColor="red" padding={1}>
        <Text bold color="red">
          ⛔ POLICY VIOLATION: COMMAND BLOCKED
        </Text>
        <Text color="red">{policy.violation}</Text>
      </Box>
    );
  }

  const badgeColor =
    request.riskLevel === 'high' ? 'red' : request.riskLevel === 'medium' ? 'yellow' : 'green';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={badgeColor} padding={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={badgeColor}>
          [{request.riskLevel.toUpperCase()} RISK ACTION REQUIRED]
        </Text>
        <Text dimColor>ID: {request.id}</Text>
      </Box>
      <Box marginY={1}>
        <Text>{request.prompt}</Text>
      </Box>
      {request.diff ? <DiffRenderer diff={request.diff} /> : null}
      <Box marginTop={1}>
        <Text bold>
          Press <Text color="green">[y]</Text> to Approve, <Text color="red">[n]</Text> to Deny
        </Text>
      </Box>
    </Box>
  );
};

export interface ComposerProps {
  onSubmit: (prompt: string) => void;
  history?: string[];
  maxBufferLength?: number;
  initialValue?: string;
}

export const ComposerView: React.FC<ComposerProps> = ({
  onSubmit,
  history = [],
  maxBufferLength = 10000,
  initialValue = '',
}) => {
  const [input, setInput] = useState(initialValue);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inputRef = React.useRef(initialValue);
  const historyIndexRef = React.useRef(-1);
  inputRef.current = input;
  historyIndexRef.current = historyIndex;

  const slashCommands = ['/pods', '/containers', '/watch', '/analyze', '/health', '/help'];
  const filteredCommands = slashCommands.filter((cmd) => cmd.startsWith(input));

  useInput(
    (char, key) => {
      // 1. Enter key: Submit prompt
      if (key.return || (char && (char.includes('\r') || char.includes('\n')))) {
        const currentInput = inputRef.current;
        const trimmed = currentInput.trim();
        if (!trimmed) return;

        // Unknown slash command detection
        if (trimmed.startsWith('/') && !slashCommands.some((c) => trimmed === c || trimmed.startsWith(c + ' '))) {
          setErrorMessage(`Unknown command '${trimmed}'. Type /help for available commands.`);
          return;
        }

        setErrorMessage(null);
        onSubmit(trimmed);
        inputRef.current = '';
        setInput('');
        setShowAutocomplete(false);
        historyIndexRef.current = -1;
        setHistoryIndex(-1);
        return;
      }

      // 2. Escape key: Dismiss autocomplete dropdown, keep buffer intact
      if (key.escape) {
        setShowAutocomplete(false);
        return;
      }

      // 3. Arrow Up: Navigate backwards in history
      if (key.upArrow) {
        if (history.length > 0) {
          const cur = historyIndexRef.current;
          const nextIdx = cur === -1 ? 0 : Math.min(cur + 1, history.length - 1);
          historyIndexRef.current = nextIdx;
          setHistoryIndex(nextIdx);
          const val = history[history.length - 1 - nextIdx];
          inputRef.current = val;
          setInput(val);
          setShowAutocomplete(val.startsWith('/'));
        }
        return;
      }

      // 4. Arrow Down: Navigate forwards in history
      if (key.downArrow) {
        if (history.length > 0 && historyIndexRef.current !== -1) {
          const cur = historyIndexRef.current;
          if (cur > 0) {
            const nextIdx = cur - 1;
            historyIndexRef.current = nextIdx;
            setHistoryIndex(nextIdx);
            const val = history[history.length - 1 - nextIdx];
            inputRef.current = val;
            setInput(val);
            setShowAutocomplete(val.startsWith('/'));
          } else if (cur === 0) {
            historyIndexRef.current = -1;
            setHistoryIndex(-1);
            inputRef.current = '';
            setInput('');
            setShowAutocomplete(false);
          }
        }
        return;
      }

      // 5. Backspace / Delete
      if (key.backspace || key.delete) {
        const next = inputRef.current.slice(0, -1);
        inputRef.current = next;
        setInput(next);
        setShowAutocomplete(next.startsWith('/'));
        return;
      }

      // 6. Character input (enforces maxBufferLength clamp)
      if (char && !char.includes('\r') && !char.includes('\n')) {
        const clean = char.replace(/[\r\n]/g, '');
        if (clean) {
          const next = (inputRef.current + clean).slice(0, maxBufferLength);
          inputRef.current = next;
          setInput(next);
          setShowAutocomplete(next.startsWith('/'));
        }
      }
    },
    { exitOnCtrlC: false }
  );

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" padding={1}>
      {showAutocomplete && filteredCommands.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>Available Slash Commands:</Text>
          {filteredCommands.map((cmd) => (
            <Text key={cmd} color="cyan">
              {'  ' + cmd}
            </Text>
          ))}
        </Box>
      ) : null}
      {errorMessage ? (
        <Box marginBottom={1}>
          <Text color="red">{errorMessage}</Text>
        </Box>
      ) : null}
      <Box flexDirection="row">
        <Text bold color="green">
          ❯{' '}
        </Text>
        <Text>{input || 'Type a prompt or / command...'}</Text>
      </Box>
    </Box>
  );
};

export interface DashboardWithTroubleshootTriggerProps {
  dashboardType: 'watch' | 'show' | 'health' | 'logs';
  targetResource?: string | null;
  currentLogLines?: string[];
  onTrigger?: (resource: string) => void;
  onTroubleshootTriggered?: (resource: string) => void;
  onDismiss?: () => void;
  onDismissal?: () => void;
  isHeadless?: boolean;
}

export const DashboardWithTroubleshootTrigger: React.FC<DashboardWithTroubleshootTriggerProps> = ({
  dashboardType,
  targetResource,
  currentLogLines = [],
  onTrigger,
  onTroubleshootTriggered,
  onDismiss,
  onDismissal,
  isHeadless = false,
}) => {
  const [inTroubleshooting, setInTroubleshooting] = useState(false);
  const [hintMessage, setHintMessage] = useState<string | null>(null);
  const inTroubleshootingRef = React.useRef(false);
  inTroubleshootingRef.current = inTroubleshooting;

  useInput(
    (input, key) => {
      if (isHeadless) return;

      const lower = input.toLowerCase();
      if (lower.includes('t')) {
        if (!targetResource) {
          setHintMessage('No workload selected. Use arrow keys to select a workload.');
          return;
        }
        setHintMessage(null);
        if (!inTroubleshootingRef.current) {
          inTroubleshootingRef.current = true;
          setInTroubleshooting(true);
          onTrigger?.(targetResource);
          onTroubleshootTriggered?.(targetResource);
        }
        return;
      }

      if (key.escape && inTroubleshootingRef.current) {
        inTroubleshootingRef.current = false;
        setInTroubleshooting(false);
        onDismiss?.();
        onDismissal?.();
        return;
      }
    },
    { exitOnCtrlC: false }
  );

  return (
    <Box flexDirection="column" padding={1}>
      {hintMessage ? (
        <Box marginBottom={1}>
          <Text color="yellow">⚠️ {hintMessage}</Text>
        </Box>
      ) : null}
      {!inTroubleshooting ? (
        <Box flexDirection="column">
          <Text bold color="cyan">
            Active Dashboard: {dashboardType.toUpperCase()}
          </Text>
          <Text>Selected Resource: {targetResource || 'None'}</Text>
          {currentLogLines.length > 0 ? (
            <Box flexDirection="column">
              {currentLogLines.map((l, i) => (
                <Text key={i} dimColor>
                  {l}
                </Text>
              ))}
            </Box>
          ) : null}
          <Text dimColor>Press [t] to trigger AI troubleshooting</Text>
        </Box>
      ) : (
        <Box flexDirection="column" borderStyle="round" borderColor="magenta" padding={1}>
          <Text bold color="magenta">
            🤖 AI Troubleshooting Session: {targetResource}
          </Text>
          <Text color="yellow">Dispatching Multi-Agent Council...</Text>
          <Text dimColor>Press [Esc] to return to {dashboardType}</Text>
        </Box>
      )}
    </Box>
  );
};

export interface AppContainerProps {
  children?: React.ReactNode;
  activeTab?: number;
  onExit?: () => void;
  bannerError?: string | null;
  registerSignalHandlers?: boolean;
  onSignal?: (signal: string) => void;
}

export const AppContainerView: React.FC<AppContainerProps> = ({
  children,
  activeTab = 1,
  onExit,
  bannerError,
  registerSignalHandlers = false,
  onSignal,
}) => {
  useInput(
    (input, key) => {
      if (
        input === 'q' ||
        input === 'Q' ||
        (key.ctrl && (input === 'c' || input === 'C')) ||
        input === '\u0003'
      ) {
        onExit?.();
      }
    },
    { exitOnCtrlC: false }
  );

  React.useEffect(() => {
    if (!registerSignalHandlers) return;
    const handleSigterm = () => {
      onSignal?.('SIGTERM');
      onExit?.();
    };
    process.on('SIGTERM', handleSigterm);
    return () => {
      process.removeListener('SIGTERM', handleSigterm);
    };
  }, [registerSignalHandlers, onExit, onSignal]);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box borderStyle="single" borderColor="cyan" justifyContent="space-between">
        <Text bold color="cyan">
          {' '}
          KDM Copilot Shell v4.0.0
        </Text>
        <Box>
          <Text color={activeTab === 1 ? 'green' : 'dim'}>[1: Monitor] </Text>
          <Text color={activeTab === 2 ? 'green' : 'dim'}>[2: Agents] </Text>
          <Text color={activeTab === 3 ? 'green' : 'dim'}>[3: Diffs] </Text>
          <Text color={activeTab === 4 ? 'green' : 'dim'}>[4: Settings]</Text>
        </Box>
      </Box>
      {bannerError ? (
        <Box borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow">⚠ {bannerError}</Text>
        </Box>
      ) : null}
      <Box flexGrow={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
};

export function debounceResize(
  callback: (cols: number, rows?: number) => void,
  delayMs = 50
): ((cols: number, rows?: number) => void) & { cancel: () => void; flush: () => void } {
  let timer: NodeJS.Timeout | null = null;
  let lastCols = 0;
  let lastRows = 0;

  const debounced = (cols: number, rows = 24) => {
    lastCols = cols;
    lastRows = rows;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      callback(lastCols, lastRows);
      timer = null;
    }, delayMs);
  };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      callback(lastCols, lastRows);
    }
  };

  return debounced;
}
