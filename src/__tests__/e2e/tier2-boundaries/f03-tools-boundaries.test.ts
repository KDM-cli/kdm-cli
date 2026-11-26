import { describe, it, expect, vi } from 'vitest';
import {
  k8sApplyPatchTool,
  k8sGetPodTool,
  k8sGetLogsTool,
  DeclarativeToolRegistry,
  MockClusterEnvironment,
} from '../harness';

describe('Tier 2: F-03 Declarative Tools Boundaries & Corner Cases', () => {
  it('TC-E2E-T2-F03-01: Kubernetes control plane timeout (5000ms watchdog abort)', async () => {
    const cluster = new MockClusterEnvironment().setHangingScenario().install();

    await expect(
      k8sGetPodTool.execute({ name: 'payment-service', namespace: 'default', timeoutMs: 5000 })
    ).rejects.toThrow('ClusterTimeoutError: Control plane did not respond in 5000ms');

    cluster.reset();
  });

  it('TC-E2E-T2-F03-02: Docker daemon socket unreachable (/var/run/docker.sock inactive)', async () => {
    const cluster = new MockClusterEnvironment().setDisconnectedScenario(false, true).install();

    const { getRunningContainers } = await import('../../../docker/containers');
    await expect(getRunningContainers()).rejects.toThrow(
      'Cannot connect to the Docker daemon. Is Docker running?'
    );

    cluster.reset();
  });

  it('TC-E2E-T2-F03-03: Resource not found (404) in target namespace', async () => {
    const cluster = new MockClusterEnvironment().setHealthyScenario().install();

    await expect(
      k8sGetPodTool.execute({ name: 'nonexistent-pod', namespace: 'prod' })
    ).rejects.toThrow("Pod 'nonexistent-pod' not found in namespace 'prod'");

    cluster.reset();
  });

  it('TC-E2E-T2-F03-04: Zero-byte / empty pod log stream handling', async () => {
    const cluster = new MockClusterEnvironment().setHealthyScenario().install();

    const result = await k8sGetLogsTool.execute({ pod: 'just-started-pod', namespace: 'default' });
    expect(result.logs).toBe('');
    expect(result.note).toBe('Log stream empty');

    cluster.reset();
  });

  it('TC-E2E-T2-F03-05: Malformed YAML syntax patch rejected before cluster submission', async () => {
    const malformedPatch = ':::broken-yaml invalid: [unclosed';

    await expect(
      k8sApplyPatchTool.execute({
        resource: 'deployment/cart',
        namespace: 'default',
        patch: malformedPatch,
      })
    ).rejects.toThrow('YAML syntax error');
  });
});
