import React from 'react';
import { Box, Text } from 'ink';
import { ResourceRow, Column, TabType } from './types';

interface ResourceTableProps {
  columns: Column[];
  rows: ResourceRow[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

const statusColor = (status: string): string => {
  const lower = status.toLowerCase();
  if (lower === 'running') return 'green';
  if (lower === 'crashloopbackoff' || lower === 'error' || lower === 'failed') return 'red';
  if (lower === 'pending' || lower === 'waiting') return 'yellow';
  return 'white';
};

const Cell: React.FC<{ content: string; width: number; color?: string }> = ({ content, width, color }) => (
  <Text color={color}>{content.padEnd(width).slice(0, width)}</Text>
);

interface CellValue { text: string; color?: string }

const formatRowCells = (row: ResourceRow, columns: Column[]): CellValue[] => {
  switch (row.type) {
    case TabType.Pods:
      return [
        { text: row.name },
        { text: row.namespace },
        { text: row.status, color: statusColor(row.status) },
        { text: String(row.restarts), color: row.restarts > 0 ? 'red' : 'green' },
        { text: row.node },
      ];
    case TabType.Containers:
      return [
        { text: row.id },
        { text: row.name },
        { text: row.image.length > 25 ? row.image.slice(0, 22) + '...' : row.image },
        { text: row.status, color: statusColor(row.state) },
        { text: row.state, color: statusColor(row.state) },
      ];
    case TabType.Nodes:
      return [
        { text: row.name },
        { text: row.status },
        { text: row.role },
        { text: row.internalIp },
        { text: row.cpu },
        { text: row.memory },
      ];
    case TabType.Runners:
      return [
        { text: row.kind, color: row.kind === 'Pod' ? 'blue' : 'cyan' },
        { text: row.primaryId },
        { text: row.secondaryId },
        { text: row.status, color: statusColor(row.status) },
        { text: row.extra },
      ];
    case TabType.Minikube:
      return [
        { text: row.name },
        { text: row.host, color: statusColor(row.host) },
        { text: row.kubelet, color: statusColor(row.kubelet) },
        { text: row.apiServer, color: statusColor(row.apiServer) },
        { text: row.message.length > 30 ? row.message.slice(0, 27) + '...' : row.message },
      ];
  }
};

export const ResourceTable: React.FC<ResourceTableProps> = ({ columns, rows, selectedIndex }) => {
  if (rows.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>  No resources found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" paddingX={1} marginBottom={1}>
        {columns.map((col) => (
          <Box key={col.header} width={col.minWidth}>
            <Text bold color="cyan">{col.header}</Text>
          </Box>
        ))}
      </Box>

      {rows.map((row, index) => {
        const isSelected = index === selectedIndex;
        const cells = formatRowCells(row, columns);
        return (
          <Box
            key={`row-${index}`}
            flexDirection="row"
            paddingX={1}
            {...(isSelected ? { backgroundColor: 'blue' } : {})}
          >
            {cells.map((cell, ci) => (
              <Box key={ci} width={columns[ci]?.minWidth ?? 10}>
                <Text color={isSelected ? 'white' : cell.color}>
                  {cell.text.padEnd(columns[ci]?.minWidth ?? 0).slice(0, columns[ci]?.minWidth ?? 0)}
                </Text>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
};
