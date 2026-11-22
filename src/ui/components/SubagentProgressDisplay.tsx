import React, { useState, type FC } from 'react';
import { Box, Text, useInput } from 'ink';
import { AgentCard } from './AgentCard.js';
import { ThinkingMessage } from './ThinkingMessage.js';
import { InkSpinner } from './InkSpinner.js';
import { getAgentDisplayName, getAgentIcon } from '../council-state.js';

export interface SubagentProgress {
  agentName: string;
  state: 'running' | 'completed' | 'error' | 'cancelled';
  thought?: string;
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    status: 'running' | 'success' | 'error';
    output?: string;
  };
  result?: string;
}

export interface SubagentActivityItem {
  id: string;
  type: 'thought' | 'tool_call';
  content?: string;
  displayName?: string;
  description?: string;
  args?: Record<string, unknown> | string;
  status?: 'running' | 'completed' | 'error' | 'cancelled';
}

export interface SubagentProgressDisplayProps {
  progress?: SubagentProgress;
  subagents?: SubagentProgress[];
  activeAgentName?: string;
  initiallyExpanded?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  interactive?: boolean;
  borderStyle?: 'round' | 'single' | 'double';
  title?: string;
  terminalWidth?: number;
  availableTerminalHeight?: number;
  historyOverrides?: SubagentActivityItem[];
}

/**
 * Formats tool call arguments cleanly into key="val" pairs, truncated to max 60 chars.
 */
export function formatToolArgs(args: Record<string, unknown> | string | undefined): string {
  if (!args) return '';
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      return formatToolArgs(parsed);
    } catch {
      return args.length > 60 ? args.slice(0, 60) + '...' : args;
    }
  }

  try {
    const entries = Object.entries(args);
    if (entries.length === 0) return '';

    const formatted = entries
      .map(([k, v]) => {
        if (typeof v === 'string') return `${k}="${v}"`;
        if (typeof v === 'bigint') return `${k}=${v.toString()}n`;
        try {
          return `${k}=${JSON.stringify(v)}`;
        } catch {
          return `${k}=[Complex]`;
        }
      })
      .join(', ');

    return formatted.length > 60 ? formatted.slice(0, 60) + '...' : formatted;
  } catch {
    return String(args).slice(0, 60);
  }
}

/**
 * SubagentProgressDisplay component:
 * Real-time multi-agent observability card rendering subagent status,
 * live streaming thoughts (💭), active tool calls with spinners, checkmarks,
 * cancelled alerts, duration/args formatting, and Ctrl+O expandable cards.
 */
export const SubagentProgressDisplay: FC<SubagentProgressDisplayProps> = ({
  progress,
  subagents,
  initiallyExpanded = false,
  isExpanded: controlledExpanded,
  onToggleExpand,
  interactive = true,
  borderStyle = 'round',
  title = '🤖 Active Multi-Agent Observability',
  terminalWidth,
  historyOverrides,
}) => {
  const [internalExpanded, setInternalExpanded] = useState(initiallyExpanded);
  const expanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;

  useInput((input, key) => {
    if (!interactive) return;
    if (key.ctrl && input.toLowerCase() === 'o') {
      if (onToggleExpand) {
        onToggleExpand();
      } else {
        setInternalExpanded((prev) => !prev);
      }
    }
  });

  const agentList: SubagentProgress[] = progress
    ? [progress]
    : subagents && subagents.length > 0
    ? subagents
    : [];

  if (agentList.length === 0 && (!historyOverrides || historyOverrides.length === 0)) {
    return null;
  }

  const runningCount = agentList.filter((a) => a.state === 'running').length;
  const completedCount = agentList.filter((a) => a.state === 'completed').length;
  const errorCount = agentList.filter((a) => a.state === 'error').length;
  const cancelledCount = agentList.filter((a) => a.state === 'cancelled').length;

  const safeWidth = terminalWidth ? Math.max(0, Math.floor(terminalWidth)) : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle={borderStyle}
      borderColor={errorCount > 0 ? 'red' : 'cyan'}
      padding={1}
      width={safeWidth}
    >
      {/* Header bar */}
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          {title} ({agentList.length} agents: {runningCount} running, {completedCount} completed
          {errorCount > 0 ? `, ${errorCount} failed` : ''}
          {cancelledCount > 0 ? `, ${cancelledCount} cancelled` : ''})
        </Text>
        <Text dimColor>(ctrl+o to {expanded ? 'collapse' : 'expand'})</Text>
      </Box>

      {/* Agents rendering */}
      <Box flexDirection="column" gap={1}>
        {agentList.map((agent) => {
          const displayName = getAgentDisplayName(agent.agentName) || agent.agentName;
          const icon = getAgentIcon(agent.agentName);
          const isCancelled = agent.state === 'cancelled';
          const isFailed = agent.state === 'error';
          const isCompleted = agent.state === 'completed';
          const isRunning = agent.state === 'running';

          return (
            <Box
              key={agent.agentName}
              flexDirection="column"
              borderStyle={expanded ? 'single' : undefined}
              borderColor={isFailed ? 'red' : isCancelled ? 'yellow' : 'gray'}
              paddingX={expanded ? 1 : 0}
            >
              {/* Agent Status Row */}
              <Box flexDirection="row" alignItems="center">
                <Text>  </Text>
                {isRunning ? (
                  <Text bold color="yellow">
                    <InkSpinner />
                  </Text>
                ) : isCompleted ? (
                  <Text bold color="green">
                    ✔
                  </Text>
                ) : isFailed ? (
                  <Text bold color="red">
                    ✖
                  </Text>
                ) : isCancelled ? (
                  <Text bold color="yellow">
                    ℹ
                  </Text>
                ) : (
                  <Text dimColor>⏳</Text>
                )}
                <Text> </Text>
                <Text>{icon} </Text>
                <Text
                  bold
                  color={
                    isFailed
                      ? 'red'
                      : isCancelled
                      ? 'yellow'
                      : isCompleted
                      ? 'green'
                      : 'cyan'
                  }
                  strikethrough={isCancelled}
                >
                  {displayName}:{' '}
                </Text>
                {isCancelled ? (
                  <Text italic color="yellow">
                    Subagent {agent.agentName} was cancelled.
                  </Text>
                ) : isFailed ? (
                  <Text italic color="red" wrap="wrap">
                    Subagent {agent.agentName} failed: {agent.result || 'Unknown error'}
                  </Text>
                ) : isCompleted ? (
                  <Text italic color="green" wrap="wrap">
                    {agent.result || `Subagent ${agent.agentName} completed.`}
                  </Text>
                ) : (
                  <Text dimColor wrap="wrap">
                    {agent.thought || `Running subagent ${agent.agentName}...`}
                  </Text>
                )}
              </Box>

              {/* Streaming Thought */}
              {agent.thought ? (
                <Box paddingLeft={4} marginTop={expanded ? 1 : 0}>
                  <ThinkingMessage
                    thought={agent.thought}
                    compact={!expanded}
                    terminalWidth={safeWidth}
                  />
                </Box>
              ) : null}

              {/* Active Tool Call */}
              {agent.toolCall ? (
                <Box paddingLeft={4} flexDirection="column" marginTop={expanded ? 1 : 0}>
                  <Box flexDirection="row">
                    <Text bold color="yellow">
                      ⚡ Active Tool:{' '}
                    </Text>
                    <Text color="cyan">[{displayName}] </Text>
                    {agent.toolCall.status === 'running' ? (
                      <Text color="yellow">
                        <InkSpinner />{' '}
                      </Text>
                    ) : agent.toolCall.status === 'success' ? (
                      <Text bold color="green">
                        ✔{' '}
                      </Text>
                    ) : (
                      <Text bold color="red">
                        ✖{' '}
                      </Text>
                    )}
                    <Text
                      bold
                      color="white"
                      strikethrough={isCancelled}
                    >
                      {agent.toolCall.name}
                    </Text>
                    {agent.toolCall.output ? (
                      <Text dimColor> ({agent.toolCall.output})</Text>
                    ) : null}
                  </Box>
                  <Box paddingLeft={2}>
                    <Text color="white">→ </Text>
                    <Text color="green">
                      {agent.toolCall.name}({formatToolArgs(agent.toolCall.args)})
                    </Text>
                  </Box>
                  {expanded && agent.toolCall.output ? (
                    <Box paddingLeft={4} marginTop={0}>
                      <Text dimColor italic wrap="wrap">
                        Output: {agent.toolCall.output}
                      </Text>
                    </Box>
                  ) : null}
                </Box>
              ) : null}

              {/* Expanded Result Payload */}
              {expanded && agent.result && !isFailed ? (
                <Box paddingLeft={4} marginTop={1}>
                  <Text color="green" wrap="wrap">
                    Result: {agent.result}
                  </Text>
                </Box>
              ) : null}
            </Box>
          );
        })}

        {/* History Overrides for replay/debugging if provided */}
        {historyOverrides &&
          historyOverrides.map((item) => (
            <Box key={item.id} paddingLeft={2} flexDirection="row">
              <Text dimColor>[{item.type}] </Text>
              <Text color="cyan">{item.displayName || item.id}: </Text>
              <Text wrap="wrap">{item.content || formatToolArgs(item.args)}</Text>
            </Box>
          ))}
      </Box>
    </Box>
  );
};
