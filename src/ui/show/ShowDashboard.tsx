import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { TabType, TabConfig, Column, ResourceRow, PodRow, ContainerRow, NodeRow, RunnerRow, MinikubeRow, DataError } from './types';
import { TabBar } from './TabBar';
import { SearchInput } from './SearchInput';
import { ResourceTable } from './ResourceTable';
import { DetailOverlay } from './DetailOverlay';
import { HelpBar } from './HelpBar';
import { getRunningPods, PodData, getK8sClusterStats, K8sClusterStats } from '../../kubernetes/pods';
import { getRunningContainers, ContainerData, getDockerSystemStats, DockerSystemStats, formatDockerBytes } from '../../docker/containers';
import { listNodes } from '../../kubernetes/resources';
import { getMinikubeStatus } from '../../minikube/client';
import type * as k8s from '@kubernetes/client-node';

const columnConfigs: Record<TabType, Column[]> = {
  [TabType.Pods]: [
    { header: 'NAME', minWidth: 30, isPrimary: true },
    { header: 'NAMESPACE', minWidth: 16 },
    { header: 'STATUS', minWidth: 12 },
    { header: 'RESTARTS', minWidth: 8 },
    { header: 'NODE', minWidth: 20 },
  ],
  [TabType.Containers]: [
    { header: 'CONTAINER ID', minWidth: 14, isPrimary: true },
    { header: 'NAME', minWidth: 22 },
    { header: 'IMAGE', minWidth: 28 },
    { header: 'STATUS', minWidth: 20 },
    { header: 'STATE', minWidth: 10 },
  ],
  [TabType.Nodes]: [
    { header: 'NAME', minWidth: 24, isPrimary: true },
    { header: 'STATUS', minWidth: 10 },
    { header: 'ROLE', minWidth: 14 },
    { header: 'INTERNAL-IP', minWidth: 16 },
    { header: 'CPU', minWidth: 10 },
    { header: 'MEMORY', minWidth: 10 },
  ],
  [TabType.Runners]: [
    { header: 'TYPE', minWidth: 10 },
    { header: 'NAME / ID', minWidth: 24, isPrimary: true },
    { header: 'NAMESPACE / IMAGE', minWidth: 28 },
    { header: 'STATUS', minWidth: 12 },
    { header: 'NODE / STATE', minWidth: 16 },
  ],
  [TabType.Minikube]: [
    { header: 'NAME', minWidth: 14, isPrimary: true },
    { header: 'HOST', minWidth: 12 },
    { header: 'KUBELET', minWidth: 12 },
    { header: 'APISERVER', minWidth: 12 },
    { header: 'MESSAGE', minWidth: 30 },
  ],
};

const podsToRows = (data: PodData[], stats: K8sClusterStats | null): PodRow[] =>
  data.map(p => ({
    type: TabType.Pods,
    name: p.name,
    namespace: p.namespace,
    status: p.status,
    restarts: p.restarts,
    node: p.node,
  }));

const containersToRows = (data: ContainerData[], stats: DockerSystemStats | null): ContainerRow[] =>
  data.map(c => ({
    type: TabType.Containers,
    id: c.id,
    name: c.name,
    image: c.image,
    status: c.status,
    state: c.state,
  }));

const nodesToRows = (data: k8s.V1Node[]): NodeRow[] =>
  data.map(n => ({
    type: TabType.Nodes,
    name: n.metadata?.name || 'Unknown',
    status: n.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True' ? 'Ready' : 'NotReady',
    role: n.metadata?.labels?.['node-role.kubernetes.io/control-plane']
      ? 'control-plane'
      : n.metadata?.labels?.['node-role.kubernetes.io/master']
      ? 'master'
      : '<none>',
    internalIp: n.status?.addresses?.find(a => a.type === 'InternalIP')?.address || '-',
    cpu: n.status?.capacity?.cpu || '-',
    memory: n.status?.capacity?.memory || '-',
    osImage: n.status?.nodeInfo?.osImage || '-',
  }));

const runnersToRows = (podData: PodData[], containerData: ContainerData[]): RunnerRow[] => [
  ...podData.map(p => ({
    type: TabType.Runners as const,
    kind: 'Pod' as const,
    primaryId: p.name,
    secondaryId: p.namespace,
    status: p.status,
    extra: p.node,
    restartsOrState: String(p.restarts),
  })),
  ...containerData.map(c => ({
    type: TabType.Runners as const,
    kind: 'Container' as const,
    primaryId: c.name,
    secondaryId: c.image,
    status: c.status,
    extra: c.state,
    restartsOrState: c.state,
  })),
];

const minikubeToRows = (data: any[]): MinikubeRow[] =>
  data.map(s => ({
    type: TabType.Minikube as const,
    name: s.Name || '-',
    host: s.Host || '-',
    kubelet: s.Kubelet || '-',
    apiServer: s.APIServer || '-',
    message: s.Message || '-',
  }));

const ErrorBanner: React.FC<{ errors: DataError[] }> = ({ errors }) => {
  if (errors.length === 0) return null;
  return (
    <Box marginBottom={1} paddingX={1} flexDirection="column">
      {errors.map((err, i) => (
        <Box key={i} marginBottom={i < errors.length - 1 ? 1 : 0}>
          <Text backgroundColor="red" white bold>
            {` ${err.source.toUpperCase()}: ${err.message} `}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

export const ShowDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>(TabType.Pods);
  const [selectedRow, setSelectedRow] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const [pods, setPods] = useState<PodData[]>([]);
  const [containers, setContainers] = useState<ContainerData[]>([]);
  const [nodes, setNodes] = useState<k8s.V1Node[]>([]);
  const [minikubeStatus, setMinikubeStatus] = useState<any[]>([]);
  const [k8sStats, setK8sStats] = useState<K8sClusterStats | null>(null);
  const [dockerStats, setDockerStats] = useState<DockerSystemStats | null>(null);
  const [errors, setErrors] = useState<DataError[]>([]);
  const [columns, setColumns] = useState(process.stdout.columns || 80);

  useEffect(() => {
    const handleResize = () => setColumns(process.stdout.columns || 80);
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

    const fetchData = async () => {
      const [podsResult, containersResult, nodesResult, minikubeResult, k8sStatsResult, dockerStatsResult] =
        await Promise.allSettled([
          getRunningPods(),
          getRunningContainers(),
          listNodes(),
          getMinikubeStatus(),
          getK8sClusterStats(),
          getDockerSystemStats(),
        ]);

      if (!isMounted) return;

      const newErrors: DataError[] = [];

      if (podsResult.status === 'fulfilled') {
        setPods(podsResult.value);
      } else {
        newErrors.push({ source: 'k8s', message: 'Kubernetes pods unreachable' });
        setPods([]);
      }

      if (containersResult.status === 'fulfilled') {
        setContainers(containersResult.value);
      } else {
        newErrors.push({ source: 'docker', message: 'Docker containers unreachable' });
        setContainers([]);
      }

      if (nodesResult.status === 'fulfilled') {
        setNodes(nodesResult.value);
      } else {
        newErrors.push({ source: 'nodes', message: 'Kubernetes nodes unreachable' });
        setNodes([]);
      }

      if (minikubeResult.status === 'fulfilled') {
        setMinikubeStatus(minikubeResult.value);
      } else {
        newErrors.push({ source: 'minikube', message: 'Minikube status unreachable' });
        setMinikubeStatus([]);
      }

      setK8sStats(k8sStatsResult.status === 'fulfilled' ? k8sStatsResult.value : null);
      setDockerStats(dockerStatsResult.status === 'fulfilled' ? dockerStatsResult.value : null);

      setErrors(newErrors);
    };

    void fetchData();
    return () => { isMounted = false; };
  }, []);

  const tabs: TabConfig[] = useMemo(() => [
    { key: TabType.Pods, label: 'Pods', count: pods.length, disconnected: errors.some(e => e.source === 'k8s') },
    { key: TabType.Containers, label: 'Containers', count: containers.length, disconnected: errors.some(e => e.source === 'docker') },
    { key: TabType.Nodes, label: 'Nodes', count: nodes.length, disconnected: errors.some(e => e.source === 'nodes') },
    { key: TabType.Runners, label: 'Runners', count: pods.length + containers.length, disconnected: errors.some(e => e.source === 'k8s' || e.source === 'docker') },
    { key: TabType.Minikube, label: 'Minikube', count: minikubeStatus.length, disconnected: errors.some(e => e.source === 'minikube') },
  ], [pods, containers, nodes, minikubeStatus, errors]);

  const getTabData = (tab: TabType): ResourceRow[] => {
    switch (tab) {
      case TabType.Pods: return podsToRows(pods, k8sStats);
      case TabType.Containers: return containersToRows(containers, dockerStats);
      case TabType.Nodes: return nodesToRows(nodes);
      case TabType.Runners: return runnersToRows(pods, containers);
      case TabType.Minikube: return minikubeToRows(minikubeStatus);
    }
  };

  const getPrimaryField = (row: ResourceRow): string => {
    switch (row.type) {
      case TabType.Pods: return row.name;
      case TabType.Containers: return row.name;
      case TabType.Nodes: return row.name;
      case TabType.Runners: return row.primaryId;
      case TabType.Minikube: return row.name;
    }
  };

  const getFilteredRows = (rows: ResourceRow[], query: string): ResourceRow[] => {
    if (!query.trim()) return rows;
    const lowerQuery = query.toLowerCase();
    return rows.filter(row => getPrimaryField(row).toLowerCase().includes(lowerQuery));
  };

  useInput((input, key) => {
    if (showDetail) {
      if (key.escape) setShowDetail(false);
      return;
    }

    if (input.toLowerCase() === 'q' || (key.ctrl && input === 'c')) {
      process.exit(0);
    }

    if (key.tab || key.rightArrow) {
      setActiveTab(prev => {
        const keys = Object.values(TabType);
        const idx = keys.indexOf(prev);
        const next = key.shiftTab ? (idx - 1 + keys.length) % keys.length : (idx + 1) % keys.length;
        setSelectedRow(0);
        return keys[next];
      });
      return;
    }
    if (key.leftArrow) {
      setActiveTab(prev => {
        const keys = Object.values(TabType);
        const idx = keys.indexOf(prev);
        const next = (idx - 1 + keys.length) % keys.length;
        setSelectedRow(0);
        return keys[next];
      });
      return;
    }

    if (key.upArrow) {
      setSelectedRow(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedRow(prev => {
        const rows = getFilteredRows(getTabData(activeTab), searchQuery);
        if (rows.length === 0) return 0;
        return Math.min(rows.length - 1, prev + 1);
      });
      return;
    }

    if (input === '/') {
      setShowSearch(prev => !prev);
      if (!showSearch) setSearchQuery('');
      return;
    }

    if (key.return && !showSearch) {
      const rows = getFilteredRows(getTabData(activeTab), searchQuery);
      if (rows.length > 0 && selectedRow < rows.length) {
        setShowDetail(true);
      }
      return;
    }

    if (key.escape && showSearch) {
      setShowSearch(false);
      setSearchQuery('');
    }
  });

  const currentData = getTabData(activeTab);
  const currentColumns = columnConfigs[activeTab];
  const filteredRows = getFilteredRows(currentData, searchQuery);

  useEffect(() => {
    if (filteredRows.length === 0) {
      if (selectedRow !== 0) setSelectedRow(0);
    } else if (selectedRow >= filteredRows.length) {
      setSelectedRow(filteredRows.length - 1);
    }
  }, [filteredRows.length]);

  return (
    <Box flexDirection="column" padding={1}>
      <TabBar activeTab={activeTab} tabs={tabs} onTabChange={(tab) => { setActiveTab(tab); setSelectedRow(0); }} />
      <ErrorBanner errors={errors} />
      {showSearch && <SearchInput value={searchQuery} onChange={setSearchQuery} />}
      <ResourceTable
        columns={currentColumns}
        rows={filteredRows}
        selectedIndex={selectedRow}
        onSelect={setSelectedRow}
      />
      <HelpBar />
      {showDetail && filteredRows[selectedRow] && (
        <DetailOverlay
          resource={filteredRows[selectedRow]}
          onClose={() => setShowDetail(false)}
        />
      )}
    </Box>
  );
};
