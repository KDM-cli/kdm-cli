import { getK8sApi } from './client';

export interface PodData {
  name: string;
  namespace: string;
  status: string;
  restarts: number;
  node: string;
}

export const getRunningPods = async (): Promise<PodData[]> => {
  const api = getK8sApi();
  try {
    const res = await api.listPodForAllNamespaces();
    return res.body.items.map((pod) => {
      const containerStatuses = pod.status?.containerStatuses || [];
      const restarts = containerStatuses.reduce((acc, status) => acc + status.restartCount, 0);

      return {
        name: pod.metadata?.name || 'Unknown',
        namespace: pod.metadata?.namespace || 'default',
        status: pod.status?.phase || 'Unknown',
        restarts,
        node: pod.spec?.nodeName || 'Unknown',
      };
    });
  } catch (error) {
    return [];
  }
};
