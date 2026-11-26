import React, { useState, useRef, useEffect, type FC } from 'react';
import { Box, Text, useInput } from 'ink';
import { DiffRenderer } from './DiffRenderer.js';
import { formatToolArgs } from './SubagentProgressDisplay.js';

export interface ConfirmationRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  diff?: string;
  riskLevel: 'low' | 'medium' | 'high';
  prompt: string;
  timestamp?: number;
}

export type ConfirmationDecision = 'ALLOW' | 'DENY' | 'EDIT';

export interface ToolConfirmationQueueProps {
  request?: ConfirmationRequest;
  requests?: ConfirmationRequest[];
  queue?: ConfirmationRequest[];
  currentIndex?: number;
  onDecision: (
    decision: ConfirmationDecision,
    request: ConfirmationRequest,
    editedArgs?: Record<string, unknown>
  ) => void;
  onResolve?: (id: string, decision: ConfirmationDecision) => void;
  onAbort?: () => void;
  interactive?: boolean;
  terminalWidth?: number;
  availableTerminalHeight?: number;
}

/**
 * Evaluates safety policy against dangerous or destructive cluster mutations.
 */
export function evaluateSafetyPolicy(command: string): { allowed: boolean; violation?: string } {
  const destructivePatterns = [
    /\brm\s+(?:.*?\s+)?(-[a-z0-9]*r[a-z0-9]*f[a-z0-9]*|-[a-z0-9]*f[a-z0-9]*r[a-z0-9]*|-[a-z0-9]*r[a-z0-9]*\s+-[a-z0-9]*f[a-z0-9]*|-[a-z0-9]*f[a-z0-9]*\s+-[a-z0-9]*r[a-z0-9]*|--recursive\s+--force|--force\s+--recursive)(?:\s+.*?)*\s+\//i,
    /\bkubectl\s+delete\s+(namespace|ns)\s+(kube-system|default|production)\b/i,
    /mkfs/i,
    /dd\s+if=/i,
  ];

  for (const pattern of destructivePatterns) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        violation: `Destructive command permanently blocked by safety policy: ${command}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * ToolConfirmationQueue component:
 * Interactive confirmation queue gating mutating/dangerous cluster operations with
 * risk safety badges (low, medium, high), safety policy checks, embedded diffs,
 * and keyboard approval ([y] Approve, [n] Deny, [e] Edit).
 */
export const ToolConfirmationQueue: FC<ToolConfirmationQueueProps> = ({
  request,
  requests,
  queue,
  currentIndex = 0,
  onDecision,
  onResolve,
  onAbort,
  interactive = true,
  terminalWidth,
}) => {
  const allRequests = queue ?? requests ?? (request ? [request] : []);
  const allRequestsRef = useRef(allRequests);
  allRequestsRef.current = allRequests;
  const [internalIndex, setInternalIndex] = useState(currentIndex);
  const currentRequest = allRequests[internalIndex];

  const [decided, setDecided] = useState<ConfirmationDecision | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    handledRef.current = false;
    setDecided(null);
    setInternalIndex((prev) => {
      const maxIndex = Math.max(0, allRequests.length - 1);
      return Math.min(prev, maxIndex);
    });
  }, [currentRequest?.id, allRequests.length]);

  // Command policy inspection
  const commandToEvaluate = currentRequest
    ? String(
        currentRequest.args.command ||
        currentRequest.args.cmd ||
        currentRequest.args.script ||
        currentRequest.args.raw ||
        currentRequest.toolName
      )
    : '';
  const policy = evaluateSafetyPolicy(commandToEvaluate);

  useInput((input, key) => {
    if (!interactive || handledRef.current || !currentRequest) {
      return;
    }

    const lower = input.toLowerCase();

    const applyDecision = (decision: ConfirmationDecision) => {
      handledRef.current = true;
      setDecided(decision);
      const decidingId = currentRequest.id;
      onDecision(decision, currentRequest);
      onResolve?.(currentRequest.id, decision);

      // Advance queue if more items exist
      if (internalIndex + 1 < allRequests.length) {
        setTimeout(() => {
          const currentList = allRequestsRef.current;
          setInternalIndex((prev) => {
            const next = currentList[prev]?.id === decidingId ? prev + 1 : prev;
            const maxIndex = Math.max(0, currentList.length - 1);
            return Math.min(next, maxIndex);
          });
          setDecided(null);
          handledRef.current = false;
        }, 30);
      }
    };

    if (!policy.allowed) {
      // Destructive command blocked by policy: only DENY keystrokes allowed
      if (lower === 'n' || key.escape || key.return) {
        applyDecision('DENY');
      } else if (key.ctrl && lower === 'c') {
        onAbort?.();
        applyDecision('DENY');
      }
      return;
    }

    if (lower === 'y') {
      applyDecision('ALLOW');
    } else if (lower === 'n' || key.escape || key.return) {
      applyDecision('DENY');
    } else if (lower === 'e') {
      applyDecision('EDIT');
    } else if (key.ctrl && lower === 'c') {
      onAbort?.();
      applyDecision('DENY');
    }
    // Unrecognized keystrokes are ignored; prompt remains active
  });

  const safeTerminalWidth = terminalWidth ? Math.max(0, Math.floor(terminalWidth)) : undefined;

  if (!currentRequest) {
    return (
      <Box padding={1} width={safeTerminalWidth}>
        <Text dimColor>No pending confirmations.</Text>
      </Box>
    );
  }

  // Destructive command blocked by policy
  if (!policy.allowed) {
    return (
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor="red"
        padding={1}
        width={safeTerminalWidth}
      >
        <Text bold color="red">
          ⛔ POLICY VIOLATION: COMMAND BLOCKED
        </Text>
        <Text color="red">{policy.violation}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Execution prohibited by automated safety gate. Press <Text color="red">[n]</Text>,{' '}
            <Text color="white">[Enter]</Text>, or <Text color="white">[Esc]</Text> to dismiss.
          </Text>
        </Box>
      </Box>
    );
  }

  const riskColor =
    currentRequest.riskLevel === 'high'
      ? 'red'
      : currentRequest.riskLevel === 'medium'
      ? 'yellow'
      : 'green';

  const riskBadge = `[${currentRequest.riskLevel.toUpperCase()} RISK ACTION REQUIRED]`;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={riskColor}
      padding={1}
      width={safeTerminalWidth}
    >
      {/* Header Row */}
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={riskColor}>
          {riskBadge}
        </Text>
        <Text dimColor>
          Queue: {internalIndex + 1} of {allRequests.length} (ID: {currentRequest.id})
        </Text>
      </Box>

      {/* Tool Invocation Row */}
      <Box flexDirection="column" marginY={1}>
        <Box flexDirection="row">
          <Text bold>Tool: </Text>
          <Text color="cyan">{currentRequest.toolName}</Text>
        </Box>
        <Box flexDirection="row">
          <Text bold>Args: </Text>
          <Text color="white">{formatToolArgs(currentRequest.args)}</Text>
        </Box>
      </Box>

      {/* Prompt Question */}
      <Box marginBottom={1}>
        <Text bold>{currentRequest.prompt}</Text>
      </Box>

      {/* Embedded Diff Preview if present */}
      {currentRequest.diff ? (
        <Box marginBottom={1}>
          <DiffRenderer diff={currentRequest.diff} terminalWidth={safeTerminalWidth} />
        </Box>
      ) : null}

      {/* Action Footer */}
      <Box marginTop={1}>
        <Text bold>
          Press <Text color="green">[y]</Text> to Approve, <Text color="red">[n]</Text> to Deny,{' '}
          <Text color="yellow">[e]</Text> to Edit
        </Text>
      </Box>
    </Box>
  );
};

export const ToolConfirmationQueueView = ToolConfirmationQueue;
