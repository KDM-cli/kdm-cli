import React from 'react';
import { Box, Text } from 'ink';
import { ResourceRow, TabType } from './types';

interface DetailOverlayProps {
  resource: ResourceRow;
  onClose: () => void;
}

interface DetailField {
  label: string;
  value: string;
  valueColor?: string;
}

const statusDisplayColor = (val: string): string => {
  const lower = val.toLowerCase();
  if (lower === 'running') return 'green';
  if (lower === 'crashloopbackoff' || lower === 'error' || lower === 'failed' || lower === 'stopped') return 'red';
  if (lower === 'pending' || lower === 'waiting') return 'yellow';
  return 'white';
};

const buildPodDetails = (row: ResourceRow & { type: TabType.Pods }): DetailField[] => [
  { label: 'Name', value: row.name },
  { label: 'Namespace', value: row.namespace },
  { label: 'Status', value: row.status, valueColor: statusDisplayColor(row.status) },
  { label: 'Restarts', value: String(row.restarts), valueColor: row.restarts > 0 ? 'red' : 'green' },
  { label: 'Node', value: row.node },
  ...(row.cpu ? [{ label: 'CPU', value: row.cpu }] : []),
  ...(row.memory ? [{ label: 'Memory', value: row.memory }] : []),
];

const buildContainerDetails = (row: ResourceRow & { type: TabType.Containers }): DetailField[] => [
  { label: 'Container ID', value: row.id },
  { label: 'Name', value: row.name },
  { label: 'Image', value: row.image },
  { label: 'Status', value: row.status },
  { label: 'State', value: row.state, valueColor: statusDisplayColor(row.state) },
  ...(row.cpu ? [{ label: 'CPU', value: row.cpu }] : []),
  ...(row.memory ? [{ label: 'Memory', value: row.memory }] : []),
];

const buildNodeDetails = (row: ResourceRow & { type: TabType.Nodes }): DetailField[] => [
  { label: 'Name', value: row.name },
  { label: 'Status', value: row.status },
  { label: 'Role', value: row.role },
  { label: 'Internal IP', value: row.internalIp },
  { label: 'CPU Capacity', value: row.cpu },
  { label: 'Memory Capacity', value: row.memory },
  { label: 'OS', value: row.osImage },
];

const buildRunnerDetails = (row: ResourceRow & { type: TabType.Runners }): DetailField[] => [
  { label: 'Type', value: row.kind, valueColor: row.kind === 'Pod' ? 'blue' : 'cyan' },
  { label: 'Name / ID', value: row.primaryId },
  { label: 'Namespace / Image', value: row.secondaryId },
  { label: 'Status', value: row.status, valueColor: statusDisplayColor(row.status) },
  { label: 'Extra', value: row.extra },
  { label: 'Restarts / State', value: row.restartsOrState },
];

const buildMinikubeDetails = (row: ResourceRow & { type: TabType.Minikube }): DetailField[] => [
  { label: 'Name', value: row.name },
  { label: 'Host', value: row.host, valueColor: statusDisplayColor(row.host) },
  { label: 'Kubelet', value: row.kubelet, valueColor: statusDisplayColor(row.kubelet) },
  { label: 'API Server', value: row.apiServer, valueColor: statusDisplayColor(row.apiServer) },
  { label: 'Message', value: row.message },
];

const buildDetails = (resource: ResourceRow): DetailField[] => {
  switch (resource.type) {
    case TabType.Pods: return buildPodDetails(resource as any);
    case TabType.Containers: return buildContainerDetails(resource as any);
    case TabType.Nodes: return buildNodeDetails(resource as any);
    case TabType.Runners: return buildRunnerDetails(resource as any);
    case TabType.Minikube: return buildMinikubeDetails(resource as any);
  }
};

const getTitle = (resource: ResourceRow): string => {
  switch (resource.type) {
    case TabType.Pods: return `Pod: ${resource.name}`;
    case TabType.Containers: return `Container: ${resource.name}`;
    case TabType.Nodes: return `Node: ${resource.name}`;
    case TabType.Runners: return `${resource.kind}: ${resource.primaryId}`;
    case TabType.Minikube: return `Minikube: ${resource.name}`;
  }
};

export const DetailOverlay: React.FC<DetailOverlayProps> = ({ resource, onClose }) => {
  const details = buildDetails(resource);
  const title = getTitle(resource);

  return (
    <Box flexDirection="column" width="100%" height="100%" alignItems="center" justifyContent="center">
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} minWidth={50}>
        <Text bold color="cyan">{title}</Text>
        <Box marginY={1} flexDirection="column">
          {details.map((field, i) => (
            <Box key={i} flexDirection="row" justifyContent="space-between" width="100%">
              <Text bold>{field.label}:</Text>
              <Text color={field.valueColor ?? 'white'}>{field.value}</Text>
            </Box>
          ))}
        </Box>
        <Text dimColor>  Press ESC to close</Text>
      </Box>
    </Box>
  );
};
