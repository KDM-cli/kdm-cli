import React from 'react';
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

/**
 * Renders status icon, agent icon badge, display name, and active task message
 * for an individual specialist agent in the multi-agent council.
 */
export const AgentCard: React.FC<AgentCardProps> = ({
  role,
  name,
  icon,
  status,
  message,
}) => {
  const agentIcon = icon || getAgentIcon(role);
  const displayName = name || getAgentDisplayName(role);

  let statusElement: React.ReactNode;
  let nameColor: string | undefined;

  switch (status) {
    case 'completed':
      statusElement = <Text bold color="green">✔</Text>;
      nameColor = 'green';
      break;
    case 'running':
      statusElement = (
        <Text bold color="yellow">
          <InkSpinner />
        </Text>
      );
      nameColor = 'yellow';
      break;
    case 'failed':
      statusElement = <Text bold color="red">✖</Text>;
      nameColor = 'red';
      break;
    case 'pending':
    default:
      statusElement = <Text dimColor>⏳</Text>;
      nameColor = undefined;
      break;
  }

  return (
    <Box flexDirection="row">
      <Text>  </Text>
      {statusElement}
      <Text> </Text>
      <Text>{agentIcon} </Text>
      <Text bold color={nameColor}>
        {displayName}:{' '}
      </Text>
      {message ? (
        <Text
          color={status === 'failed' ? 'red' : status === 'running' ? 'yellow' : undefined}
          dimColor={status === 'pending'}
          wrap="wrap"
        >
          {message}
        </Text>
      ) : null}
    </Box>
  );
};
