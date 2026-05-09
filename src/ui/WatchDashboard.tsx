import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { getRunningPods, PodData } from '../kubernetes/pods';
import { getRunningContainers, ContainerData } from '../docker/containers';

export const WatchDashboard = () => {
  const [pods, setPods] = useState<PodData[]>([]);
  const [containers, setContainers] = useState<ContainerData[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const [p, c] = await Promise.all([getRunningPods(), getRunningContainers()]);
      setPods(p);
      setContainers(c);
    };

    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>KDM Live Dashboard</Text>
        <Text> (Press Ctrl+C to exit)</Text>
      </Box>
      <Box flexDirection="row">
        <Box flexDirection="column" width="50%" paddingRight={2}>
          <Text color="blue" bold underline>Kubernetes Pods ({pods.length})</Text>
          {pods.length === 0 ? (
            <Text color="gray">No pods found.</Text>
          ) : (
            pods.map(p => (
              <Box key={p.name} flexDirection="row" justifyContent="space-between">
                <Text>{p.name.substring(0, 30)}</Text>
                <Text color={p.status === 'Running' ? 'green' : 'yellow'}>{p.status}</Text>
              </Box>
            ))
          )}
        </Box>
        <Box flexDirection="column" width="50%">
          <Text color="blue" bold underline>Docker Containers ({containers.length})</Text>
          {containers.length === 0 ? (
            <Text color="gray">No containers found.</Text>
          ) : (
            containers.map(c => (
              <Box key={c.id} flexDirection="row" justifyContent="space-between">
                <Text>{c.name.substring(0, 30)}</Text>
                <Text color={c.state === 'running' ? 'green' : 'red'}>{c.state}</Text>
              </Box>
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
};
