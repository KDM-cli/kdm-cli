import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { getRunningPods, PodData } from '../kubernetes/pods';
import { getRunningContainers, ContainerData } from '../docker/containers';
import { getK8sApi } from '../kubernetes/client';
import { getDockerClient } from '../docker/client';
import chalk from 'chalk';

interface LogsDashboardProps {
  initialName?: string;
}

interface SelectorResource {
  id: string;
  name: string;
  type: 'pod' | 'container';
  details: string;
  data: any;
}

const colorizeLine = (line: string): string => {
  if (/\b(ERROR|FAIL|CRITICAL|ERR)\b/i.test(line)) {
    return chalk.red(line);
  }
  if (/\b(WARN|WARNING)\b/i.test(line)) {
    return chalk.yellow(line);
  }
  if (/\b(INFO)\b/i.test(line)) {
    return chalk.green(line);
  }
  if (/\b(DEBUG)\b/i.test(line)) {
    return chalk.blue(line);
  }
  return line;
};

export const LogsDashboard: React.FC<LogsDashboardProps> = ({ initialName }) => {
  // Stage 1: Resource Selector state
  const [resources, setResources] = useState<SelectorResource[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadingResources, setLoadingResources] = useState(!initialName);

  // Stage 2: Log Viewer state
  const [selectedResource, setSelectedResource] = useState<SelectorResource | null>(null);
  const [logsLines, setLogsLines] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  
  // Log Search state
  const [searchMode, setSearchMode] = useState(false);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const timestampRegex = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s*)/i;

  // Fetch pods and containers for selector
  const fetchResources = async () => {
    try {
      const [podsResult, containersResult] = await Promise.allSettled([
        getRunningPods(),
        getRunningContainers()
      ]);

      const list: SelectorResource[] = [];

      if (podsResult.status === 'fulfilled') {
        podsResult.value.forEach(p => {
          list.push({
            id: `pod:${p.name}`,
            name: p.name,
            type: 'pod',
            details: `(k8s pod) namespace: ${p.namespace}`,
            data: p,
          });
        });
      }

      if (containersResult.status === 'fulfilled') {
        containersResult.value.forEach(c => {
          list.push({
            id: `container:${c.id}`,
            name: c.name,
            type: 'container',
            details: `(docker container) status: ${c.status}`,
            data: c,
          });
        });
      }

      setResources(list);
    } catch (err) {
      // Graceful fallback
    } finally {
      setLoadingResources(false);
    }
  };

  // If initialName is provided, find it directly
  const resolveInitialResource = async (name: string) => {
    try {
      const [podsResult, containersResult] = await Promise.allSettled([
        getRunningPods(),
        getRunningContainers()
      ]);

      let match: SelectorResource | null = null;

      if (containersResult.status === 'fulfilled') {
        const found = containersResult.value.find(c =>
          c.id.startsWith(name) || c.name === name || c.name.replace(/^\//, '') === name
        );
        if (found) {
          match = {
            id: `container:${found.id}`,
            name: found.name,
            type: 'container',
            details: `(docker container)`,
            data: found,
          };
        }
      }

      if (!match && podsResult.status === 'fulfilled') {
        const found = podsResult.value.find(p => p.name === name);
        if (found) {
          match = {
            id: `pod:${found.name}`,
            name: found.name,
            type: 'pod',
            details: `(k8s pod)`,
            data: found,
          };
        }
      }

      if (match) {
        setSelectedResource(match);
      } else {
        // Fallback to selector
        setLoadingResources(true);
        await fetchResources();
      }
    } catch {
      await fetchResources();
    }
  };

  useEffect(() => {
    if (initialName) {
      void resolveInitialResource(initialName);
    } else {
      void fetchResources();
    }
  }, [initialName]);

  // Fetch/stream logs
  const fetchLogs = async (res: SelectorResource) => {
    try {
      let output = '';
      if (res.type === 'pod') {
        const api = getK8sApi();
        output = await api.readNamespacedPodLog({
          name: res.name,
          namespace: res.data.namespace,
          tailLines: 100,
        });
      } else {
        const docker = getDockerClient();
        const logsBuf = await docker.getContainer(res.data.id).logs({
          stdout: true,
          stderr: true,
          tail: 100,
        });
        output = String(logsBuf);
      }
      
      const lines = output.split('\n').filter(l => l.trim().length > 0);
      setLogsLines(lines);
    } catch (err) {
      setLogsLines([`Failed to stream logs: ${(err as Error).message}`]);
    }
  };

  useEffect(() => {
    if (!selectedResource) return;

    void fetchLogs(selectedResource);

    if (!streaming) return;

    const interval = setInterval(() => {
      void fetchLogs(selectedResource);
    }, 2000);

    return () => clearInterval(interval);
  }, [selectedResource, streaming]);

  // Filter resources for fuzzy search selector
  const filteredResources = useMemo(() => {
    if (!searchQuery.trim()) return resources;
    const q = searchQuery.toLowerCase();
    return resources.filter(r => r.name.toLowerCase().includes(q));
  }, [resources, searchQuery]);

  // Sync index boundaries
  useEffect(() => {
    if (selectedIndex >= filteredResources.length && filteredResources.length > 0) {
      setSelectedIndex(filteredResources.length - 1);
    }
  }, [filteredResources.length]);

  // Find search matches in logs
  const matchedLineIndices = useMemo(() => {
    if (!logSearchQuery.trim()) return [];
    const q = logSearchQuery.toLowerCase();
    const indices: number[] = [];
    logsLines.forEach((line, idx) => {
      const displayLine = showTimestamps ? line : line.replace(timestampRegex, '');
      if (displayLine.toLowerCase().includes(q)) {
        indices.push(idx);
      }
    });
    return indices;
  }, [logsLines, logSearchQuery, showTimestamps]);

  // Keyboard navigation and key bindings
  useInput((input, key) => {
    const lowerInput = input.toLowerCase();

    // Keybindings inside log search input mode
    if (searchMode) {
      if (key.escape || key.return) {
        setSearchMode(false);
        setCurrentMatchIndex(0);
      }
      return;
    }

    if (lowerInput === 'q' || (key.ctrl && input === 'c')) {
      process.exit(0);
    }

    // Selector Mode keys
    if (!selectedResource) {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex(prev => Math.min(filteredResources.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        const activeRes = filteredResources[selectedIndex];
        if (activeRes) {
          setSelectedResource(activeRes);
        }
        return;
      }
      return;
    }

    // Log Viewer Mode keys
    if (key.escape) {
      // Go back to selector if it wasn't pre-specified
      if (!initialName) {
        setSelectedResource(null);
        setLogsLines([]);
        setLogSearchQuery('');
        setSearchMode(false);
      } else {
        process.exit(0);
      }
      return;
    }

    if (input === ' ') {
      setStreaming(prev => !prev);
      return;
    }

    if (lowerInput === 't') {
      setShowTimestamps(prev => !prev);
      return;
    }

    if (input === '/') {
      setSearchMode(true);
      setLogSearchQuery('');
      return;
    }

    if (lowerInput === 'n') {
      if (matchedLineIndices.length > 0) {
        if (key.shift) {
          // N: Previous match
          setCurrentMatchIndex(prev => (prev - 1 + matchedLineIndices.length) % matchedLineIndices.length);
        } else {
          // n: Next match
          setCurrentMatchIndex(prev => (prev + 1) % matchedLineIndices.length);
        }
      }
      return;
    }
  });

  // Render Selector Stage
  if (!selectedResource) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="yellow">
        <Box marginBottom={1}>
          <Text bold color="yellow"> Select a resource to view logs: </Text>
        </Box>
        <Box marginBottom={1} borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan"> 🔍 Search: </Text>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="type to filter..."
          />
        </Box>
        <Box flexDirection="column" minHeight={10}>
          {loadingResources ? (
            <Text color="yellow">Loading active workloads...</Text>
          ) : filteredResources.length === 0 ? (
            <Text color="gray">No matching resources found.</Text>
          ) : (
            filteredResources.map((res, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <Box key={res.id} flexDirection="row">
                  <Text color={isSelected ? 'yellow' : 'white'} width={4}>
                    {isSelected ? '> ' : '  '}
                  </Text>
                  <Text color={isSelected ? 'yellow' : 'white'} width={30}>
                    {res.name}
                  </Text>
                  <Text color="gray">
                    {res.details}
                  </Text>
                </Box>
              );
            })
          )}
        </Box>
        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>↑↓: Navigate | ENTER: Select | Q: Quit</Text>
        </Box>
      </Box>
    );
  }

  // Render Log Viewer Stage
  const renderLogLine = (line: string, lineIdx: number) => {
    let displayLine = line;
    if (!showTimestamps) {
      displayLine = line.replace(timestampRegex, '');
    }

    const colorized = colorizeLine(displayLine);

    if (!logSearchQuery.trim()) {
      return <Text key={lineIdx}>{colorized}</Text>;
    }

    const q = logSearchQuery.toLowerCase();
    const lowerDisplay = displayLine.toLowerCase();
    const matchIdx = lowerDisplay.indexOf(q);

    if (matchIdx === -1) {
      return <Text key={lineIdx}>{colorized}</Text>;
    }

    const prefix = displayLine.substring(0, matchIdx);
    const matchVal = displayLine.substring(matchIdx, matchIdx + q.length);
    const suffix = displayLine.substring(matchIdx + q.length);

    const isCurrentMatch = matchedLineIndices[currentMatchIndex] === lineIdx;
    const highlightBg = isCurrentMatch ? 'red' : 'yellow';

    return (
      <Text key={lineIdx}>
        {colorizeLine(prefix)}
        <Text backgroundColor={highlightBg} color="black">
          {matchVal}
        </Text>
        {colorizeLine(suffix)}
      </Text>
    );
  };

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          {selectedResource.name} — Logs [{streaming ? 'STREAMING' : 'PAUSED'}]
        </Text>
        {logSearchQuery && (
          <Text color="yellow">
            Match {matchedLineIndices.length > 0 ? currentMatchIndex + 1 : 0} of {matchedLineIndices.length}
          </Text>
        )}
      </Box>

      <Box borderStyle="single" borderColor="gray" minHeight={15} padding={1} flexDirection="column">
        {logsLines.length === 0 ? (
          <Text color="gray">Waiting for logs...</Text>
        ) : (
          logsLines.map((line, idx) => renderLogLine(line, idx))
        )}
      </Box>

      {searchMode && (
        <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow"> Search logs: </Text>
          <TextInput
            value={logSearchQuery}
            onChange={setLogSearchQuery}
            placeholder="type to search log lines..."
          />
        </Box>
      )}

      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          SPACE: {streaming ? 'Pause' : 'Resume'} | /: Search | T: Timestamps ({showTimestamps ? 'ON' : 'OFF'}) | {logSearchQuery ? 'n/N: Match | ' : ''}ESC: Back | Q: Quit
        </Text>
      </Box>
    </Box>
  );
};
