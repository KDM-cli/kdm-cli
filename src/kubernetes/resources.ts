import type * as k8s from '@kubernetes/client-node';
import {
  getAppsApi,
  getAutoscalingApi,
  getBatchApi,
  getCustomObjectsApi,
  getK8sApi,
  getNetworkingApi,
  getPolicyApi,
  getStorageApi,
  type KubernetesClientOptions,
} from './client';

export interface KubernetesResourceOptions extends KubernetesClientOptions {
  namespace?: string;
  labelSelector?: string;
}

/**
 * Checks if the caught error matches a 404 NotFound HTTP status code.
 * @param error Caught exception object.
 * @returns True if code is 404, False otherwise.
 */
const isNotFoundError = (error: unknown): boolean => {
  if (error && typeof error === 'object') {
    const statusCode = (error as any).statusCode ?? (error as any).response?.statusCode ?? (error as any).code;
    return statusCode === 404;
  }
  return false;
};

// ─── Core V1 Resources ─────────────────────────────────────────────

/**
 * Queries the cluster to retrieve a list of Pods matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of Pod resources.
 */
export const listPods = async (options: KubernetesResourceOptions = {}): Promise<k8s.V1Pod[]> => {
  const api = getK8sApi(options);
  const response = options.namespace
    ? await api.listNamespacedPod({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listPodForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

/**
 * Queries the cluster to retrieve a list of Services matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of Service resources.
 */
export const listServices = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1Service[]> => {
  const api = getK8sApi(options);
  const response = options.namespace
    ? await api.listNamespacedService({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listServiceForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

/**
 * Queries the cluster to retrieve a list of PersistentVolumeClaims matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of PVC resources.
 */
export const listPersistentVolumeClaims = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1PersistentVolumeClaim[]> => {
  const api = getK8sApi(options);
  const response = options.namespace
    ? await api.listNamespacedPersistentVolumeClaim({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listPersistentVolumeClaimForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

/**
 * Queries the cluster to retrieve a list of Nodes matching filters.
 * @param options Client configs and selectors.
 * @returns List of Node resources.
 */
export const listNodes = async (options: KubernetesResourceOptions = {}): Promise<k8s.V1Node[]> => {
  const api = getK8sApi(options);
  const response = await api.listNode({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

/**
 * Queries the cluster to retrieve a list of ConfigMaps matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of ConfigMap resources.
 */
export const listConfigMaps = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1ConfigMap[]> => {
  const api = getK8sApi(options);
  const response = options.namespace
    ? await api.listNamespacedConfigMap({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listConfigMapForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

/**
 * Queries the cluster to retrieve a list of Events matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of Event resources.
 */
export const listEvents = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.CoreV1Event[]> => {
  const api = getK8sApi(options);
  const response = options.namespace
    ? await api.listNamespacedEvent({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listEventForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

/**
 * Reads detailed Endpoint mapping configurations for a specific Service.
 * Suppresses NotFound (404) errors by returning undefined.
 * @param name Service name.
 * @param namespace Namespace name.
 * @param options Client config settings.
 * @returns Endpoints detail or undefined.
 */
export const readEndpoints = async (
  name: string,
  namespace: string,
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1Endpoints | undefined> => {
  const api = getK8sApi(options);
  try {
    return await api.readNamespacedEndpoints({ name, namespace });
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
};

/**
 * Reads Pod logs for a specific container.
 * @param name Pod name.
 * @param namespace Namespace name.
 * @param container Container name.
 * @param options Client config settings.
 * @returns Log string or empty string on failure.
 */
export const readPodLog = async (
  name: string,
  namespace: string,
  container: string,
  options: KubernetesResourceOptions = {},
): Promise<string> => {
  const api = getK8sApi(options);
  try {
    const response = await api.readNamespacedPodLog({ name, namespace, container, tailLines: 100 });
    return typeof response === 'string' ? response : '';
  } catch {
    return '';
  }
};

// ─── Apps V1 Resources ──────────────────────────────────────────────

/**
 * Queries the cluster to retrieve a list of Deployments matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of Deployment resources.
 */
export const listDeployments = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1Deployment[]> => {
  const api = getAppsApi(options);
  const response = options.namespace
    ? await api.listNamespacedDeployment({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listDeploymentForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

/**
 * Queries the cluster to retrieve a list of ReplicaSets matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of ReplicaSet resources.
 */
export const listReplicaSets = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1ReplicaSet[]> => {
  const api = getAppsApi(options);
  const response = options.namespace
    ? await api.listNamespacedReplicaSet({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listReplicaSetForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

/**
 * Queries the cluster to retrieve a list of StatefulSets matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of StatefulSet resources.
 */
export const listStatefulSets = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1StatefulSet[]> => {
  const api = getAppsApi(options);
  const response = options.namespace
    ? await api.listNamespacedStatefulSet({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listStatefulSetForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

/**
 * Queries the cluster to retrieve a list of DaemonSets matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of DaemonSet resources.
 */
export const listDaemonSets = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1DaemonSet[]> => {
  const api = getAppsApi(options);
  const response = options.namespace
    ? await api.listNamespacedDaemonSet({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listDaemonSetForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

// ─── Batch V1 Resources ─────────────────────────────────────────────

/**
 * Queries the cluster to retrieve a list of Jobs matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of Job resources.
 */
export const listJobs = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1Job[]> => {
  const api = getBatchApi(options);
  const response = options.namespace
    ? await api.listNamespacedJob({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listJobForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

/**
 * Queries the cluster to retrieve a list of CronJobs matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of CronJob resources.
 */
export const listCronJobs = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1CronJob[]> => {
  const api = getBatchApi(options);
  const response = options.namespace
    ? await api.listNamespacedCronJob({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listCronJobForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

// ─── Networking V1 Resources ────────────────────────────────────────

/**
 * Queries the cluster to retrieve a list of Ingresses matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of Ingress resources.
 */
export const listIngresses = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1Ingress[]> => {
  const api = getNetworkingApi(options);
  const response = options.namespace
    ? await api.listNamespacedIngress({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listIngressForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

/**
 * Queries the cluster to retrieve a list of NetworkPolicies matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of NetworkPolicy resources.
 */
export const listNetworkPolicies = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1NetworkPolicy[]> => {
  const api = getNetworkingApi(options);
  const response = options.namespace
    ? await api.listNamespacedNetworkPolicy({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listNetworkPolicyForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

// ─── Autoscaling V2 Resources ───────────────────────────────────────

/**
 * Queries the cluster to retrieve a list of HPAs matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of HPA resources.
 */
export const listHPAs = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V2HorizontalPodAutoscaler[]> => {
  const api = getAutoscalingApi(options);
  const response = options.namespace
    ? await api.listNamespacedHorizontalPodAutoscaler({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listHorizontalPodAutoscalerForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

// ─── Policy V1 Resources ────────────────────────────────────────────

/**
 * Queries the cluster to retrieve a list of PDBs matching filters and namespace.
 * @param options Target namespace, client configs, and selectors.
 * @returns List of PDB resources.
 */
export const listPDBs = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1PodDisruptionBudget[]> => {
  const api = getPolicyApi(options);
  const response = options.namespace
    ? await api.listNamespacedPodDisruptionBudget({ namespace: options.namespace, labelSelector: options.labelSelector })
    : await api.listPodDisruptionBudgetForAllNamespaces({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

// ─── Storage V1 Resources ───────────────────────────────────────────

/**
 * Queries the cluster to retrieve a list of StorageClasses.
 * @param options Client configs and selectors.
 * @returns List of StorageClass resources.
 */
export const listStorageClasses = async (
  options: KubernetesResourceOptions = {},
): Promise<k8s.V1StorageClass[]> => {
  const api = getStorageApi(options);
  const response = await api.listStorageClass({ labelSelector: options.labelSelector });
  return response.items ?? [];
};

// ─── Gateway API (Custom Resources) ────────────────────────────────

/** Gateway API group and version constants. */
const GATEWAY_API_GROUP = 'gateway.networking.k8s.io';
const GATEWAY_API_VERSION = 'v1';

/**
 * Lists Gateway API custom resources of a specific kind.
 * @param plural The plural resource name (e.g. 'gatewayclasses').
 * @param options Resource query options.
 * @returns Array of custom resource objects.
 */
const listGatewayResources = async (
  plural: string,
  options: KubernetesResourceOptions = {},
  clusterScoped = false,
): Promise<any[]> => {
  const api = getCustomObjectsApi(options);
  try {
    const response = options.namespace && !clusterScoped
      ? await api.listNamespacedCustomObject({ group: GATEWAY_API_GROUP, version: GATEWAY_API_VERSION, namespace: options.namespace, plural })
      : await api.listClusterCustomObject({ group: GATEWAY_API_GROUP, version: GATEWAY_API_VERSION, plural });
    return (response as any)?.items ?? [];
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
};

/**
 * Queries the cluster for GatewayClass resources.
 * @param options Client configs and selectors.
 * @returns List of GatewayClass resources.
 */
export const listGatewayClasses = async (options: KubernetesResourceOptions = {}): Promise<any[]> =>
  listGatewayResources('gatewayclasses', options, true);

/**
 * Queries the cluster for Gateway resources.
 * @param options Client configs and selectors.
 * @returns List of Gateway resources.
 */
export const listGateways = async (options: KubernetesResourceOptions = {}): Promise<any[]> =>
  listGatewayResources('gateways', options);

/**
 * Queries the cluster for HTTPRoute resources.
 * @param options Client configs and selectors.
 * @returns List of HTTPRoute resources.
 */
export const listHTTPRoutes = async (options: KubernetesResourceOptions = {}): Promise<any[]> =>
  listGatewayResources('httproutes', options);

// ─── Utilities ──────────────────────────────────────────────────────

/**
 * Converts a simple key-value label map into a standard labelSelector string.
 * @param labels Key-value map.
 * @returns Formatted labelSelector selector.
 */
export const labelsToSelector = (labels: Record<string, string> = {}) =>
  Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
