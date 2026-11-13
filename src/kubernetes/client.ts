import * as k8s from '@kubernetes/client-node';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger';

let kc: k8s.KubeConfig | null = null;
let k8sApi: k8s.CoreV1Api | null = null;
let appsApi: k8s.AppsV1Api | null = null;
let batchApi: k8s.BatchV1Api | null = null;
let networkingApi: k8s.NetworkingV1Api | null = null;
let autoscalingApi: k8s.AutoscalingV2Api | null = null;
let policyApi: k8s.PolicyV1Api | null = null;
let storageApi: k8s.StorageV1Api | null = null;
let customObjectsApi: k8s.CustomObjectsApi | null = null;
let clientKey = '';

export interface KubernetesClientOptions {
  kubeconfig?: string;
  kubecontext?: string;
}

const getClientKey = (options: KubernetesClientOptions = {}) =>
  `${options.kubeconfig ?? 'default'}::${options.kubecontext ?? 'current'}`;

/**
 * Asserts that a specified kubeconfig path points to an actual existing file on the disk.
 * @param filePath The resolved file path.
 * @throws Error if path is not a file or does not exist.
 */
const validateKubeconfigPath = (filePath: string): void => {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Kubeconfig path is not a file: ${resolved}`);
  }
};

/**
 * Resets all cached API client instances when the config key changes.
 */
const resetApiClients = (): void => {
  k8sApi = null;
  appsApi = null;
  batchApi = null;
  networkingApi = null;
  autoscalingApi = null;
  policyApi = null;
  storageApi = null;
  customObjectsApi = null;
};

/**
 * Loads, configures, and caches a KubeConfig instance based on the provided overrides.
 * @param options Options containing custom config file paths or context names.
 * @returns Cached KubeConfig instance.
 */
export const getKubeConfig = (options: KubernetesClientOptions = {}): k8s.KubeConfig => {
  const nextKey = getClientKey(options);
  if (!kc || clientKey !== nextKey) {
    kc = new k8s.KubeConfig();
    try {
      if (options.kubeconfig) {
        validateKubeconfigPath(options.kubeconfig);
        kc.loadFromFile(options.kubeconfig);
      } else {
        kc.loadFromDefault();
      }
      if (options.kubecontext) {
        kc.setCurrentContext(options.kubecontext);
      }
    } catch (e: any) {
      throw new Error(`Failed to load kubeconfig: ${e?.message || String(e)}`);
    }
    clientKey = nextKey;
    resetApiClients();
  }
  return kc;
};

/**
 * Resolves a configured instance of the CoreV1Api client.
 * @param options Options configuration.
 * @returns CoreV1Api client.
 */
export const getK8sApi = (options: KubernetesClientOptions = {}): k8s.CoreV1Api => {
  if (!k8sApi) {
    const config = getKubeConfig(options);
    k8sApi = config.makeApiClient(k8s.CoreV1Api);
  }
  return k8sApi;
};

/**
 * Resolves a configured instance of the AppsV1Api client.
 * @param options Options configuration.
 * @returns AppsV1Api client.
 */
export const getAppsApi = (options: KubernetesClientOptions = {}): k8s.AppsV1Api => {
  if (!appsApi) {
    const config = getKubeConfig(options);
    appsApi = config.makeApiClient(k8s.AppsV1Api);
  }
  return appsApi;
};

/**
 * Resolves a configured instance of the BatchV1Api client.
 * @param options Options configuration.
 * @returns BatchV1Api client.
 */
export const getBatchApi = (options: KubernetesClientOptions = {}): k8s.BatchV1Api => {
  if (!batchApi) {
    const config = getKubeConfig(options);
    batchApi = config.makeApiClient(k8s.BatchV1Api);
  }
  return batchApi;
};

/**
 * Resolves a configured instance of the NetworkingV1Api client.
 * @param options Options configuration.
 * @returns NetworkingV1Api client.
 */
export const getNetworkingApi = (options: KubernetesClientOptions = {}): k8s.NetworkingV1Api => {
  if (!networkingApi) {
    const config = getKubeConfig(options);
    networkingApi = config.makeApiClient(k8s.NetworkingV1Api);
  }
  return networkingApi;
};

/**
 * Resolves a configured instance of the AutoscalingV2Api client.
 * @param options Options configuration.
 * @returns AutoscalingV2Api client.
 */
export const getAutoscalingApi = (options: KubernetesClientOptions = {}): k8s.AutoscalingV2Api => {
  if (!autoscalingApi) {
    const config = getKubeConfig(options);
    autoscalingApi = config.makeApiClient(k8s.AutoscalingV2Api);
  }
  return autoscalingApi;
};

/**
 * Resolves a configured instance of the PolicyV1Api client.
 * @param options Options configuration.
 * @returns PolicyV1Api client.
 */
export const getPolicyApi = (options: KubernetesClientOptions = {}): k8s.PolicyV1Api => {
  if (!policyApi) {
    const config = getKubeConfig(options);
    policyApi = config.makeApiClient(k8s.PolicyV1Api);
  }
  return policyApi;
};

/**
 * Resolves a configured instance of the StorageV1Api client.
 * @param options Options configuration.
 * @returns StorageV1Api client.
 */
export const getStorageApi = (options: KubernetesClientOptions = {}): k8s.StorageV1Api => {
  if (!storageApi) {
    const config = getKubeConfig(options);
    storageApi = config.makeApiClient(k8s.StorageV1Api);
  }
  return storageApi;
};

/**
 * Resolves a configured instance of the CustomObjectsApi client.
 * @param options Options configuration.
 * @returns CustomObjectsApi client.
 */
export const getCustomObjectsApi = (options: KubernetesClientOptions = {}): k8s.CustomObjectsApi => {
  if (!customObjectsApi) {
    const config = getKubeConfig(options);
    customObjectsApi = config.makeApiClient(k8s.CustomObjectsApi);
  }
  return customObjectsApi;
};

export const checkK8sConnection = async (): Promise<{ connected: boolean; podCount: number }> => {
  try {
    const api = getK8sApi();
    const res = await api.listPodForAllNamespaces();
    const runningPods = (res.items ?? []).filter((pod: k8s.V1Pod) => pod.status?.phase === 'Running');
    return {
      connected: true,
      podCount: runningPods.length,
    };
  } catch (error) {
    // Cluster-wide pod listing requires a ClusterRole. A successful Kubernetes
    // version request still proves connectivity without requiring pod permissions.
    try {
      const config = getKubeConfig();
      await config.makeApiClient(k8s.VersionApi).getCode();
      return { connected: true, podCount: 0 };
    } catch {
      return { connected: false, podCount: 0 };
    }
  }
};

