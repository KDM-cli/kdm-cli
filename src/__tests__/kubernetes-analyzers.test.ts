import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listDeployments,
  listNodes,
  listPersistentVolumeClaims,
  listPods,
  listServices,
  readEndpoints,
} from '../kubernetes/resources';
import {
  DeploymentAnalyzer,
  NodeAnalyzer,
  PersistentVolumeClaimAnalyzer,
  PodAnalyzer,
  ServiceAnalyzer,
} from '../analyzers';

vi.mock('../kubernetes/resources', () => ({
  listPods: vi.fn(async () => []),
  listDeployments: vi.fn(async () => []),
  listServices: vi.fn(async () => []),
  listPersistentVolumeClaims: vi.fn(async () => []),
  listNodes: vi.fn(async () => []),
  readEndpoints: vi.fn(async () => undefined),
  labelsToSelector: (labels: Record<string, string> = {}) =>
    Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(','),
}));

describe('Kubernetes analyzers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects pod CrashLoopBackOff and high restarts', async () => {
    vi.mocked(listPods).mockResolvedValueOnce([
      {
        metadata: { name: 'api', namespace: 'default' },
        status: {
          phase: 'Running',
          containerStatuses: [
            {
              name: 'api',
              ready: false,
              restartCount: 5,
              state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off restarting failed container' } },
            },
          ],
        },
      } as any,
    ]);

    const results = await PodAnalyzer.analyze({});

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('Pod');
    expect(results[0].name).toBe('api');
    expect(results[0].errors.map((error) => error.text).join('\n')).toContain('CrashLoopBackOff');
    expect(results[0].errors.map((error) => error.text).join('\n')).toContain('restarted 5 times');
  });

  it('returns no pod result for healthy pods', async () => {
    vi.mocked(listPods).mockResolvedValueOnce([
      {
        metadata: { name: 'api', namespace: 'default' },
        status: {
          phase: 'Running',
          containerStatuses: [{ name: 'api', ready: true, restartCount: 0, state: { running: {} } }],
        },
      } as any,
    ]);

    await expect(PodAnalyzer.analyze({})).resolves.toEqual([]);
  });

  it('does not flag successfully completed batch pods as unready', async () => {
    vi.mocked(listPods).mockResolvedValueOnce([
      {
        metadata: { name: 'completed-job', namespace: 'default' },
        status: {
          phase: 'Succeeded',
          containerStatuses: [{ name: 'job', ready: false, restartCount: 0, state: { terminated: { reason: 'Completed' } } }],
        },
      } as any,
    ]);

    await expect(PodAnalyzer.analyze({})).resolves.toEqual([]);
  });

  it('reports failures in init container statuses', async () => {
    vi.mocked(listPods).mockResolvedValueOnce([
      {
        metadata: { name: 'api', namespace: 'default' },
        status: {
          phase: 'Pending',
          initContainerStatuses: [{
            name: 'init-config',
            ready: false,
            restartCount: 1,
            state: { waiting: { reason: 'ImagePullBackOff' } },
          }],
        },
      } as any,
    ]);

    const results = await PodAnalyzer.analyze({});
    expect(results).toHaveLength(1);
    expect(results[0].errors.map((error) => error.text).join('\n')).toContain('init-config');
    expect(results[0].errors.map((error) => error.text).join('\n')).toContain('ImagePullBackOff');
  });

  it('detects deployments with unavailable replicas and progress deadline failures', async () => {
    vi.mocked(listDeployments).mockResolvedValueOnce([
      {
        metadata: { name: 'web', namespace: 'default' },
        spec: { replicas: 3 },
        status: {
          availableReplicas: 1,
          unavailableReplicas: 2,
          conditions: [
            { type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded', message: 'rollout stuck' },
          ],
        },
      } as any,
    ]);

    const results = await DeploymentAnalyzer.analyze({});

    expect(results).toHaveLength(1);
    expect(results[0].errors.map((error) => error.text).join('\n')).toContain('1/3 available replicas');
    expect(results[0].errors.map((error) => error.text).join('\n')).toContain('progress deadline');
  });

  it('detects services with no matching pods and no endpoints', async () => {
    vi.mocked(listServices).mockResolvedValueOnce([
      {
        metadata: { name: 'api-service', namespace: 'default' },
        spec: { selector: { app: 'api' } },
      } as any,
    ]);
    vi.mocked(listPods).mockResolvedValueOnce([]);
    vi.mocked(readEndpoints).mockResolvedValueOnce({ subsets: [] } as any);

    const results = await ServiceAnalyzer.analyze({});

    expect(results).toHaveLength(1);
    expect(results[0].errors.map((error) => error.text).join('\n')).toContain('matches no pods');
    expect(results[0].errors.map((error) => error.text).join('\n')).toContain('no ready endpoints');
  });

  it('detects service with unresolved target port', async () => {
    vi.mocked(listServices).mockResolvedValueOnce([
      {
        metadata: { name: 'api-service', namespace: 'default' },
        spec: {
          selector: { app: 'api' },
          ports: [
            { port: 80, targetPort: 'http-port' },
            { port: 8080, targetPort: 9090 },
          ],
        },
      } as any,
    ]);
    vi.mocked(listPods).mockResolvedValueOnce([
      {
        metadata: { name: 'api-pod', namespace: 'default', labels: { app: 'api' } },
        spec: {
          containers: [
            {
              name: 'api-container',
              ports: [
                { containerPort: 8080, name: 'other-port' },
              ],
            },
          ],
        },
      } as any,
    ]);
    vi.mocked(readEndpoints).mockResolvedValueOnce({
      subsets: [{ addresses: [{ ip: '10.0.0.1' }] }],
    } as any);

    const results = await ServiceAnalyzer.analyze({});

    expect(results).toHaveLength(1);
    const errors = results[0].errors.map((error) => error.text).join('\n');
    expect(errors).toContain("Service target port 'http-port' appears unresolved");
    expect(errors).toContain('Service target port 9090 appears unresolved');
  });

  it('detects pending PVCs without a storage class and status failure conditions', async () => {
    vi.mocked(listPersistentVolumeClaims).mockResolvedValueOnce([
      {
        metadata: { name: 'data', namespace: 'default' },
        spec: {},
        status: {
          phase: 'Pending',
          conditions: [
            {
              type: 'VolumeBinding',
              status: 'False',
              reason: 'VolumeBindingFailed',
              message: 'failed to bind volume: no persistent volumes available',
            },
          ],
        },
      } as any,
    ]);

    const results = await PersistentVolumeClaimAnalyzer.analyze({});

    expect(results).toHaveLength(1);
    const errors = results[0].errors.map((error) => error.text).join('\n');
    expect(errors).toContain('pending without a storage class');
    expect(errors).toContain('VolumeBindingFailed');
    expect(errors).toContain('failed to bind volume');
  });

  it('detects NotReady and pressured nodes', async () => {
    vi.mocked(listNodes).mockResolvedValueOnce([
      {
        metadata: { name: 'worker-1' },
        spec: { unschedulable: true },
        status: {
          conditions: [
            { type: 'Ready', status: 'False', reason: 'KubeletNotReady', message: 'runtime down' },
            { type: 'DiskPressure', status: 'True', message: 'disk full' },
          ],
        },
      } as any,
    ]);

    const results = await NodeAnalyzer.analyze({});

    expect(results).toHaveLength(1);
    expect(results[0].errors.map((error) => error.text).join('\n')).toContain('not Ready');
    expect(results[0].errors.map((error) => error.text).join('\n')).toContain('DiskPressure');
    expect(results[0].errors.map((error) => error.text).join('\n')).toContain('unschedulable');
  });
});

describe('Kubernetes analyzers - API failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propagates listPods API failures', async () => {
    vi.mocked(listPods).mockRejectedValueOnce(new Error('API timeout'));
    await expect(PodAnalyzer.analyze({})).rejects.toThrow('API timeout');
  });

  it('propagates listDeployments API failures', async () => {
    vi.mocked(listDeployments).mockRejectedValueOnce(new Error('API timeout'));
    await expect(DeploymentAnalyzer.analyze({})).rejects.toThrow('API timeout');
  });

  it('handles listServices API failures gracefully via Promise.allSettled', async () => {
    vi.mocked(listServices).mockRejectedValueOnce(new Error('API timeout'));
    await expect(ServiceAnalyzer.analyze({})).rejects.toThrow('API timeout');
  });

  it('propagates listPersistentVolumeClaims API failures', async () => {
    vi.mocked(listPersistentVolumeClaims).mockRejectedValueOnce(new Error('API timeout'));
    await expect(PersistentVolumeClaimAnalyzer.analyze({})).rejects.toThrow('API timeout');
  });

  it('propagates listNodes API failures', async () => {
    vi.mocked(listNodes).mockRejectedValueOnce(new Error('API timeout'));
    await expect(NodeAnalyzer.analyze({})).rejects.toThrow('API timeout');
  });
});
