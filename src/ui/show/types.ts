import type { PodData, K8sClusterStats } from '../../kubernetes/pods';
import type { ContainerData, DockerSystemStats } from '../../docker/containers';
import type * as k8s from '@kubernetes/client-node';

export enum TabType {
  Pods = 'Pods',
  Containers = 'Containers',
  Nodes = 'Nodes',
  Runners = 'Runners',
  Minikube = 'Minikube',
}

export interface TabConfig {
  key: TabType;
  label: string;
  count: number;
  disconnected?: boolean;
}

export interface Column {
  header: string;
  minWidth: number;
  isPrimary?: boolean;
}

export interface PodRow {
  type: TabType.Pods;
  name: string;
  namespace: string;
  status: string;
  restarts: number;
  node: string;
  cpu?: string;
  memory?: string;
}

export interface ContainerRow {
  type: TabType.Containers;
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  cpu?: string;
  memory?: string;
}

export interface NodeRow {
  type: TabType.Nodes;
  name: string;
  status: string;
  role: string;
  internalIp: string;
  cpu: string;
  memory: string;
  osImage: string;
}

export interface RunnerRow {
  type: TabType.Runners;
  kind: 'Pod' | 'Container';
  primaryId: string;
  secondaryId: string;
  status: string;
  extra: string;
  restartsOrState: string;
}

export interface MinikubeRow {
  type: TabType.Minikube;
  name: string;
  host: string;
  kubelet: string;
  apiServer: string;
  message: string;
}

export type ResourceRow = PodRow | ContainerRow | NodeRow | RunnerRow | MinikubeRow;

export interface DetailData {
  tabType: TabType;
  fields: Array<{ label: string; value: string }>;
  title?: string;
}

export interface DataError {
  source: string;
  message: string;
}
