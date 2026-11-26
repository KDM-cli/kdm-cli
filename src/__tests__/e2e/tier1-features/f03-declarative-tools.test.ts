import { describe, it, expect } from 'vitest';
import {
  DeclarativeToolRegistry,
  k8sGetPodTool,
  k8sListPodsTool,
  dockerInspectContainerTool,
  k8sApplyPatchTool,
} from '../harness';

describe('Tier 1: F-03 Declarative Cluster Tools', () => {
  it('TC-E2E-T1-F03-01: Read-only Kubernetes tool execution (k8s_get_pod, safety: "read_only")', async () => {
    expect(k8sGetPodTool.safety).toBe('read_only');
    expect(k8sGetPodTool.riskLevel).toBe('low');

    const result = await k8sGetPodTool.execute({
      name: 'payment-service-8f4b-2x9p',
      namespace: 'production',
    });

    expect(result).toBeDefined();
    expect(result.pod).toBe('payment-service-8f4b-2x9p');
    expect(result.namespace).toBe('production');
    expect(result.exitCode).toBe(137);
  });

  it('TC-E2E-T1-F03-02: Read-only Docker tool execution (docker_inspect_container, safety: "read_only")', async () => {
    expect(dockerInspectContainerTool.safety).toBe('read_only');
    expect(dockerInspectContainerTool.riskLevel).toBe('low');

    const result = await dockerInspectContainerTool.execute({
      containerId: 'c1e2d3f4a5b6',
    });

    expect(result.containerId).toBe('c1e2d3f4a5b6');
    expect(result.state).toBe('restarting');
    expect(result.exitCode).toBe(1);
    expect(result.status).toContain('Restarting');
  });

  it('TC-E2E-T1-F03-03: Mutating Kubernetes remediation tool safety tagging (k8s_apply_patch, safety: "mutating")', async () => {
    expect(k8sApplyPatchTool.safety).toBe('mutating');
    expect(k8sApplyPatchTool.riskLevel).toBe('high');

    const patchPayload = '{"spec":{"replicas":3}}';
    const result = await k8sApplyPatchTool.execute({
      resource: 'deployment/payment-service',
      namespace: 'production',
      patch: patchPayload,
    });

    expect(result.success).toBe(true);
    expect(result.appliedTo).toBe('production/deployment/payment-service');
  });

  it('TC-E2E-T1-F03-04: Parameter schema validation failure rejection via Zod before cluster call', async () => {
    const registry = new DeclarativeToolRegistry();
    registry.register(k8sGetPodTool);

    // Missing required field 'name'
    await expect(registry.invoke('k8s_get_pod', { namespace: 'default' })).rejects.toThrow();

    // Invalid type for 'name'
    await expect(registry.invoke('k8s_get_pod', { name: 12345 })).rejects.toThrow();
  });

  it('TC-E2E-T1-F03-05: Cluster tool registry discovery and listing for Gemini SDK function declarations', () => {
    const registry = new DeclarativeToolRegistry();
    registry.register(k8sGetPodTool);
    registry.register(k8sListPodsTool);
    registry.register(dockerInspectContainerTool);
    registry.register(k8sApplyPatchTool);

    const declarations = registry.getDeclarations();
    expect(declarations).toHaveLength(4);

    const names = declarations.map((d) => d.name);
    expect(names).toContain('k8s_get_pod');
    expect(names).toContain('k8s_list_pods');
    expect(names).toContain('docker_inspect_container');
    expect(names).toContain('k8s_apply_patch');

    for (const decl of declarations) {
      expect(decl.description).toBeDefined();
      expect(decl.parameters).toBeDefined();
    }
  });
});
