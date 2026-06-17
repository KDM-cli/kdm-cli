import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { getRunningPods, PodData, getK8sClusterStats, K8sClusterStats } from '../kubernetes/pods';
import { getRunningContainers, ContainerData, getDockerSystemStats, DockerSystemStats, formatDockerBytes } from '../docker/containers';

const StatusBadge = ({ status, type }: { status: string, type: 'pod' | 'container' }) => {
  const isRunning = type === 'pod' ? status === 'Running' : status === 'running';
  const bgColor = isRunning ? 'green' : (status === 'Pending' || status === 'restarting' ? 'yellow' : 'red');
  const textColor = isRunning || bgColor === 'yellow' ? 'black' : 'white';

  return (
    <Box paddingX={1}>
      <Text color={textColor} bold backgroundColor={bgColor}>
        {status.toUpperCase()}
      </Text>
    </Box>
  );
};

export const truncateName = (name: string, maxLength: number): string => {
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + '...';
};

export const WatchDashboard = () => {
  const [pods, setPods] = useState<PodData[]>([]);
  const [containers, setContainers] = useState<ContainerData[]>([]);
  const [k8sStats, setK8sStats] = useState<K8sClusterStats | null>(null);
  const [dockerStats, setDockerStats] = useState<DockerSystemStats | null>(null);
  const [error, setError] = useState<{ type: string; message: string } | null>(null);
  const [columns, setColumns] = useState(process.stdout.columns || 80);

  useEffect(() => {
    const handleResize = () => {
      setColumns(process.stdout.columns || 80);
    };
    if (process.stdout && typeof process.stdout.on === 'function') {
      process.stdout.on('resize', handleResize);
    }
    return () => {
      if (process.stdout && typeof process.stdout.off === 'function') {
        process.stdout.off('resize', handleResize);
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let isFetching = false;

    const fetchData = async () => {
      if (isFetching) return;
      isFetching = true;

      const [podsResult, containersResult, k8sStatsResult, dockerStatsResult] = await Promise.allSettled([
        getRunningPods(),
        getRunningContainers(),
        getK8sClusterStats(),
        getDockerSystemStats()
      ]);

      if (!isMounted) {
        isFetching = false;
        return;
      }

      if (podsResult.status === 'fulfilled') {
        setPods(podsResult.value);
        setError(prev => prev?.type === 'k8s' ? null : prev);
      } else {
        setError({ type: 'k8s', message: (podsResult.reason as Error).message });
      }

      if (containersResult.status === 'fulfilled') {
        setContainers(containersResult.value);
        setError(prev => prev?.type === 'docker' ? null : prev);
      } else {
        setError({ type: 'docker', message: (containersResult.reason as Error).message });
      }

      if (k8sStatsResult.status === 'fulfilled') {
        setK8sStats(k8sStatsResult.value);
      } else {
        setK8sStats(null);
      }

      if (dockerStatsResult.status === 'fulfilled') {
        setDockerStats(dockerStatsResult.value);
      } else {
        setDockerStats(null);
      }

      isFetching = false;
    };

    void fetchData();
    const interval = setInterval(() => {
      void fetchData();
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const isCompact = columns < 80;
  const layoutDirection = isCompact ? 'column' : 'row';
  const columnWidth = isCompact ? '100%' : '50%';
  const availableWidth = isCompact ? (columns - 8) : (Math.floor(columns / 2) - 8);
  const maxNameLength = Math.max(10, availableWidth - 14);

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Box marginBottom={1} flexDirection={columns < 50 ? 'column' : 'row'} justifyContent="space-between">
        <Box>
          <Text color="cyan" bold> 󱔎 KDM Live Dashboard </Text>
        </Box>
        <Box>
          <Text dimColor>(Press Ctrl+C to exit)</Text>
        </Box>
      </Box>

      {error && (
        <Box marginBottom={1} paddingX={1}>
          <Text color="white" bold backgroundColor="red"> ERROR: {error.type.toUpperCase()} - {error.message} </Text>
        </Box>
      )}
      
      <Box flexDirection={layoutDirection}>
        <Box flexDirection="column" width={columnWidth} paddingRight={isCompact ? 0 : 2} marginBottom={isCompact ? 1 : 0}>
          <Box borderStyle="single" borderColor="blue" paddingX={1} marginBottom={1}>
            <Text color="blue" bold>Kubernetes Pods ({pods.length})</Text>
          </Box>
          <Box marginBottom={1} paddingX={1}>
            <Text dimColor>
              {k8sStats 
                ? `${k8sStats.source === 'requests' ? 'k8s Requests' : 'k8s Stats'}: CPU: ${k8sStats.cpu} | Mem: ${k8sStats.memory}`
                : 'k8s Stats: CPU: N/A | Mem: N/A'}
            </Text>
          </Box>
          {pods.length === 0 && !error?.type.includes('k8s') ? (
            <Text color="gray">  No pods found.</Text>
          ) : (
            pods.map(p => (
              <Box key={p.name} flexDirection="row" justifyContent="space-between" marginBottom={0}>
                <Text> {truncateName(p.name, maxNameLength)}</Text>
                <StatusBadge status={p.status} type="pod" />
              </Box>
            ))
          )}
        </Box>

        <Box flexDirection="column" width={columnWidth}>
          <Box borderStyle="single" borderColor="blue" paddingX={1} marginBottom={1}>
            <Text color="blue" bold>Docker Containers ({containers.length})</Text>
          </Box>
          <Box marginBottom={1} paddingX={1}>
            <Text dimColor>
              {dockerStats 
                ? `Docker Stats: CPU: ${dockerStats.cpu.toFixed(1)}% | Mem: ${formatDockerBytes(dockerStats.memoryUsage)} / ${formatDockerBytes(dockerStats.memoryLimit)}`
                : 'Docker Stats: CPU: N/A | Mem: N/A'}
            </Text>
          </Box>
          {containers.length === 0 && !error?.type.includes('docker') ? (
            <Text color="gray">  No containers found.</Text>
          ) : (
            containers.map(c => (
              <Box key={c.id} flexDirection="row" justifyContent="space-between" marginBottom={0}>
                <Text> {truncateName(c.name, maxNameLength)}</Text>
                <StatusBadge status={c.state} type="container" />
              </Box>
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
};
