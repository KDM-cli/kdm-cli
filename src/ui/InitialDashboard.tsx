import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { checkDockerConnection } from '../docker/client';
import { checkK8sConnection } from '../kubernetes/client';
import { checkMinikubeConnection } from '../minikube/client';

/**
 * Docker connection status summary.
 */
export interface DockerSummary {
  connected: boolean;
  containerCount: number;
}

/**
 * Kubernetes connection status summary.
 */
export interface K8sSummary {
  connected: boolean;
  podCount: number;
}

/**
 * Minikube connection status summary.
 */
export interface MinikubeSummary {
  installed: boolean;
  running: boolean;
}

/**
 * Interactive menu action definition.
 */
export interface MenuAction {
  id: string;
  key: string;
  name: string;
  cmd: string;
  description: string;
  args: string[];
}

/**
 * Props for the InitialDashboard component.
 */
export interface InitialDashboardProps {
  version: string;
  onSelect?: (args: string[]) => void;
  onExit?: () => void;
  initialDocker?: DockerSummary;
  initialK8s?: K8sSummary;
  initialMinikube?: MinikubeSummary;
}

const MENU_ACTIONS: MenuAction[] = [
  {
    id: 'analyze',
    key: 'a',
    name: '🔍 Analyze Cluster',
    cmd: 'kdm analyze',
    description: 'Diagnose Kubernetes workloads for failures and review remediation suggestions',
    args: ['analyze'],
  },
  {
    id: 'show',
    key: 's',
    name: '📊 Show Resources',
    cmd: 'kdm show runners',
    description: 'Interactive dashboard to inspect running pods, containers, and runners',
    args: ['show', 'runners'],
  },
  {
    id: 'watch',
    key: 'w',
    name: '⏱️  Live Watch',
    cmd: 'kdm watch',
    description: 'Live real-time monitoring of cluster resources and containers',
    args: ['watch'],
  },
  {
    id: 'health',
    key: 'h',
    name: '🩺 Health Status',
    cmd: 'kdm health all',
    description: 'Evaluate health checks and readiness probes across all workloads',
    args: ['health', 'all'],
  },
  {
    id: 'logs',
    key: 'l',
    name: '📜 View Logs',
    cmd: 'kdm logs',
    description: 'Search, filter, and stream container and pod log output',
    args: ['logs'],
  },
  {
    id: 'auth',
    key: 'k',
    name: '🔑 AI Provider Config',
    cmd: 'kdm auth',
    description: 'Configure AI diagnosis backends, credentials, and models',
    args: ['auth'],
  },
  {
    id: 'help',
    key: '?',
    name: '❓ CLI Help',
    cmd: 'kdm --help',
    description: 'Display command-line flags, options, and full help documentation',
    args: ['--help'],
  },
  {
    id: 'exit',
    key: 'q',
    name: '🚪 Exit',
    cmd: 'exit',
    description: 'Exit KDM interactive dashboard',
    args: [],
  },
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Lightweight inline spinner to display async operations.
 */
const InkSpinner: React.FC = () => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);
  return <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>;
};

/**
 * Renders the top ASCII logo banner and version label.
 */
const HeaderBanner: React.FC<{ version: string }> = ({ version }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text color="cyan">  ██╗  ██╗██████╗ ███╗   ███╗</Text>
    <Text color="cyan">  ██║ ██╔╝██╔══██╗████╗ ████║</Text>
    <Text color="cyan">  █████╔╝ ██║  ██║██╔████╔██║</Text>
    <Text color="cyan">  ██╔═██╗ ██║  ██║██║╚██╔╝██║</Text>
    <Text color="cyan">  ██║  ██╗██████╔╝██║ ╚═╝ ██║</Text>
    <Text color="cyan">  ╚═╝  ╚═╝╚═════╝ ╚═╝     ╚═╝</Text>
    <Text dimColor>  ──────────────────────────────────────────────────</Text>
    <Text bold color="blue">  Kubernetes & Docker Monitor v{version}</Text>
  </Box>
);

/**
 * Connection badge helper with appropriate color coding.
 */
const ConnectionBadge: React.FC<{ label: string; active: boolean; warn?: boolean }> = ({
  label,
  active,
  warn,
}) => {
  if (active) {
    return <Text bold color="green">{label}</Text>;
  }
  if (warn) {
    return <Text bold color="yellow">{label}</Text>;
  }
  return <Text bold color="red">{label}</Text>;
};

/**
 * Displays status cards for Docker, Kubernetes, and Minikube connections.
 */
const ConnectionPanel: React.FC<{
  loading: boolean;
  docker: DockerSummary | null;
  k8s: K8sSummary | null;
  minikube: MinikubeSummary | null;
}> = ({ loading, docker, k8s, minikube }) => {
  const minikubeLabel = minikube?.installed ? (minikube.running ? 'RUNNING' : 'STOPPED') : 'NOT INSTALLED';
  const minikubeWarn = minikube?.installed && !minikube.running;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">Cluster & Service Status</Text>
        {loading && (
          <Text color="yellow">
            <InkSpinner /> Checking connections...
          </Text>
        )}
      </Box>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="column" width="33%">
          <Text bold>Docker:</Text>
          <Box flexDirection="row" gap={1}>
            <ConnectionBadge
              label={docker?.connected ? 'CONNECTED' : 'DISCONNECTED'}
              active={Boolean(docker?.connected)}
            />
            <Text dimColor>({docker?.containerCount ?? 0} containers)</Text>
          </Box>
        </Box>
        <Box flexDirection="column" width="33%">
          <Text bold>Kubernetes:</Text>
          <Box flexDirection="row" gap={1}>
            <ConnectionBadge
              label={k8s?.connected ? 'CONNECTED' : 'DISCONNECTED'}
              active={Boolean(k8s?.connected)}
            />
            <Text dimColor>({k8s?.podCount ?? 0} pods)</Text>
          </Box>
        </Box>
        <Box flexDirection="column" width="33%">
          <Text bold>Minikube:</Text>
          <ConnectionBadge
            label={minikubeLabel}
            active={Boolean(minikube?.running)}
            warn={minikubeWarn}
          />
        </Box>
      </Box>
    </Box>
  );
};

/**
 * Renders the command menu with navigation highlight.
 */
const MenuList: React.FC<{
  items: MenuAction[];
  selectedIndex: number;
}> = ({ items, selectedIndex }) => (
  <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
    <Text bold color="yellow" marginBottom={1}>Select an Action to Launch:</Text>
    {items.map((item, idx) => {
      const isSelected = idx === selectedIndex;
      return (
        <Box key={item.id} flexDirection="row" justifyContent="space-between">
          <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
            {isSelected ? '> ' : '  '}
            {item.name}
          </Text>
          <Text dimColor>[{item.cmd}]</Text>
        </Box>
      );
    })}
  </Box>
);

/**
 * Shows details and description for the currently selected command.
 */
const SelectedPreview: React.FC<{ item: MenuAction }> = ({ item }) => (
  <Box flexDirection="column" paddingX={1} marginBottom={1}>
    <Text bold color="green">Action Details:</Text>
    <Text>  Command: <Text bold color="cyan">{item.cmd}</Text></Text>
    <Text dimColor>  {item.description}</Text>
  </Box>
);

/**
 * Interactive initial home dashboard for KDM CLI.
 */
export const InitialDashboard: React.FC<InitialDashboardProps> = ({
  version,
  onSelect,
  onExit,
  initialDocker,
  initialK8s,
  initialMinikube,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [docker, setDocker] = useState<DockerSummary | null>(initialDocker ?? null);
  const [k8s, setK8s] = useState<K8sSummary | null>(initialK8s ?? null);
  const [minikube, setMinikube] = useState<MinikubeSummary | null>(initialMinikube ?? null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const [d, k, m] = await Promise.all([
        checkDockerConnection(),
        checkK8sConnection(),
        checkMinikubeConnection(),
      ]);
      setDocker(d);
      setK8s(k);
      setMinikube(m);
    } catch {
      // Graceful fallback on connection errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialDocker && !initialK8s && !initialMinikube) {
      void fetchStatus();
    }
  }, [fetchStatus, initialDocker, initialK8s, initialMinikube]);

  const handleExecute = useCallback((action: MenuAction) => {
    if (action.id === 'exit') {
      onExit?.();
    } else {
      onSelect?.(action.args);
    }
  }, [onExit, onSelect]);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(MENU_ACTIONS.length - 1, i + 1));
    } else if (key.return) {
      handleExecute(MENU_ACTIONS[selectedIndex]);
    } else if (input === 'r') {
      void fetchStatus();
    } else if (input === 'q' || key.escape) {
      onExit?.();
    } else {
      const matched = MENU_ACTIONS.find((item) => item.key === input);
      if (matched) {
        handleExecute(matched);
      }
    }
  });

  const selectedItem = MENU_ACTIONS[selectedIndex];

  return (
    <Box flexDirection="column" padding={1}>
      <HeaderBanner version={version} />
      <ConnectionPanel loading={loading} docker={docker} k8s={k8s} minikube={minikube} />
      <MenuList items={MENU_ACTIONS} selectedIndex={selectedIndex} />
      <SelectedPreview item={selectedItem} />
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          [↑/↓] Navigate   [Enter] Launch   [a] Analyze   [s] Show   [w] Watch   [r] Refresh   [q] Quit
        </Text>
      </Box>
    </Box>
  );
};
