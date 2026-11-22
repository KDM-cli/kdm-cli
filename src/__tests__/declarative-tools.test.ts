import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { Type } from '@google/genai';
import {
  BaseDeclarativeTool,
  DeclarativeTool,
  createDeclarativeTool,
  zodToGenAiSchema,
} from '../tools/declarative-tool';
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
} from '../tools/k8s-tools';
import {
  dockerListContainersTool,
  dockerInspectContainerTool,
  dockerGetLogsTool,
  dockerRestartContainerTool,
} from '../tools/docker-tools';
import {
  ToolRegistry,
  DeclarativeToolRegistry,
  defaultToolRegistry,
} from '../tools/tool-registry';
import * as k8sResources from '../kubernetes/resources';
import * as k8sPods from '../kubernetes/pods';
import * as k8sClient from '../kubernetes/client';
import * as dockerClient from '../docker/client';
import * as remediationExecutor from '../remediation/executor';

describe('Feature F-03: Declarative Cluster Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. BaseDeclarativeTool & Schema Validation ──────────────────────────

  it('TC-TOOL-01: BaseDeclarativeTool parameter validation with valid inputs calling execute()', async () => {
    const executeMock = vi.fn().mockResolvedValue({ status: 'success' });
    const tool = createDeclarativeTool({
      name: 'test_tool',
      description: 'A test declarative tool',
      schema: z.object({
        host: z.string().min(1),
        port: z.number().int().positive(),
      }),
      execute: executeMock,
    });

    const result = await tool.execute({ host: 'localhost', port: 8080 });
    expect(result).toEqual({ status: 'success' });
    expect(executeMock).toHaveBeenCalledWith({ host: 'localhost', port: 8080 }, undefined);
  });

  it('TC-TOOL-02: BaseDeclarativeTool invalid parameter rejection throwing ZodError before execute()', async () => {
    const executeMock = vi.fn().mockResolvedValue({ status: 'success' });
    const tool = createDeclarativeTool({
      name: 'test_tool',
      description: 'A test declarative tool',
      schema: z.object({
        host: z.string().min(1),
        port: z.number().int().positive(),
      }),
      execute: executeMock,
    });

    // Missing port
    expect(() => tool.validate({ host: 'localhost' })).toThrow();
    // Negative port
    expect(() => tool.validate({ host: 'localhost', port: -1 })).toThrow();
    // Non-integer port
    expect(() => tool.validate({ host: 'localhost', port: '8080' })).toThrow();
    // Execute was never called
    expect(executeMock).not.toHaveBeenCalled();
  });

  // ─── 2. Safety Classification & Risk Levels ──────────────────────────────

  it('TC-TOOL-03: Safety classification for read-only tools (safety: "read_only", riskLevel: "low")', () => {
    const readOnlyTools = [
      k8sGetResourcesTool,
      k8sDescribeResourceTool,
      k8sGetLogsTool,
      k8sGetEventsTool,
      k8sGetPodTool,
      k8sListPodsTool,
      dockerListContainersTool,
      dockerInspectContainerTool,
      dockerGetLogsTool,
    ];

    for (const tool of readOnlyTools) {
      expect(tool.safetyLevel).toBe('read_only');
      expect(tool.safety).toBe('read_only');
      expect(tool.riskLevel).toBe('low');
    }
  });

  it('TC-TOOL-04: Safety classification for mutating tools (safety: "mutating", riskLevel: "medium" | "high")', () => {
    expect(k8sApplyManifestTool.safetyLevel).toBe('mutating');
    expect(k8sApplyManifestTool.safety).toBe('mutating');
    expect(k8sApplyManifestTool.riskLevel).toBe('high');

    expect(k8sDeleteResourceTool.safetyLevel).toBe('mutating');
    expect(k8sDeleteResourceTool.safety).toBe('mutating');
    expect(k8sDeleteResourceTool.riskLevel).toBe('high');

    expect(k8sApplyPatchTool.safetyLevel).toBe('mutating');
    expect(k8sApplyPatchTool.safety).toBe('mutating');
    expect(k8sApplyPatchTool.riskLevel).toBe('high');

    expect(dockerRestartContainerTool.safetyLevel).toBe('mutating');
    expect(dockerRestartContainerTool.safety).toBe('mutating');
    expect(dockerRestartContainerTool.riskLevel).toBe('medium');
  });

  // ─── 3. Gemini Schema Converter ──────────────────────────────────────────

  it('TC-TOOL-05: zodToGenAiSchema converts complex Zod schemas to OpenAPI 3.03 format', () => {
    const testSchema = z.object({
      name: z.string().describe('Target workload name'),
      replicas: z.number().int().describe('Replica count'),
      ratio: z.number().describe('Float ratio'),
      enabled: z.boolean().describe('Feature status'),
      tags: z.array(z.string()).describe('Workload tags'),
      environment: z.enum(['dev', 'staging', 'production']).describe('Deployment env'),
      optionalNote: z.string().optional().describe('Optional note'),
      timeoutSeconds: z.number().int().default(30).describe('Timeout with default'),
    });

    const genAiSchema = zodToGenAiSchema(testSchema);
    expect(genAiSchema.type).toBe(Type.OBJECT);
    expect(genAiSchema.properties).toBeDefined();

    const props = genAiSchema.properties!;
    expect(props.name.type).toBe(Type.STRING);
    expect(props.name.description).toBe('Target workload name');

    expect(props.replicas.type).toBe(Type.INTEGER);
    expect(props.ratio.type).toBe(Type.NUMBER);
    expect(props.enabled.type).toBe(Type.BOOLEAN);

    expect(props.tags.type).toBe(Type.ARRAY);
    expect(props.tags.items?.type).toBe(Type.STRING);

    expect(props.environment.type).toBe(Type.STRING);
    expect(props.environment.enum).toEqual(['dev', 'staging', 'production']);

    expect(props.timeoutSeconds.default).toBe(30);

    // Required array should include non-optional, non-default fields
    expect(genAiSchema.required).toContain('name');
    expect(genAiSchema.required).toContain('replicas');
    expect(genAiSchema.required).toContain('ratio');
    expect(genAiSchema.required).toContain('enabled');
    expect(genAiSchema.required).toContain('tags');
    expect(genAiSchema.required).toContain('environment');
    expect(genAiSchema.required).not.toContain('optionalNote');
    expect(genAiSchema.required).not.toContain('timeoutSeconds');
  });

  // ─── 4. Kubernetes Tools ─────────────────────────────────────────────────

  it('TC-TOOL-06: k8s_get_resources queries pods with namespace and label selector', async () => {
    const spy = vi.spyOn(k8sResources, 'listPods').mockResolvedValueOnce([
      {
        metadata: { name: 'payment-api-9f8a', namespace: 'production', creationTimestamp: new Date() },
        status: { phase: 'Running' },
      } as any,
    ]);

    const result = await k8sGetResourcesTool.execute({
      kind: 'pod',
      namespace: 'production',
      labelSelector: 'app=payment',
    });

    expect(spy).toHaveBeenCalledWith({ namespace: 'production', labelSelector: 'app=payment' });
    expect(result.count).toBe(1);
    expect(result.items[0].name).toBe('payment-api-9f8a');
    expect(result.items[0].status).toBe('Running');
  });

  it('TC-TOOL-07: k8s_get_resources dispatches to services, deployments, and nodes', async () => {
    const svcSpy = vi.spyOn(k8sResources, 'listServices').mockResolvedValueOnce([
      { metadata: { name: 'payment-svc', namespace: 'default' }, status: {} } as any,
    ]);
    const deploySpy = vi.spyOn(k8sResources, 'listDeployments').mockResolvedValueOnce([
      { metadata: { name: 'payment-deploy', namespace: 'default' }, status: {} } as any,
    ]);
    const nodeSpy = vi.spyOn(k8sResources, 'listNodes').mockResolvedValueOnce([
      { metadata: { name: 'worker-node-1' }, status: { phase: 'Ready' } } as any,
    ]);

    const svcRes = await k8sGetResourcesTool.execute({ kind: 'service' });
    expect(svcSpy).toHaveBeenCalled();
    expect(svcRes.items[0].name).toBe('payment-svc');

    const deployRes = await k8sGetResourcesTool.execute({ kind: 'deployment' });
    expect(deploySpy).toHaveBeenCalled();
    expect(deployRes.items[0].name).toBe('payment-deploy');

    const nodeRes = await k8sGetResourcesTool.execute({ kind: 'node' });
    expect(nodeSpy).toHaveBeenCalled();
    expect(nodeRes.items[0].name).toBe('worker-node-1');
  });

  it('TC-TOOL-08: k8s_describe_resource returns structured details and events for existing resource', async () => {
    const mockPod = {
      metadata: { name: 'payment-pod', namespace: 'default' },
      spec: { containers: [{ name: 'app', image: 'payment:v1' }] },
      status: { phase: 'Running' },
    };

    vi.spyOn(k8sClient, 'getK8sApi').mockReturnValueOnce({
      readNamespacedPod: vi.fn().mockResolvedValueOnce(mockPod),
    } as any);

    vi.spyOn(k8sResources, 'listEvents').mockResolvedValueOnce([
      {
        type: 'Warning',
        reason: 'BackOff',
        message: 'Back-off restarting failed container',
        involvedObject: { name: 'payment-pod' },
        lastTimestamp: new Date(),
      } as any,
    ]);

    const result = await k8sDescribeResourceTool.execute({
      kind: 'pod',
      name: 'payment-pod',
      namespace: 'default',
    });

    expect(result.found).toBe(true);
    expect(result.name).toBe('payment-pod');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].reason).toBe('BackOff');
  });

  it('TC-TOOL-09: k8s_describe_resource handles 404 / not found gracefully', async () => {
    vi.spyOn(k8sClient, 'getK8sApi').mockReturnValueOnce({
      readNamespacedPod: vi.fn().mockRejectedValueOnce({ statusCode: 404 }),
    } as any);

    vi.spyOn(remediationExecutor, 'executeRemediationCommand').mockResolvedValueOnce({
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Error from server (NotFound): pods "non-existent" not found',
      durationMs: 10,
      command: 'kubectl describe pod non-existent -n default',
    });

    const result = await k8sDescribeResourceTool.execute({
      kind: 'pod',
      name: 'non-existent',
      namespace: 'default',
    });

    expect(result.found).toBe(false);
    expect(result.description).toContain('not found');
  });

  it('TC-TOOL-10: k8s_get_logs retrieves container logs with tailLines', async () => {
    vi.spyOn(k8sClient, 'getK8sApi').mockReturnValueOnce({
      readNamespacedPodLog: vi.fn().mockResolvedValueOnce('Log line 1\nLog line 2\nLog line 3\n'),
    } as any);

    const result = await k8sGetLogsTool.execute({
      name: 'auth-pod',
      namespace: 'default',
      container: 'auth-container',
      tailLines: 50,
    });

    expect(result.pod).toBe('auth-pod');
    expect(result.linesCount).toBe(3);
    expect(result.lines).toEqual(['Log line 1', 'Log line 2', 'Log line 3']);
  });

  it('TC-TOOL-11: k8s_get_events lists events filtered by namespace and type', async () => {
    vi.spyOn(k8sResources, 'listEvents').mockResolvedValueOnce([
      {
        type: 'Normal',
        reason: 'Scheduled',
        message: 'Successfully assigned default/pod-1 to node-1',
        involvedObject: { kind: 'Pod', name: 'pod-1' },
        lastTimestamp: new Date('2026-11-15T10:00:00Z'),
      } as any,
      {
        type: 'Warning',
        reason: 'OOMKilled',
        message: 'Container app killed by OOM killer',
        involvedObject: { kind: 'Pod', name: 'pod-2' },
        lastTimestamp: new Date('2026-11-15T10:05:00Z'),
      } as any,
    ]);

    const warnings = await k8sGetEventsTool.execute({
      namespace: 'default',
      type: 'Warning',
    });

    expect(warnings.count).toBe(1);
    expect(warnings.events[0].reason).toBe('OOMKilled');
  });

  it('TC-TOOL-12: k8s_apply_manifest applies manifest patch with dryRun option', async () => {
    const execSpy = vi.spyOn(remediationExecutor, 'executeRemediationCommand').mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      stdout: 'deployment.apps/payment-service patched',
      stderr: '',
      durationMs: 25,
      command: 'kubectl patch deployment payment-service ...',
    });

    const result = await k8sApplyManifestTool.execute({
      manifest: '{"spec":{"replicas":3}}',
      resource: 'deployment/payment-service',
      namespace: 'production',
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.appliedTo).toBe('production/deployment/payment-service');
    expect(result.dryRun).toBe(true);
    expect(execSpy).toHaveBeenCalled();
  });

  it('TC-TOOL-13: k8s_apply_manifest rejects malformed YAML patch structure before applying', async () => {
    await expect(
      k8sApplyManifestTool.execute({
        manifest: ':::broken-yaml unparseable content',
        namespace: 'default',
      })
    ).rejects.toThrow(/YAML syntax error/i);

    await expect(
      k8sApplyManifestTool.execute({
        manifest: 'spec:\n\treplicas: 3', // tabs in YAML
        namespace: 'default',
      })
    ).rejects.toThrow(/YAML syntax error/i);
  });

  it('TC-TOOL-14: k8s_delete_resource deletes resource and enforces protected namespace block', async () => {
    // Protected namespace block
    await expect(
      k8sDeleteResourceTool.execute({
        kind: 'namespace',
        name: 'kube-system',
      })
    ).rejects.toThrow(/Policy violation: deletion of protected namespace/i);

    await expect(
      k8sDeleteResourceTool.execute({
        kind: 'ns',
        name: 'production',
      })
    ).rejects.toThrow(/Policy violation/i);

    // Valid deletion
    vi.spyOn(remediationExecutor, 'executeRemediationCommand').mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      stdout: 'pod "stuck-pod" deleted',
      stderr: '',
      durationMs: 15,
      command: 'kubectl delete pod stuck-pod -n default',
    });

    const result = await k8sDeleteResourceTool.execute({
      kind: 'pod',
      name: 'stuck-pod',
      namespace: 'default',
    });

    expect(result.success).toBe(true);
    expect(result.deleted).toBe('pod/stuck-pod');
  });

  // ─── 5. Docker Tools ─────────────────────────────────────────────────────

  it('TC-TOOL-15: docker_list_containers lists containers with state filtering', async () => {
    vi.spyOn(dockerClient, 'getDockerClient').mockReturnValueOnce({
      listContainers: vi.fn().mockResolvedValueOnce([
        {
          Id: 'c1e2d3f4a5b67890',
          Names: ['/web-frontend'],
          Image: 'nginx:alpine',
          State: 'running',
          Status: 'Up 2 hours',
          Created: 1700000000,
          Ports: [{ PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
        },
        {
          Id: 'b9a8c7d6e5f43210',
          Names: ['/db-postgres'],
          Image: 'postgres:15',
          State: 'restarting',
          Status: 'Restarting (1) 2s ago',
          Created: 1700000000,
          Ports: [],
        },
      ]),
    } as any);

    const result = await dockerListContainersTool.execute({
      all: true,
      status: 'restarting',
    });

    expect(result.count).toBe(1);
    expect(result.containers[0].name).toBe('db-postgres');
    expect(result.containers[0].state).toBe('restarting');
  });

  it('TC-TOOL-16: docker_inspect_container returns container configuration and health', async () => {
    vi.spyOn(dockerClient, 'getDockerClient').mockReturnValueOnce({
      getContainer: vi.fn().mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValueOnce({
          Id: 'c1e2d3f4a5b67890',
          Name: '/payment-redis',
          Config: { Image: 'redis:7-alpine', Env: ['PORT=6379'] },
          State: { Status: 'running', ExitCode: 0, OOMKilled: false, Restarting: false },
          Mounts: [{ Source: '/data', Destination: '/data' }],
        }),
      }),
    } as any);

    const result = await dockerInspectContainerTool.execute({
      containerId: 'c1e2d3f4a5b6',
    });

    expect(result.name).toBe('payment-redis');
    expect(result.state).toBe('running');
    expect(result.exitCode).toBe(0);
    expect(result.oomKilled).toBe(false);
  });

  it('TC-TOOL-17: docker_get_logs retrieves stdout and stderr logs', async () => {
    vi.spyOn(dockerClient, 'getDockerClient').mockReturnValueOnce({
      getContainer: vi.fn().mockReturnValueOnce({
        logs: vi.fn().mockResolvedValueOnce(
          Buffer.from('2026-11-15T12:00:00Z [INFO] Server started\n2026-11-15T12:01:00Z [WARN] Slow query detected\n')
        ),
      }),
    } as any);

    const result = await dockerGetLogsTool.execute({
      containerId: 'c1e2d3f4a5b6',
      tail: 50,
      stdout: true,
      stderr: true,
    });

    expect(result.containerId).toBe('c1e2d3f4a5b6');
    expect(result.linesCount).toBe(2);
    expect(result.lines[0]).toContain('[INFO] Server started');
    expect(result.lines[1]).toContain('[WARN] Slow query detected');
  });

  it('TC-TOOL-18: docker_restart_container restarts container with timeout', async () => {
    const restartMock = vi.fn().mockResolvedValueOnce({});
    vi.spyOn(dockerClient, 'getDockerClient').mockReturnValueOnce({
      getContainer: vi.fn().mockReturnValueOnce({
        restart: restartMock,
      }),
    } as any);

    const result = await dockerRestartContainerTool.execute({
      containerId: 'c1e2d3f4a5b6',
      timeoutSeconds: 5,
    });

    expect(result.success).toBe(true);
    expect(restartMock).toHaveBeenCalledWith({ t: 5 });
  });

  // ─── 6. ToolRegistry Operations ──────────────────────────────────────────

  it('TC-TOOL-19: ToolRegistry registers, retrieves, and lists tools', () => {
    const registry = new ToolRegistry();
    expect(registry.list()).toHaveLength(0);

    registry.register(k8sGetResourcesTool);
    registry.register(dockerListContainersTool);

    expect(registry.has('k8s_get_resources')).toBe(true);
    expect(registry.has('docker_list_containers')).toBe(true);
    expect(registry.has('non_existent')).toBe(false);

    expect(registry.get('k8s_get_resources')?.name).toBe('k8s_get_resources');
    expect(registry.list()).toHaveLength(2);
  });

  it('TC-TOOL-20: ToolRegistry filters tools by safety level and risk level', () => {
    const registry = new ToolRegistry();
    registry.registerAll([
      k8sGetResourcesTool,
      k8sApplyManifestTool,
      dockerRestartContainerTool,
    ]);

    const readOnly = registry.filterBySafety('read_only');
    expect(readOnly).toHaveLength(1);
    expect(readOnly[0].name).toBe('k8s_get_resources');

    const mutating = registry.filterBySafety('mutating');
    expect(mutating).toHaveLength(2);

    const highRisk = registry.filterByRisk('high');
    expect(highRisk).toHaveLength(1);
    expect(highRisk[0].name).toBe('k8s_apply_manifest');

    const mediumRisk = registry.filterByRisk('medium');
    expect(mediumRisk).toHaveLength(1);
    expect(mediumRisk[0].name).toBe('docker_restart_container');
  });

  it('TC-TOOL-21: ToolRegistry.invoke() executes tool with validated arguments', async () => {
    const registry = new ToolRegistry();
    const mockTool = createDeclarativeTool({
      name: 'echo_tool',
      description: 'Echos message',
      schema: z.object({ message: z.string() }),
      execute: async ({ message }) => ({ echo: message }),
    });

    registry.register(mockTool);
    const result = await registry.invoke('echo_tool', { message: 'hello world' });
    expect(result).toEqual({ echo: 'hello world' });
  });

  it('TC-TOOL-22: ToolRegistry.invoke() rejects invalid arguments before execution', async () => {
    const registry = new ToolRegistry();
    const execMock = vi.fn();
    const mockTool = createDeclarativeTool({
      name: 'strict_tool',
      description: 'Strict tool',
      schema: z.object({ count: z.number().int().positive() }),
      execute: execMock,
    });

    registry.register(mockTool);

    // Missing field
    await expect(registry.invoke('strict_tool', {})).rejects.toThrow();
    // Negative integer
    await expect(registry.invoke('strict_tool', { count: -5 })).rejects.toThrow();
    // String instead of number
    await expect(registry.invoke('strict_tool', { count: '10' })).rejects.toThrow();

    expect(execMock).not.toHaveBeenCalled();
  });

  it('TC-TOOL-23: ToolRegistry.invoke() throws on unregistered tool', async () => {
    const registry = new ToolRegistry();
    await expect(registry.invoke('unknown_tool', {})).rejects.toThrow(
      "Declarative tool 'unknown_tool' not found."
    );
  });

  it('TC-TOOL-24: ToolRegistry exports FunctionDeclarations and Tools for Gemini SDK', () => {
    const registry = new ToolRegistry();
    registry.register(k8sGetResourcesTool);
    registry.register(dockerListContainersTool);

    const declarations = registry.getDeclarations();
    expect(declarations).toHaveLength(2);
    expect(declarations[0].name).toBe('k8s_get_resources');
    expect(declarations[0].description).toBeDefined();
    expect(declarations[0].parameters).toBeDefined();

    const geminiTools = registry.toGeminiTools();
    expect(geminiTools).toHaveLength(1);
    expect(geminiTools[0].functionDeclarations).toHaveLength(2);
  });

  it('TC-TOOL-25: Dual interface compatibility (safety/safetyLevel, parameters/schema, invoke/execute)', async () => {
    const tool = k8sGetPodTool;
    // Dual safety getters
    expect(tool.safety).toBe(tool.safetyLevel);
    // Dual schema getters
    expect(tool.parameters).toBe(tool.schema);

    // Registry dual dispatch methods
    const registry = new DeclarativeToolRegistry();
    registry.register(tool);

    vi.spyOn(k8sPods, 'getRunningPods').mockResolvedValue([
      { name: 'test-pod', namespace: 'default', status: 'Running', restarts: 0, node: 'node-1' },
    ]);

    const res1 = await registry.invoke('k8s_get_pod', { name: 'test-pod' });
    const res2 = await registry.execute('k8s_get_pod', { name: 'test-pod' });
    expect(res1.pod).toBe('test-pod');
    expect(res2.pod).toBe('test-pod');

    // Default tool registry has pre-populated standard tools
    expect(defaultToolRegistry.has('k8s_get_resources')).toBe(true);
    expect(defaultToolRegistry.has('docker_list_containers')).toBe(true);
  });
});
