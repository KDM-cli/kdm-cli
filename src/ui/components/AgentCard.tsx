import { type FC } from 'react';
import { Box, Text } from 'ink';
import type { AgentRole, AgentStatus } from '../../agent/types';
import { getAgentIcon, getAgentDisplayName } from '../council-state';
import { InkSpinner } from './InkSpinner';

/**
 * Props for the AgentCard component.
 */
export interface AgentCardProps {
  role: AgentRole | string;
  name?: string;
  icon?: string;
  status: AgentStatus;
  message?: string;
}

interface AgentVisualMeta {
  badge: React.ReactNode;
  color?: string;
  msgColor?: string;
}

const STATUS_VISUALS: Record<AgentStatus, AgentVisualMeta> = {
  completed: {
    badge: <Text bold color="green">✔</Text>,
    color: 'green',
  },
  running: {
    badge: (
      <Text bold color="yellow">
        <InkSpinner />
      </Text>
    ),
    color: 'yellow',
    msgColor: 'yellow',
  },
  failed: {
    badge: <Text bold color="red">✖</Text>,
    color: 'red',
    msgColor: 'red',
  },
  pending: {
    badge: <Text dimColor>⏳</Text>,
  },
};

/**
 * Renders status icon, agent icon badge, display name, and active task message
 * for an individual specialist agent in the multi-agent council.
 */
export const AgentCard: FC<AgentCardProps> = ({
  role,
  name,
  icon,
  status,
  message,
}) => {
  const agentIcon = icon || getAgentIcon(role);
  const displayName = name || getAgentDisplayName(role);
  const visual = STATUS_VISUALS[status] || STATUS_VISUALS.pending;

  return (
    <Box flexDirection="row">
      <Text>  </Text>
      {visual.badge}
      <Text> </Text>
      <Text>{agentIcon} </Text>
      <Text bold color={visual.color}>
        {displayName}:{' '}
      </Text>
      {message ? (
        <Text color={visual.msgColor} dimColor={status === 'pending'} wrap="wrap">
          {message}
        </Text>
      ) : null}
    </Box>
  );
};
