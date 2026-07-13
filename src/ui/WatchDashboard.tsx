import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { getRunningPods, PodData, getK8sClusterStats, K8sClusterStats } from '../kubernetes/pods';
import { getRunningContainers, ContainerData, getDockerSystemStats, DockerSystemStats, formatDockerBytes } from '../docker/containers';
import { getK8sApi } from '../kubernetes/client';
import { getDockerClient } from '../docker/client';
import { createAIClient } from '../ai/factory';
import { getAIConfig } from '../config/store';
import chalk from 'chalk';

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

  // Pane Navigation
  const [activePane, setActivePane] = useState<'k8s' | 'docker'>('k8s');
  const [k8sSelectedIndex, setK8sSelectedIndex] = useState(0);
  const [dockerSelectedIndex, setDockerSelectedIndex] = useState(0);

  // Actions states
  const [showLogs, setShowLogs] = useState(false);
  const [logsText, setLogsText] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);
  
  const [aiDiagnosis, setAiDiagnosis] = useState<string | null>(null);
  const [runningAi, setRunningAi] = useState(false);
  
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const handleResize = () => {
    setColumns(process.stdout.columns || 80);
  };

  useEffect(() => {
    if (process.stdout && typeof process.stdout.on === 'function') {
      process.stdout.on('resize', handleResize);
    }
    return () => {
      if (process.stdout && typeof process.stdout.off === 'function') {
        process.stdout.off('resize', handleResize);
      }
    };
  }, []);

  const fetchData = async () => {
    const [podsResult, containersResult, k8sStatsResult, dockerStatsResult] = await Promise.allSettled([
      getRunningPods(),
      getRunningContainers(),
      getK8sClusterStats(),
      getDockerSystemStats()
    ]);

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
  };

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => {
      void fetchData();
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  // Selected resource calculation
  const getSelectedResource = () => {
    if (activePane === 'k8s') {
      return pods[k8sSelectedIndex] || null;
    } else {
      return containers[dockerSelectedIndex] || null;
    }
  };

  const selectedResource = getSelectedResource();

  // Helper: Fetch Logs for selected resource
  const fetchSelectedLogs = async (res: PodData | ContainerData) => {
    setLoadingLogs(true);
    setLogsText('');
    try {
      if ('namespace' in res) {
        // Kubernetes Pod
        const api = getK8sApi();
        const response = await api.readNamespacedPodLog({
          name: res.name,
          namespace: res.namespace,
          tailLines: 50,
        });
        setLogsText(response || 'No logs available.');
      } else {
        // Docker Container
        const docker = getDockerClient();
        const output = await docker.getContainer(res.id).logs({
          stdout: true,
          stderr: true,
          tail: 50,
        });
        setLogsText(String(output) || 'No logs available.');
      }
    } catch (err) {
      setLogsText(`Failed to fetch logs: ${(err as Error).message}`);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Helper: Run AI analysis
  const runAiAnalysis = async (res: PodData | ContainerData) => {
    setRunningAi(true);
    setAiDiagnosis(null);
    try {
      let failureDetails = '';
      if ('namespace' in res) {
        failureDetails = `Namespace: ${res.namespace}, Status: ${res.status}, Restarts: ${res.restarts}`;
      } else {
        failureDetails = `State: ${res.state}, Status: ${res.status}`;
      }

      const prompt = [
        `Simplify the following monitor failure message and provide a solution.`,
        `Provide the most likely root cause and a recommended fix.`,
        `Be concise.`,
        ``,
        `Resource Name: ${res.name}`,
        `Resource Info: ${failureDetails}`,
      ].join('\n');

      let provider = 'openai';
      try {
        const aiConfig = getAIConfig();
        if (aiConfig?.defaultProvider) provider = aiConfig.defaultProvider;
      } catch {}

      const client = await createAIClient(provider);
      const completion = await client.getCompletion(prompt);
      setAiDiagnosis(completion || 'No response from AI.');
    } catch (err) {
      setAiDiagnosis(`AI Analysis failed: ${(err as Error).message}`);
    } finally {
      setRunningAi(false);
    }
  };

  // Helper: Restart selected resource
  const restartResource = async (res: PodData | ContainerData) => {
    setActionMessage(`Restarting ${res.name}...`);
    try {
      if ('namespace' in res) {
        const api = getK8sApi();
        await api.deleteNamespacedPod({
          name: res.name,
          namespace: res.namespace,
        });
        setActionMessage(`Pod ${res.name} deleted (restarting via Deployment).`);
      } else {
        const docker = getDockerClient();
        await docker.getContainer(res.id).restart();
        setActionMessage(`Container ${res.name} restarted successfully.`);
      }
      setTimeout(() => setActionMessage(null), 3000);
      void fetchData();
    } catch (err) {
      setActionMessage(`Restart failed: ${(err as Error).message}`);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  // Keep index within bounds
  useEffect(() => {
    if (k8sSelectedIndex >= pods.length && pods.length > 0) {
      setK8sSelectedIndex(pods.length - 1);
    }
  }, [pods.length]);

  useEffect(() => {
    if (dockerSelectedIndex >= containers.length && containers.length > 0) {
      setDockerSelectedIndex(containers.length - 1);
    }
  }, [containers.length]);

  // Handle key inputs
  useInput((input, key) => {
    const lowerInput = input.toLowerCase();

    // Close overlays if active
    if (showLogs) {
      if (key.escape || lowerInput === 'q') {
        setShowLogs(false);
      }
      return;
    }

    if (aiDiagnosis) {
      if (key.escape || lowerInput === 'q') {
        setAiDiagnosis(null);
      }
      return;
    }

    if (lowerInput === 'q' || (key.ctrl && input === 'c')) {
      process.exit(0);
    }

    // Switch focus
    if (key.tab || key.rightArrow) {
      setActivePane('docker');
      return;
    }
    if (key.leftArrow) {
      setActivePane('k8s');
      return;
    }

    // Navigate lists
    if (key.upArrow) {
      if (activePane === 'k8s') {
        setK8sSelectedIndex(prev => Math.max(0, prev - 1));
      } else {
        setDockerSelectedIndex(prev => Math.max(0, prev - 1));
      }
      return;
    }
    if (key.downArrow) {
      if (activePane === 'k8s') {
        setK8sSelectedIndex(prev => Math.min(pods.length - 1, prev + 1));
      } else {
        setDockerSelectedIndex(prev => Math.min(containers.length - 1, prev + 1));
      }
      return;
    }

    // Actions
    if (selectedResource) {
      if (lowerInput === 'l') {
        setShowLogs(true);
        void fetchSelectedLogs(selectedResource);
        return;
      }
      if (lowerInput === 'a') {
        void runAiAnalysis(selectedResource);
        return;
      }
      if (lowerInput === 'r') {
        void restartResource(selectedResource);
        return;
      }
    }
  });

  const isCompact = columns < 80;
  const layoutDirection = isCompact ? 'column' : 'row';
  const columnWidth = isCompact ? '100%' : '50%';
  const availableWidth = isCompact ? (columns - 8) : (Math.floor(columns / 2) - 8);
  const maxNameLength = Math.max(10, availableWidth - 14);

  // Render Log Streaming Overlay
  if (showLogs) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
        <Box justifyContent="space-between" marginBottom={1}>
          <Text bold color="cyan"> Logs: {selectedResource?.name} [STREAMING] </Text>
          <Text dimColor>Press ESC or Q to go back</Text>
        </Box>
        <Box borderStyle="single" borderColor="gray" minHeight={15} padding={1} flexDirection="column">
          {loadingLogs ? (
            <Text color="yellow">Loading logs...</Text>
          ) : (
            <Text>{logsText}</Text>
          )}
        </Box>
      </Box>
    );
  }

  // Render AI Diagnosis Overlay
  if (aiDiagnosis) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="magenta">
        <Box justifyContent="space-between" marginBottom={1}>
          <Text bold color="magenta"> AI Diagnosis for {selectedResource?.name} </Text>
          <Text dimColor>Press ESC or Q to go back</Text>
        </Box>
        <Box borderStyle="single" borderColor="gray" minHeight={12} padding={1}>
          <Text color="white">{aiDiagnosis}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Box marginBottom={1} flexDirection={columns < 50 ? 'column' : 'row'} justifyContent="space-between">
        <Box>
          <Text color="cyan" bold> 󱔎 KDM Split-Pane Monitoring Dashboard </Text>
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
      
      {/* Split Pane Row */}
      <Box flexDirection={layoutDirection} height={12}>
        {/* Kubernetes Pane */}
        <Box
          flexDirection="column"
          width={columnWidth}
          paddingRight={isCompact ? 0 : 2}
          marginBottom={isCompact ? 1 : 0}
          borderStyle="round"
          borderColor={activePane === 'k8s' ? 'cyan' : 'blue'}
        >
          <Box paddingX={1} marginBottom={1}>
            <Text color="blue" bold>Kubernetes Pods ({pods.length})</Text>
          </Box>
          <Box marginBottom={1} paddingX={1}>
            <Text dimColor>
              {k8sStats 
                ? `${k8sStats.source === 'requests' ? 'k8s Requests' : 'k8s Stats'}: CPU: ${k8sStats.cpu} | Mem: ${k8sStats.memory}`
                : 'k8s Stats: CPU: N/A | Mem: N/A'}
            </Text>
          </Box>
          {pods.length === 0 && !error?.type?.includes('k8s') ? (
            <Text color="gray">  No pods found.</Text>
          ) : (
            pods.map((p, idx) => {
              const isSelected = activePane === 'k8s' && idx === k8sSelectedIndex;
              return (
                <Box key={`${p.namespace}/${p.name}`} flexDirection="row" justifyContent="space-between" marginBottom={0}>
                  <Text color={isSelected ? 'yellow' : 'white'}>
                    {isSelected ? '> ' : '  '}
                    {truncateName(p.name, maxNameLength)}
                  </Text>
                  <StatusBadge status={p.status} type="pod" />
                </Box>
              );
            })
          )}
        </Box>

        {/* Docker Pane */}
        <Box
          flexDirection="column"
          width={columnWidth}
          borderStyle="round"
          borderColor={activePane === 'docker' ? 'cyan' : 'blue'}
        >
          <Box paddingX={1} marginBottom={1}>
            <Text color="blue" bold>Docker Containers ({containers.length})</Text>
          </Box>
          <Box marginBottom={1} paddingX={1}>
            <Text dimColor>
              {dockerStats 
                ? `Docker Stats: CPU: ${dockerStats.cpu.toFixed(1)}% | Mem: ${formatDockerBytes(dockerStats.memoryUsage)} / ${formatDockerBytes(dockerStats.memoryLimit)}`
                : 'Docker Stats: CPU: N/A | Mem: N/A'}
            </Text>
          </Box>
          {containers.length === 0 && !error?.type?.includes('docker') ? (
            <Text color="gray">  No containers found.</Text>
          ) : (
            containers.map((c, idx) => {
              const isSelected = activePane === 'docker' && idx === dockerSelectedIndex;
              return (
                <Box key={c.id} flexDirection="row" justifyContent="space-between" marginBottom={0}>
                  <Text color={isSelected ? 'yellow' : 'white'}>
                    {isSelected ? '> ' : '  '}
                    {truncateName(c.name, maxNameLength)}
                  </Text>
                  <StatusBadge status={c.state} type="container" />
                </Box>
              );
            })
          )}
        </Box>
      </Box>

      {/* Details Panel */}
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text bold>Detail Panel (selected resource)</Text>
        <Box height={1} />
        {selectedResource ? (
          <Box flexDirection="column">
            <Box flexDirection="row">
              <Text bold>  Name:   </Text>
              <Text>{selectedResource.name}</Text>
            </Box>
            <Box flexDirection="row">
              <Text bold>  Status: </Text>
              <Text>{'namespace' in selectedResource ? selectedResource.status : selectedResource.state}</Text>
            </Box>
            {'namespace' in selectedResource ? (
              <>
                <Box flexDirection="row">
                  <Text bold>  Namespace: </Text>
                  <Text>{selectedResource.namespace}</Text>
                </Box>
                <Box flexDirection="row">
                  <Text bold>  Restarts:  </Text>
                  <Text>{selectedResource.restarts}</Text>
                </Box>
              </>
            ) : (
              <>
                <Box flexDirection="row">
                  <Text bold>  Image:  </Text>
                  <Text>{selectedResource.image}</Text>
                </Box>
                <Box flexDirection="row">
                  <Text bold>  Details: </Text>
                  <Text>{selectedResource.status}</Text>
                </Box>
              </>
            )}
          </Box>
        ) : (
          <Text color="gray">  No resource selected.</Text>
        )}
        {runningAi && (
          <Box marginTop={1}>
            <Text color="yellow">Running AI Analysis...</Text>
          </Box>
        )}
        {actionMessage && (
          <Box marginTop={1}>
            <Text color="cyan">{actionMessage}</Text>
          </Box>
        )}
      </Box>

      {/* Footer / Shortcuts */}
      <Box marginTop={1}>
        <Text bold>[L] Logs  [A] AI Analysis  [R] Restart  [TAB] Switch Focus  [Q] Quit</Text>
      </Box>
    </Box>
  );
};
