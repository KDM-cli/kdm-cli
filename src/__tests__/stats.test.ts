import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseK8sCpuQuantity,
  parseK8sMemoryQuantity,
  formatK8sBytes,
  getK8sClusterStats,
  getRunningPods
} from '../kubernetes/pods';
import {
  getDockerSystemStats,
  formatDockerBytes,
  getRunningContainers
} from '../docker/containers';

const mockContainersList = vi.fn();
const mockContainerStats = vi.fn();
const mockDockerInfo = vi.fn();

vi.mock('../docker/client', () => {
  return {
    getDockerClient: () => ({
      listContainers: mockContainersList,
      getContainer: (id: string) => ({
        stats: mockContainerStats,
      }),
      info: mockDockerInfo,
    }),
  };
});

const mockListClusterCustomObject = vi.fn();
const mockListPodForAllNamespaces = vi.fn();

vi.mock('../kubernetes/client', () => {
  return {
    getK8sApi: () => ({
      listPodForAllNamespaces: mockListPodForAllNamespaces,
    }),
    getCustomObjectsApi: () => ({
      listClusterCustomObject: mockListClusterCustomObject,
    }),
  };
});

const mockTriggerAlert = vi.fn();
vi.mock('../monitor/alerts', () => ({
  triggerAlert: (...args: any[]) => mockTriggerAlert(...args),
}));

describe('Kubernetes resource quantity parsing', () => {
  describe('parseK8sCpuQuantity', () => {
    it('parses millicores', () => {
      expect(parseK8sCpuQuantity('450m')).toBe(450);
      expect(parseK8sCpuQuantity('100m')).toBe(100);
    });

    it('parses cores', () => {
      expect(parseK8sCpuQuantity('2')).toBe(2000);
      expect(parseK8sCpuQuantity('0.5')).toBe(500);
    });

    it('parses nanocores', () => {
      expect(parseK8sCpuQuantity('125000000n')).toBe(125);
    });

    it('parses microcores', () => {
      expect(parseK8sCpuQuantity('125000u')).toBe(125);
    });

    it('handles numeric input', () => {
      expect(parseK8sCpuQuantity(0.5)).toBe(500);
    });

    it('handles empty or malformed inputs', () => {
      expect(parseK8sCpuQuantity('')).toBe(0);
      expect(parseK8sCpuQuantity('abc')).toBe(0);
    });

    it('hits the default case for other suffixes', () => {
      expect(parseK8sCpuQuantity('2x')).toBe(0);
    });
  });

  describe('parseK8sMemoryQuantity', () => {
    it('parses binary power values', () => {
      expect(parseK8sMemoryQuantity('2Ki')).toBe(2 * 1024);
      expect(parseK8sMemoryQuantity('5Mi')).toBe(5 * 1024 * 1024);
      expect(parseK8sMemoryQuantity('1Gi')).toBe(1024 * 1024 * 1024);
    });

    it('parses decimal power values', () => {
      expect(parseK8sMemoryQuantity('2k')).toBe(2000);
      expect(parseK8sMemoryQuantity('5M')).toBe(5000000);
      expect(parseK8sMemoryQuantity('1G')).toBe(1000000000);
    });

    it('handles numeric input', () => {
      expect(parseK8sMemoryQuantity(1024)).toBe(1024);
    });

    it('handles empty or malformed inputs', () => {
      expect(parseK8sMemoryQuantity('')).toBe(0);
      expect(parseK8sMemoryQuantity('abc')).toBe(0);
      expect(parseK8sMemoryQuantity('512')).toBe(512);
      expect(parseK8sMemoryQuantity('2x')).toBe(0);
    });
  });
});

describe('Byte formatting', () => {
  it('formats K8s bytes with binary suffixes', () => {
    expect(formatK8sBytes(0)).toBe('0B');
    expect(formatK8sBytes(512)).toBe('512B');
    expect(formatK8sBytes(1024)).toBe('1KiB');
    expect(formatK8sBytes(1.5 * 1024 * 1024)).toBe('1.5MiB');
    expect(formatK8sBytes(2 * 1024 * 1024 * 1024)).toBe('2GiB');
  });

  it('formats Docker bytes with decimal suffixes', () => {
    expect(formatDockerBytes(0)).toBe('0B');
    expect(formatDockerBytes(500)).toBe('500B');
    expect(formatDockerBytes(1000)).toBe('1KB');
    expect(formatDockerBytes(1.5 * 1000 * 1000)).toBe('1.5MB');
    expect(formatDockerBytes(2 * 1000 * 1000 * 1000)).toBe('2GB');
  });
});

describe('getDockerSystemStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDockerInfo.mockResolvedValue({ MemTotal: 8000000000 });
  });

  it('calculates aggregate stats for running containers', async () => {
    mockContainersList.mockResolvedValueOnce([
      { Id: 'cont1', Names: ['/c1'] },
      { Id: 'cont2', Names: ['/c2'] },
    ]);

    mockContainerStats
      // First container stats
      .mockResolvedValueOnce({
        cpu_stats: {
          cpu_usage: { total_usage: 100 },
          system_cpu_usage: 1000,
          online_cpus: 2,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 50 },
          system_cpu_usage: 500,
        },
        memory_stats: {
          usage: 1000000,
          stats: { cache: 100000 },
          limit: 8000000,
        },
      })
      // Second container stats
      .mockResolvedValueOnce({
        cpu_stats: {
          cpu_usage: { total_usage: 200 },
          system_cpu_usage: 1000,
          online_cpus: 1,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 150 },
          system_cpu_usage: 500,
        },
        memory_stats: {
          usage: 2000000,
          stats: { inactive_file: 200000 },
          limit: 8000000,
        },
      });

    const stats = await getDockerSystemStats();
    expect(stats).not.toBeNull();
    // Cont 1 CPU: ((100-50) / (1000-500)) * 2 * 100 = 20%
    // Cont 2 CPU: ((200-150) / (1000-500)) * 1 * 100 = 10%
    // Total CPU: 30%
    expect(stats?.cpu).toBeCloseTo(30);
    // Cont 1 Memory: 1000000 - 100000 = 900000
    // Cont 2 Memory: 2000000 - 200000 = 1800000
    // Total Memory: 2700000
    expect(stats?.memoryUsage).toBe(2700000);
    expect(stats?.memoryLimit).toBe(8000000000);
  });

  it.each([
    {
      description: 'falls back to docker.info() memory limit if limit from stats is 0',
      containers: [{ Id: 'cont1', Names: ['/c1'] }],
      statsMock: { resolve: { cpu_stats: {}, precpu_stats: {}, memory_stats: { usage: 1000, limit: 0 } } },
      infoMock: { resolve: { MemTotal: 16000000000 } },
      expectedCpu: 0,
      expectedMemoryUsage: 1000,
      expectedLimit: 16000000000,
    },
    {
      description: 'handles docker.info() failure gracefully',
      containers: [{ Id: 'cont1', Names: ['/c1'] }],
      statsMock: { resolve: { cpu_stats: {}, precpu_stats: {}, memory_stats: { usage: 1000, limit: 0 } } },
      infoMock: { reject: new Error('Info failed') },
      expectedCpu: 0,
      expectedMemoryUsage: 1000,
      expectedLimit: 0,
    },
    {
      description: 'handles container.stats failure gracefully for individual containers',
      containers: [{ Id: 'cont1', Names: ['/c1'] }],
      statsMock: { reject: new Error('Stats failed') },
      infoMock: { resolve: { MemTotal: 8000000000 } },
      expectedCpu: 0,
      expectedMemoryUsage: 0,
      expectedLimit: 8000000000,
    },
    {
      description: 'returns zero stats and gets memory limit from docker.info when no containers are running',
      containers: [],
      statsMock: null,
      infoMock: { resolve: { MemTotal: 12000000000 } },
      expectedCpu: 0,
      expectedMemoryUsage: 0,
      expectedLimit: 12000000000,
    },
    {
      description: 'handles docker.info failure when no containers are running',
      containers: [],
      statsMock: null,
      infoMock: { reject: new Error('info fail') },
      expectedCpu: 0,
      expectedMemoryUsage: 0,
      expectedLimit: 0,
    },
  ])('$description', async ({ containers, statsMock, infoMock, expectedCpu, expectedMemoryUsage, expectedLimit }) => {
    mockContainersList.mockResolvedValueOnce(containers);
    
    if (statsMock) {
      if ('resolve' in statsMock) {
        mockContainerStats.mockResolvedValueOnce(statsMock.resolve);
      } else {
        mockContainerStats.mockRejectedValueOnce(statsMock.reject);
      }
    }
    
    if ('resolve' in infoMock) {
      mockDockerInfo.mockResolvedValueOnce(infoMock.resolve);
    } else {
      mockDockerInfo.mockRejectedValueOnce(infoMock.reject);
    }

    const stats = await getDockerSystemStats();
    expect(stats?.cpu).toBe(expectedCpu);
    expect(stats?.memoryUsage).toBe(expectedMemoryUsage);
    expect(stats?.memoryLimit).toBe(expectedLimit);
  });

  it('returns 0 CPU percent when cpuDelta or systemCpuDelta is zero or negative', async () => {
    mockContainersList.mockResolvedValueOnce([
      { Id: 'cont1', Names: ['/c1'] },
    ]);
    mockContainerStats.mockResolvedValueOnce({
      cpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
        online_cpus: 2,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
      },
      memory_stats: {
        usage: 1000000,
        limit: 8000000,
      },
    });

    const stats = await getDockerSystemStats();
    expect(stats?.cpu).toBe(0);
  });

  it('gracefully degrades to null when listing containers fails', async () => {
    mockContainersList.mockRejectedValueOnce(new Error('Docker socket not available'));
    const stats = await getDockerSystemStats();
    expect(stats).toBeNull();
  });
});

describe('getK8sClusterStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches metrics-server node-level stats', async () => {
    mockListClusterCustomObject.mockResolvedValueOnce({
      items: [
        { usage: { cpu: '200m', memory: '1Gi' } },
        { usage: { cpu: '300m', memory: '2Gi' } },
      ],
    });

    const stats = await getK8sClusterStats();
    expect(stats.cpu).toBe('500m');
    expect(stats.memory).toBe('3GiB');
    expect(stats.source).toBe('metrics-server');
  });

  it('falls back to metrics-server pod-level stats when nodes query fails/empty', async () => {
    mockListClusterCustomObject
      .mockRejectedValueOnce(new Error('Node metrics 404')) // node metrics fails
      .mockResolvedValueOnce({
        items: [
          {
            containers: [
              { usage: { cpu: '100m', memory: '256Mi' } },
            ],
          },
          {
            containers: [
              { usage: { cpu: '150m', memory: '512Mi' } },
            ],
          },
        ],
      });

    const stats = await getK8sClusterStats();
    expect(stats.cpu).toBe('250m');
    expect(stats.memory).toBe('768MiB');
    expect(stats.source).toBe('metrics-server');
  });

  it('falls back to native pod resource requests sum when metrics-server is missing', async () => {
    mockListClusterCustomObject
      .mockRejectedValueOnce(new Error('No metrics endpoint')) // node metrics fails
      .mockRejectedValueOnce(new Error('No metrics endpoint')); // pod metrics fails

    mockListPodForAllNamespaces.mockResolvedValueOnce({
      items: [
        {
          status: { phase: 'Running' },
          spec: {
            containers: [
              { resources: { requests: { cpu: '200m', memory: '512Mi' } } },
            ],
          },
        },
        {
          status: { phase: 'Pending' },
          spec: {
            containers: [
              { resources: { requests: { cpu: '100m', memory: '256Mi' } } },
            ],
            initContainers: [
              { resources: { requests: { cpu: '500m', memory: '1Gi' } } },
            ],
          },
        },
        {
          status: { phase: 'Failed' }, // should be ignored
          spec: {
            containers: [
              { resources: { requests: { cpu: '1000m', memory: '4Gi' } } },
            ],
          },
        },
      ],
    });

    const stats = await getK8sClusterStats();
    expect(stats.cpu).toBe('300m');
    expect(stats.memory).toBe('768MiB');
    expect(stats.source).toBe('requests');
  });

  it('gracefully degrades to N/A when all methods fail', async () => {
    mockListClusterCustomObject
      .mockRejectedValue(new Error('Unreachable'));
    mockListPodForAllNamespaces
      .mockRejectedValue(new Error('Unreachable'));

    const stats = await getK8sClusterStats();
    expect(stats.cpu).toBe('N/A');
    expect(stats.memory).toBe('N/A');
    expect(stats.source).toBe('N/A');
  });

  it('handles empty results from metrics-server and empty pods/requests list', async () => {
    mockListClusterCustomObject
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] });

    mockListPodForAllNamespaces.mockResolvedValueOnce({
      items: [
        {
          status: { phase: 'Running' },
          spec: {
            containers: [
              { resources: {} },
              { resources: { requests: {} } },
            ],
          },
        },
        {
          status: { phase: 'Running' },
          spec: {
            // containers undefined
          },
        },
        {
          status: { phase: 'Running' },
          // spec undefined
        },
        {
          status: { phase: 'Running' },
          spec: {
            containers: [
              { resources: { requests: { cpu: '100m', memory: '256Mi' } } }
            ]
          }
        }
      ],
    });

    const stats = await getK8sClusterStats();
    expect(stats.cpu).toBe('100m');
    expect(stats.memory).toBe('256MiB');
    expect(stats.source).toBe('requests');
  });
});

describe('getRunningContainers actual implementation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly maps containers and triggers alerts for restart/failure states', async () => {
    mockContainersList.mockResolvedValueOnce([
      { Id: 'c123456789012', Names: ['/my-container'], Image: 'nginx', State: 'running', Status: 'Up' },
      { Id: 'c234567890123', Names: ['/my-restarting'], Image: 'nginx', State: 'restarting', Status: 'Restarting (1)' },
      { Id: 'c345678901234', Names: ['/my-failed'], Image: 'nginx', State: 'exited', Status: 'Exited (137)' },
      { Id: 'c456789012345', Names: ['/my-clean-exit'], Image: 'nginx', State: 'exited', Status: 'Exited (0)' },
    ]);

    const containers = await getRunningContainers();
    expect(containers).toHaveLength(4);
    expect(containers[0].id).toBe('c12345678901');
    expect(containers[0].name).toBe('my-container');

    expect(mockTriggerAlert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'container:my-restarting:restarting',
      severity: 'warning'
    }), expect.any(Object));

    expect(mockTriggerAlert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'container:my-failed:failure',
      severity: 'critical'
    }), expect.any(Object));
  });

  it('propagates errors when listContainers rejects', async () => {
    mockContainersList.mockRejectedValueOnce(new Error('List failed'));
    await expect(getRunningContainers()).rejects.toThrow('List failed');
  });
});

describe('getRunningPods actual implementation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly maps pods and triggers alerts for failures/waiting conditions', async () => {
    mockListPodForAllNamespaces.mockResolvedValueOnce({
      items: [
        {
          metadata: { name: 'pod-running', namespace: 'default' },
          status: {
            phase: 'Running',
            containerStatuses: [
              { restartCount: 2, state: { running: {} } },
            ],
          },
          spec: { nodeName: 'node-1' },
        },
        {
          metadata: { name: 'pod-failed-phase', namespace: 'default' },
          status: {
            phase: 'Failed',
            containerStatuses: [],
          },
        },
        {
          metadata: { name: 'pod-crashloop', namespace: 'default' },
          status: {
            phase: 'Pending',
            containerStatuses: [
              { name: 'c1', restartCount: 5, state: { waiting: { reason: 'CrashLoopBackOff' } } },
            ],
          },
        },
      ],
    });

    const pods = await getRunningPods();
    expect(pods).toHaveLength(3);
    expect(pods[0].name).toBe('pod-running');
    expect(pods[0].restarts).toBe(2);

    expect(mockTriggerAlert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pod:pod-failed-phase:failure',
      message: expect.stringContaining('FAILED')
    }), expect.any(Object));

    expect(mockTriggerAlert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pod:pod-crashloop:failure',
      message: expect.stringContaining('CrashLoopBackOff')
    }), expect.any(Object));
  });

  it('propagates errors when listPodForAllNamespaces rejects', async () => {
    mockListPodForAllNamespaces.mockRejectedValueOnce(new Error('K8s down'));
    await expect(getRunningPods()).rejects.toThrow('K8s down');
  });
});
