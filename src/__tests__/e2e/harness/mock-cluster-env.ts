import { vi } from 'vitest';
import * as podsModule from '../../../kubernetes/pods';
import * as resourcesModule from '../../../kubernetes/resources';
import * as containersModule from '../../../docker/containers';
import * as k8sClientModule from '../../../kubernetes/client';
import * as dockerClientModule from '../../../docker/client';
import * as minikubeClientModule from '../../../minikube/client';

export interface MockPodState {
  name: string;
  namespace: string;
  status: string;
  restarts: number;
  node: string;
  phase?: string;
  exitCode?: number;
  reason?: string;
  memoryLimit?: string;
  memoryRequest?: string;
  rawPod?: any;
}

export interface MockContainerState {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  exitCode?: number;
  rawContainer?: any;
}

export interface MockNodeState {
  name: string;
  status: string;
  roles: string[];
  version: string;
  memoryPressure?: boolean;
  diskPressure?: boolean;
  cpuCapacity?: string;
  memoryCapacity?: string;
}

export class MockClusterEnvironment {
  private static activeInstance: MockClusterEnvironment | null = null;

  static getActive(): MockClusterEnvironment | null {
    return this.activeInstance;
  }

  static resetActive(): void {
    if (this.activeInstance) {
      this.activeInstance.reset();
      this.activeInstance = null;
    }
  }

  private pods: MockPodState[] = [];
  private containers: MockContainerState[] = [];
  private nodes: MockNodeState[] = [];
  private k8sConnected = true;
  private dockerConnected = true;
  private minikubeConnected = false;
  private hanging = false;

  private spies: Array<{ mockRestore: () => void }> = [];

  setOOMKilledScenario(podName = 'payment-service-8f4b-2x9p', namespace = 'production') {
    this.pods = [
      {
        name: podName,
        namespace,
        status: 'OOMKilled',
        restarts: 5,
        node: 'worker-node-4',
        phase: 'Running',
        exitCode: 137,
        reason: 'OOMKilled',
        memoryLimit: '512Mi',
        memoryRequest: '256Mi',
        rawPod: {
          metadata: { name: podName, namespace },
          status: {
            phase: 'Running',
            containerStatuses: [
              {
                name: 'payment-gateway',
                restartCount: 5,
                lastState: {
                  terminated: { exitCode: 137, reason: 'OOMKilled' },
                },
              },
            ],
          },
          spec: {
            containers: [
              {
                name: 'payment-gateway',
                resources: { limits: { memory: '512Mi' }, requests: { memory: '256Mi' } },
              },
            ],
          },
        },
      },
    ];
    this.nodes = [
      {
        name: 'worker-node-4',
        status: 'Ready',
        roles: ['worker'],
        version: 'v1.30.0',
        memoryPressure: false,
        memoryCapacity: '16Gi',
      },
    ];
    return this;
  }

  setCrashLoopBackOffScenario(podName = 'auth-api-v2-7c91', namespace = 'auth') {
    this.pods = [
      {
        name: podName,
        namespace,
        status: 'CrashLoopBackOff',
        restarts: 12,
        node: 'worker-node-1',
        phase: 'Running',
        exitCode: 1,
        reason: 'CrashLoopBackOff',
        rawPod: {
          metadata: { name: podName, namespace },
          status: {
            phase: 'Running',
            containerStatuses: [
              {
                name: 'auth-server',
                restartCount: 12,
                state: {
                  waiting: {
                    reason: 'CrashLoopBackOff',
                    message: 'Back-off restarting failed container',
                  },
                },
              },
            ],
          },
          spec: {
            containers: [
              {
                name: 'auth-server',
                env: [
                  {
                    name: 'DATABASE_URL',
                    valueFrom: { secretKeyRef: { name: 'auth-secrets', key: 'db-url' } },
                  },
                ],
              },
            ],
          },
        },
      },
    ];
    return this;
  }

  setDockerRestartLoopScenario(containerName = 'postgres-local') {
    this.containers = [
      {
        id: 'c1e2d3f4a5b6',
        name: containerName,
        image: 'postgres:15-alpine',
        state: 'restarting',
        status: 'Restarting (1) 3 seconds ago',
        exitCode: 1,
        rawContainer: {
          Id: 'c1e2d3f4a5b6',
          Names: [`/${containerName}`],
          Image: 'postgres:15-alpine',
          State: 'restarting',
          Status: 'Restarting (1) 3 seconds ago',
        },
      },
    ];
    return this;
  }

  setHealthyScenario() {
    this.pods = [
      {
        name: 'frontend-service-6a4d-1z8k',
        namespace: 'default',
        status: 'Running',
        restarts: 0,
        node: 'worker-node-1',
        phase: 'Running',
      },
      {
        name: 'cache-redis-0',
        namespace: 'default',
        status: 'Running',
        restarts: 0,
        node: 'worker-node-2',
        phase: 'Running',
      },
    ];
    this.containers = [
      {
        id: 'a9b8c7d6e5f4',
        name: 'nginx-proxy',
        image: 'nginx:alpine',
        state: 'running',
        status: 'Up 4 hours',
      },
    ];
    this.nodes = [
      {
        name: 'worker-node-1',
        status: 'Ready',
        roles: ['worker'],
        version: 'v1.30.0',
      },
    ];
    return this;
  }

  setNodePressureScenario(nodeName = 'worker-node-3') {
    this.nodes = [
      {
        name: nodeName,
        status: 'MemoryPressure',
        roles: ['worker'],
        version: 'v1.30.0',
        memoryPressure: true,
      },
    ];
    return this;
  }

  setEmptyScenario() {
    this.pods = [];
    this.containers = [];
    this.nodes = [];
    return this;
  }

  setDisconnectedScenario(k8sDown = true, dockerDown = true) {
    this.k8sConnected = !k8sDown;
    this.dockerConnected = !dockerDown;
    return this;
  }

  setHangingScenario(isHanging = true) {
    this.hanging = isHanging;
    return this;
  }

  /**
   * Installs vi.spyOn hooks on all cluster getters and client singletons.
   */
  install(): this {
    this.reset();
    MockClusterEnvironment.activeInstance = this;

    // Mock getRunningPods
    const podsSpy = vi.spyOn(podsModule, 'getRunningPods').mockImplementation(async () => {
      if (!this.k8sConnected) {
        throw new Error('Kubernetes API connection refused: ETIMEDOUT');
      }
      return this.pods.map((p) => ({
        name: p.name,
        namespace: p.namespace,
        status: p.status,
        restarts: p.restarts,
        node: p.node,
      }));
    });
    this.spies.push(podsSpy);

    // Mock getRunningContainers
    const containersSpy = vi
      .spyOn(containersModule, 'getRunningContainers')
      .mockImplementation(async () => {
        if (!this.dockerConnected) {
          throw new Error('Cannot connect to the Docker daemon. Is Docker running?');
        }
        return this.containers.map((c) => ({
          id: c.id,
          name: c.name,
          image: c.image,
          state: c.state,
          status: c.status,
        }));
      });
    this.spies.push(containersSpy);

    // Mock listNodes
    const nodesSpy = vi.spyOn(resourcesModule, 'listNodes').mockImplementation(async () => {
      if (!this.k8sConnected) {
        throw new Error('Kubernetes API connection refused');
      }
      return this.nodes.map((n) => ({
        name: n.name,
        status: n.status,
        roles: n.roles.join(','),
        version: n.version,
      })) as any;
    });
    this.spies.push(nodesSpy);

    // Mock checkK8sConnection
    const k8sConnSpy = vi.spyOn(k8sClientModule, 'checkK8sConnection').mockImplementation(async () => {
      return this.k8sConnected;
    });
    this.spies.push(k8sConnSpy);

    // Mock checkDockerConnection
    const dockerConnSpy = vi
      .spyOn(dockerClientModule, 'checkDockerConnection')
      .mockImplementation(async () => {
        return this.dockerConnected;
      });
    this.spies.push(dockerConnSpy);

    // Mock checkMinikubeConnection
    const minikubeConnSpy = vi
      .spyOn(minikubeClientModule, 'checkMinikubeConnection')
      .mockImplementation(async () => {
        return this.minikubeConnected;
      });
    this.spies.push(minikubeConnSpy);

    return this;
  }

  /**
   * Restores all installed spies.
   */
  reset(): this {
    if (MockClusterEnvironment.activeInstance === this) {
      MockClusterEnvironment.activeInstance = null;
    }
    for (const spy of this.spies) {
      spy.mockRestore();
    }
    this.spies = [];
    return this;
  }

  getState() {
    return {
      pods: this.pods,
      containers: this.containers,
      nodes: this.nodes,
      k8sConnected: this.k8sConnected,
      dockerConnected: this.dockerConnected,
      hanging: this.hanging,
    };
  }
}
