import { getDockerClient } from './client';
import { triggerAlert } from '../monitor/alerts';
import { logger } from '../utils/logger';

export interface ContainerData {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export const getRunningContainers = async (options?: { forceAlert?: boolean }): Promise<ContainerData[]> => {
  const docker = getDockerClient();
  try {
    // Try to list containers, use a timeout if possible or just catch common connection errors
    const containers = await docker.listContainers({ all: true });
    
    return containers.map((c) => {
      const name = c.Names[0]?.replace('/', '') || 'Unknown';
      const id = c.Id.substring(0, 12);

      // Check for failures (non-blocking alerts)
      if (c.State === 'restarting') {
        triggerAlert({
          id: `container:${name}:restarting`,
          type: 'container',
          severity: 'warning',
          message: `Docker container ${name} (${id}) is restarting.`,
        }, { force: options?.forceAlert });
      } else if (c.State === 'exited') {
        const match = c.Status.match(/Exited \((\d+)\)/);
        const exitCode = match ? parseInt(match[1], 10) : 0;
        
        if (exitCode !== 0) {
          triggerAlert({
            id: `container:${name}:failure`,
            type: 'container',
            severity: 'critical',
            message: `Docker container ${name} (${id}) exited with code ${exitCode}.`,
          }, { force: options?.forceAlert });
        }
      }

      return {
        id,
        name,
        image: c.Image,
        state: c.State,
        status: c.Status,
      };
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to fetch Docker containers: ${errorMessage}`);
    // Throw error so UI can handle it instead of showing empty list
    throw error;
  }
};

export interface DockerSystemStats {
  /** The aggregated CPU usage percentage. */
  cpu: number;
  /** The aggregated memory usage in bytes. */
  memoryUsage: number;
  /** The maximum memory limit across running containers or total host memory. */
  memoryLimit: number;
}

/**
 * Formats a byte number to decimal-scaled string (e.g. "1.4GB").
 * @param bytes The raw number of bytes.
 * @returns Decimal-formatted bytes string.
 */
export const formatDockerBytes = (bytes: number): string => {
  if (bytes <= 0) return '0B';
  const decimalK = 1000;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(decimalK)), sizes.length - 1);
  const num = bytes / Math.pow(decimalK, i);
  return `${parseFloat(num.toFixed(1))}${sizes[i]}`;
};

/**
 * Calculates a single container's CPU usage percentage based on its stats and pre-stats.
 * @param cpuStats The current CPU stats of the container.
 * @param precpuStats The previous CPU stats of the container.
 * @returns The calculated CPU usage percentage.
 */
const calculateCpuPercent = (cpuStats: any, precpuStats: any): number => {
  if (!cpuStats || !precpuStats || !cpuStats.cpu_usage || !precpuStats.cpu_usage) {
    return 0;
  }
  const cpuDelta = (cpuStats.cpu_usage.total_usage || 0) - (precpuStats.cpu_usage.total_usage || 0);
  const systemCpuDelta = (cpuStats.system_cpu_usage || 0) - (precpuStats.system_cpu_usage || 0);
  const onlineCpus = cpuStats.online_cpus || cpuStats.cpu_usage.percpu_usage?.length || 1;
  
  if (systemCpuDelta > 0 && cpuDelta > 0) {
    return (cpuDelta / systemCpuDelta) * onlineCpus * 100;
  }
  return 0;
};

/**
 * Calculates a single container's Memory usage in bytes subtracting cache memory.
 * @param memoryStats The memory stats of the container.
 * @returns Calculated memory usage in bytes.
 */
const calculateMemoryUsage = (memoryStats: any): number => {
  if (!memoryStats) return 0;
  let usage = memoryStats.usage || 0;
  const cache = memoryStats.stats?.cache || memoryStats.stats?.inactive_file || 0;
  if (usage > cache) {
    usage -= cache;
  }
  return usage;
};

type DebugLogger = {
  debug: (message: string) => void;
};

const hasDebugLogger = (value: unknown): value is DebugLogger => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'debug' in value &&
    typeof (value as { debug?: unknown }).debug === 'function'
  );
};

/**
 * Fetches stats for a single container.
 * @param docker The Dockerode client.
 * @param containerId The ID of the container.
 * @returns Stats containing CPU percentage, memory usage, and memory limit.
 */
const fetchContainerStats = async (docker: any, containerId: string) => {
  try {
    const container = docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });
    return {
      cpuPercent: calculateCpuPercent(stats.cpu_stats, stats.precpu_stats),
      memoryUsage: calculateMemoryUsage(stats.memory_stats),
      limit: stats.memory_stats?.limit || 0,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const msg = `Failed to fetch stats for container ${containerId}: ${errMsg}`;
    if (hasDebugLogger(logger)) {
      logger.debug(msg);
    } else {
      console.debug(msg);
    }
    return { cpuPercent: 0, memoryUsage: 0, limit: 0 };
  }
};

/**
 * Aggregates CPU and Memory resource usage stats for all running Docker containers.
 * @returns The aggregated Docker stats, or null if the client fails to connect.
 */
export const getDockerSystemStats = async (): Promise<DockerSystemStats | null> => {
  const docker = getDockerClient();
  try {
    const containers = await docker.listContainers({ filters: { status: ['running'] } });
    
    // Always call docker.info() to obtain MemTotal and use that as memoryLimit
    const info = await docker.info().catch(() => ({ MemTotal: 0 }));
    const memoryLimit = info.MemTotal || 0;

    if (containers.length === 0) {
      return { cpu: 0, memoryUsage: 0, memoryLimit };
    }

    const statsPromises = containers.map(c => fetchContainerStats(docker, c.Id));
    const results = await Promise.all(statsPromises);
    
    let totalCpu = 0;
    let totalMemory = 0;
    
    for (const res of results) {
      totalCpu += res.cpuPercent;
      totalMemory += res.memoryUsage;
    }

    return {
      cpu: totalCpu,
      memoryUsage: totalMemory,
      memoryLimit,
    };
  } catch (error) {
    return null;
  }
};


