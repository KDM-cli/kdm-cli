import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { checkDockerConnection } from '../docker/client';
import { checkK8sConnection } from '../kubernetes/client';
import { checkMinikubeConnection } from '../minikube/client';
import { AnalyzeDashboard } from './AnalyzeDashboard';
import { WatchDashboard } from './WatchDashboard';
import { HealthDashboard } from './HealthDashboard';
import { ShowDashboard } from './show/ShowDashboard';
import { LogsDashboard } from './LogsDashboard';
import { AuthDashboard } from './AuthDashboard';

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
  initialScreen?: string;
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
 * Renders an individual service status card.
 */
interface StatusCardProps {
  title: string;
  label: string;
  active: boolean;
  warn?: boolean;
  detail?: string;
}

const StatusCard: React.FC<StatusCardProps> = ({ title, label, active, warn, detail }) => (
  <Box flexDirection="column" width="33%">
    <Text bold>{title}:</Text>
    <Box flexDirection="row" gap={1}>
      <ConnectionBadge label={label} active={active} warn={warn} />
      {detail && <Text dimColor>({detail})</Text>}
    </Box>
  </Box>
);

/**
 * Helper to build status card model for Docker.
 */
function getDockerCard(docker: DockerSummary | null): StatusCardProps {
  const isConnected = docker ? docker.connected : false;
  const count = docker ? docker.containerCount : 0;
  return {
    title: 'Docker',
    label: isConnected ? 'CONNECTED' : 'DISCONNECTED',
    active: isConnected,
    detail: `${count} containers`,
  };
}

/**
 * Helper to build status card model for Kubernetes.
 */
function getK8sCard(k8s: K8sSummary | null): StatusCardProps {
  const isConnected = k8s ? k8s.connected : false;
  const count = k8s ? k8s.podCount : 0;
  return {
    title: 'Kubernetes',
    label: isConnected ? 'CONNECTED' : 'DISCONNECTED',
    active: isConnected,
    detail: `${count} pods`,
  };
}

/**
 * Helper to build status card model for Minikube.
 */
function getMinikubeCard(minikube: MinikubeSummary | null): StatusCardProps {
  if (!minikube || !minikube.installed) {
    return { title: 'Minikube', label: 'NOT INSTALLED', active: false };
  }
  if (minikube.running) {
    return { title: 'Minikube', label: 'RUNNING', active: true };
  }
  return { title: 'Minikube', label: 'STOPPED', active: false, warn: true };
}

/**
 * Displays status cards for Docker, Kubernetes, and Minikube connections.
 */
const ConnectionPanel: React.FC<{
  loading: boolean;
  docker: DockerSummary | null;
  k8s: K8sSummary | null;
  minikube: MinikubeSummary | null;
}> = ({ loading, docker, k8s, minikube }) => (
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
      <StatusCard {...getDockerCard(docker)} />
      <StatusCard {...getK8sCard(k8s)} />
      <StatusCard {...getMinikubeCard(minikube)} />
    </Box>
  </Box>
);

/**
 * Renders the command menu with navigation highlight.
 */
const MenuList: React.FC<{
  items: MenuAction[];
  selectedIndex: number;
}> = ({ items, selectedIndex }) => (
  <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
    <Box marginBottom={1}>
      <Text bold color="yellow">Select an Action to Launch:</Text>
    </Box>
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
 * Determines whether cluster connections should be fetched asynchronously.
 * Skips fetching only when all three initial status objects are supplied.
 */
export function shouldFetchStatus(
  docker?: DockerSummary,
  k8s?: K8sSummary,
  minikube?: MinikubeSummary
): boolean {
  if (!docker) return true;
  if (!k8s) return true;
  if (!minikube) return true;
  return false;
}

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
 * Screen displaying KDM CLI help documentation with back action.
 */
const HelpScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === 'b' || input.toLowerCase() === 'q') {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Text bold color="cyan" marginBottom={1}>KDM - Kubernetes & Docker Monitoring CLI Help</Text>
      <Text bold color="yellow">Available Commands:</Text>
      <Text>  kdm analyze        - Analyze Kubernetes resources for common workload problems</Text>
      <Text>  kdm show [target]  - Show running containers, pods, or runners</Text>
      <Text>  kdm watch          - Live monitoring mode using Ink split-pane dashboard</Text>
      <Text>  kdm health [target]- Show health status for pods, containers, or all</Text>
      <Text>  kdm logs [name]    - Search and stream container and pod logs</Text>
      <Text>  kdm auth           - Manage AI provider authentication and credentials</Text>
      <Text>  kdm config         - Manage KDM configuration</Text>
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>[Esc/B] Back to Main Menu   [Q] Back</Text>
      </Box>
    </Box>
  );
};

const SUB_SCREENS: Record<
  string,
  (onBack: () => void, onExit?: () => void) => React.ReactNode
> = {
  analyze: (onBack, onExit) => (
    <AnalyzeDashboard initialOptions={{ output: 'text' }} onBack={onBack} onExit={onExit} />
  ),
  show: (onBack, onExit) => <ShowDashboard onBack={onBack} onExit={onExit} />,
  watch: (onBack, onExit) => <WatchDashboard onBack={onBack} onExit={onExit} />,
  health: (onBack, onExit) => <HealthDashboard initialTarget="all" onBack={onBack} onExit={onExit} />,
  logs: (onBack, onExit) => <LogsDashboard onBack={onBack} onExit={onExit} />,
  auth: (onBack, onExit) => <AuthDashboard onBack={onBack} onExit={onExit} />,
  help: (onBack) => <HelpScreen onBack={onBack} />,
};

/**
 * Renders the active sub-dashboard screen with a Back button back to home.
 */
const renderSubScreen = (
  activeScreen: string,
  onBack: () => void,
  onExit?: () => void
): React.ReactNode => {
  const screenRenderer = SUB_SCREENS[activeScreen];
  return screenRenderer ? screenRenderer(onBack, onExit) : null;
};

/**
 * Handles keyboard input for main menu navigation and execution.
 */
function handleMenuKeyInput(
  input: string,
  key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean },
  selectedIndex: number,
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>,
  onExecute: (action: MenuAction) => void,
  onRefresh: () => void,
  onExit?: () => void
): void {
  if (key.upArrow) {
    setSelectedIndex((i) => Math.max(0, i - 1));
    return;
  }
  if (key.downArrow) {
    setSelectedIndex((i) => Math.min(MENU_ACTIONS.length - 1, i + 1));
    return;
  }
  if (key.return) {
    onExecute(MENU_ACTIONS[selectedIndex]);
    return;
  }
  if (input === 'r') {
    onRefresh();
    return;
  }
  if (input === 'q' || key.escape) {
    onExit?.();
    return;
  }
  const matched = MENU_ACTIONS.find((item) => item.key === input);
  if (matched) {
    onExecute(matched);
  }
}

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
  initialScreen = 'home',
}) => {
  const [activeScreen, setActiveScreen] = useState<string>(initialScreen);
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
    if (shouldFetchStatus(initialDocker, initialK8s, initialMinikube)) {
      void fetchStatus();
    }
  }, [fetchStatus, initialDocker, initialK8s, initialMinikube]);

  const handleExecute = useCallback((action: MenuAction) => {
    onSelect?.(action.args);
    if (action.id === 'exit') {
      onExit?.();
    } else {
      setActiveScreen(action.id);
    }
  }, [onExit, onSelect]);

  useInput((input, key) => {
    if (activeScreen === 'home') {
      handleMenuKeyInput(
        input,
        key,
        selectedIndex,
        setSelectedIndex,
        handleExecute,
        () => void fetchStatus(),
        onExit
      );
    }
  });

  if (activeScreen !== 'home') {
    return (
      <Box flexDirection="column">
        {renderSubScreen(activeScreen, () => setActiveScreen('home'), onExit)}
      </Box>
    );
  }

  const selectedItem = MENU_ACTIONS[selectedIndex];

  return (
    <Box flexDirection="column" padding={1}>
      <HeaderBanner version={version} />
      <ConnectionPanel loading={loading} docker={docker} k8s={k8s} minikube={minikube} />
      <MenuList items={MENU_ACTIONS} selectedIndex={selectedIndex} />
      <SelectedPreview item={selectedItem} />
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          [↑/↓] Navigate   [Enter] Launch   [a] Analyze   [s] Show   [w] Watch   [r] Refresh   [Esc/q] Quit
        </Text>
      </Box>
    </Box>
  );
};
