import { getK8sApi, getCustomObjectsApi } from './client';
import type * as k8s from '@kubernetes/client-node';
import { triggerAlert } from '../monitor/alerts';
import { logger } from '../utils/logger';

export interface PodData {
  name: string;
  namespace: string;
  status: string;
  restarts: number;
  node: string;
}

export const getRunningPods = async (options?: { forceAlert?: boolean }): Promise<PodData[]> => {
  const api = getK8sApi();
  try {
    const res = await api.listPodForAllNamespaces();
    return (res.items ?? []).map((pod: k8s.V1Pod) => {
      const name = pod.metadata?.name || 'Unknown';
      const phase = pod.status?.phase || 'Unknown';
      const containerStatuses = pod.status?.containerStatuses || [];
      const restarts = containerStatuses.reduce((acc: number, status: k8s.V1ContainerStatus) => acc + status.restartCount, 0);

      // Check for failures
      let failureReason = '';
      if (phase === 'Failed') {
        failureReason = 'Pod phase is FAILED';
      } else {
        for (const status of containerStatuses) {
          if (status.state?.waiting) {
            const reason = status.state.waiting.reason;
            if (reason === 'CrashLoopBackOff' || reason === 'ImagePullBackOff' || reason === 'CreateContainerConfigError') {
              failureReason = `Container ${status.name} is in ${reason}`;
              break;
            }
          }
        }
      }

      if (failureReason) {
        triggerAlert({
          id: `pod:${name}:failure`,
          type: 'pod',
          severity: 'critical',
          message: `Pod ${name} in namespace ${pod.metadata?.namespace} failed: ${failureReason}`,
        }, { force: options?.forceAlert });
      }

      return {
        name,
        namespace: pod.metadata?.namespace || 'default',
        status: phase,
        restarts,
        node: pod.spec?.nodeName || 'Unknown',
      };
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to fetch Kubernetes pods: ${errorMessage}`);
    throw error;
  }
};

export interface K8sClusterStats {
  /** The aggregated CPU usage/requests representation. */
  cpu: string;
  /** The aggregated memory usage/requests representation. */
  memory: string;
  /** The source of the statistics. */
  source: 'metrics-server' | 'requests' | 'N/A';
}

/**
 * Parses a Kubernetes CPU quantity (e.g., "450m", "2", "125000000n") into millicores.
 * @param q The CPU quantity representation as a string or number.
 * @returns The parsed CPU value in millicores.
 */
export function parseK8sCpuQuantity(q: string | number): number {
  if (typeof q === 'number') return q * 1000;
  if (!q) return 0;
  const match = q.trim().match(/^([0-9.]+)([a-zA-Z]*)$/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const suffix = match[2];
  switch (suffix) {
    case 'n':
      return val / 1000000; // nanocores to millicores
    case 'u':
      return val / 1000; // microcores to millicores
    case 'm':
      return val;
    case '':
      return val * 1000; // cores to millicores
    default:
      return 0;
  }
}

/**
 * Parses a Kubernetes memory quantity (e.g., "1Gi", "512Mi", "2k") into bytes.
 * @param q The memory quantity representation as a string or number.
 * @returns The parsed memory value in bytes.
 */
export function parseK8sMemoryQuantity(q: string | number): number {
  if (typeof q === 'number') return q;
  if (!q) return 0;
  const match = q.trim().match(/^([0-9.]+)([a-zA-Z]*)$/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  if (Number.isNaN(val)) return 0;
  const suffix = match[2];

  if (suffix === '') {
    return val;
  }
  
  const binaryPower: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 * 1024,
    Gi: 1024 * 1024 * 1024,
    Ti: 1024 * 1024 * 1024 * 1024,
    Pi: 1024 * 1024 * 1024 * 1024 * 1024,
  };
  
  const decimalPower: Record<string, number> = {
    k: 1000,
    M: 1000 * 1000,
    G: 1000 * 1000 * 1000,
    T: 1000 * 1000 * 1000 * 1000,
    P: 1000 * 1000 * 1000 * 1000 * 1000,
  };

  if (suffix in binaryPower) {
    return val * binaryPower[suffix];
  }
  if (suffix in decimalPower) {
    return val * decimalPower[suffix];
  }
  return 0;
}

/**
 * Formats a byte number to binary-scaled string (e.g. "2GiB").
 * @param bytes The raw number of bytes.
 * @returns Binary-formatted bytes string.
 */
export const formatK8sBytes = (bytes: number): string => {
  if (bytes <= 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const num = bytes / Math.pow(k, i);
  return `${parseFloat(num.toFixed(1))}${sizes[i]}`;
};

/**
 * Sums up CPU and Memory usage from metrics-server node items.
 * @param items Node metrics items from custom API.
 * @returns Aggregated CPU in millicores and memory in bytes.
 */
const sumNodeMetrics = (items: any[]) => {
  let cpu = 0;
  let memory = 0;
  for (const item of items) {
    cpu += parseK8sCpuQuantity(item.usage?.cpu || '0');
    memory += parseK8sMemoryQuantity(item.usage?.memory || '0');
  }
  return { cpu, memory };
};

/**
 * Sums up CPU and Memory usage from metrics-server pod items.
 * @param items Pod metrics items from custom API.
 * @returns Aggregated CPU in millicores and memory in bytes.
 */
const sumPodMetrics = (items: any[]) => {
  let cpu = 0;
  let memory = 0;
  for (const item of items) {
    const containers = item.containers || [];
    for (const container of containers) {
      cpu += parseK8sCpuQuantity(container.usage?.cpu || '0');
      memory += parseK8sMemoryQuantity(container.usage?.memory || '0');
    }
  }
  return { cpu, memory };
};

/**
 * Checks if a pod's status phase should be considered for native requests fallback.
 * @param phase The pod phase status string.
 * @returns True if the pod is active, false otherwise.
 */
const isActivePodPhase = (phase?: string): boolean => {
  return phase === 'Running' || phase === 'Pending';
};

/**
 * Sums container requests for a single container.
 * @param container The Kubernetes container spec.
 * @returns Object with parsed CPU and Memory requests.
 */
const getContainerRequests = (container: any) => {
  const reqs = container.resources?.requests;
  return {
    cpu: reqs?.cpu ? parseK8sCpuQuantity(reqs.cpu) : 0,
    memory: reqs?.memory ? parseK8sMemoryQuantity(reqs.memory) : 0,
  };
};

/**
 * Sums up requests for a single pod's containers.
 * @param pod The Kubernetes pod object.
 * @returns Object with parsed CPU and Memory requests.
 */
const sumPodRequests = (pod: any) => {
  let cpu = 0;
  let memory = 0;
  const containers = pod.spec?.containers || [];
  
  for (const container of containers) {
    const req = getContainerRequests(container);
    cpu += req.cpu;
    memory += req.memory;
  }
  return { cpu, memory };
};

/**
 * Sums up resource requests from a list of pods.
 * @param pods List of pods to aggregate requests from.
 * @returns Aggregated CPU requests in millicores and memory requests in bytes.
 */
const sumAllPodsRequests = (pods: any[]) => {
  let cpu = 0;
  let memory = 0;
  for (const pod of pods) {
    if (isActivePodPhase(pod.status?.phase)) {
      const podReq = sumPodRequests(pod);
      cpu += podReq.cpu;
      memory += podReq.memory;
    }
  }
  return { cpu, memory };
};

/**
 * Fetches metrics-server node stats.
 * @returns Node metrics, or null if it fails or returns no nodes.
 */
const fetchNodeMetrics = async () => {
  try {
    const customApi = getCustomObjectsApi();
    const res = await customApi.listClusterCustomObject({
      group: 'metrics.k8s.io',
      version: 'v1beta1',
      plural: 'nodes',
    });
    const items = (res as any)?.items || [];
    return items.length > 0 ? sumNodeMetrics(items) : null;
  } catch {
    return null;
  }
};

/**
 * Fetches metrics-server pod stats.
 * @returns Pod metrics, or null if it fails or returns no pods.
 */
const fetchPodMetrics = async () => {
  try {
    const customApi = getCustomObjectsApi();
    const res = await customApi.listClusterCustomObject({
      group: 'metrics.k8s.io',
      version: 'v1beta1',
      plural: 'pods',
    });
    const items = (res as any)?.items || [];
    return items.length > 0 ? sumPodMetrics(items) : null;
  } catch {
    return null;
  }
};

/**
 * Fetches native pod resource requests sum.
 * @returns Native pod resource requests, or null if it fails or has no metrics.
 */
const fetchNativeRequests = async () => {
  try {
    const api = getK8sApi();
    const res = await api.listPodForAllNamespaces();
    const pods = res.items || [];
    const stats = sumAllPodsRequests(pods);
    return (stats.cpu > 0 || stats.memory > 0) ? stats : null;
  } catch {
    return null;
  }
};

/**
 * Fetches the aggregated CPU and Memory statistics for the Kubernetes cluster,
 * checking metrics-server node metrics, metrics-server pod metrics, or falling
 * back to native pod requests sum.
 * @returns Kubernetes cluster stats.
 */
export const getK8sClusterStats = async (): Promise<K8sClusterStats> => {
  const nodeStats = await fetchNodeMetrics();
  if (nodeStats) {
    return {
      cpu: `${Math.round(nodeStats.cpu)}m`,
      memory: formatK8sBytes(nodeStats.memory),
      source: 'metrics-server',
    };
  }

  const podStats = await fetchPodMetrics();
  if (podStats) {
    return {
      cpu: `${Math.round(podStats.cpu)}m`,
      memory: formatK8sBytes(podStats.memory),
      source: 'metrics-server',
    };
  }

  const nativeRequests = await fetchNativeRequests();
  if (nativeRequests) {
    return {
      cpu: `${Math.round(nativeRequests.cpu)}m`,
      memory: formatK8sBytes(nativeRequests.memory),
      source: 'requests',
    };
  }

  return {
    cpu: 'N/A',
    memory: 'N/A',
    source: 'N/A',
  };
};


