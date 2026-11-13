import { type FC } from 'react';
import { Box, Text } from 'ink';
import type { ActiveToolState } from '../council-state';
import { formatToolInvocation, getAgentDisplayName } from '../council-state';

/**
 * Props for the ActiveToolPanel component.
 */
export interface ActiveToolPanelProps {
  tool?: ActiveToolState | null;
  showIdle?: boolean;
}

/**
 * Renders the currently executing or recently executed diagnostic tool,
 * including active agent role badge, tool name, invoked arguments, and elapsed duration.
 */
export const ActiveToolPanel: FC<ActiveToolPanelProps> = ({
  tool,
  showIdle = false,
}) => {
  if (!tool) {
    if (!showIdle) return null;
    return (
      <Box marginTop={1}>
        <Text dimColor>  ⚡ Active Tool: None (idle)</Text>
      </Box>
    );
  }

  const agentLabel = tool.agentName || getAgentDisplayName(tool.role);
  const invocation = formatToolInvocation(tool.tool, tool.args);
  const durationStr =
    typeof tool.durationMs === 'number' ? ` (${tool.durationMs}ms)` : '';

  return (
    <Box marginTop={1} flexDirection="column">
      <Box flexDirection="row">
        <Text bold color="yellow">⚡ Active Tool: </Text>
        <Text color="cyan">[{agentLabel}]</Text>
        {durationStr ? <Text dimColor>{durationStr}</Text> : null}
      </Box>
      <Box paddingLeft={2}>
        <Text color="white">→ </Text>
        <Text color="green">{invocation}</Text>
      </Box>
    </Box>
  );
};
