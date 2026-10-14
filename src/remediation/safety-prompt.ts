/**
 * Remediation Safety Prompt — KDM v4.0.0
 * ======================================
 * Interactive terminal confirmation gate built with React Ink.
 * Requires explicit human confirmation before executing any cluster mutation.
 * Destructive commands are permanently blocked by policy; valid mutations
 * require an explicit 'y' / 'Y' keypress, defaulting to abort on Enter or 'n'.
 */

import React, { useState, useRef } from 'react';
import { Box, Text, useApp, useInput, render } from 'ink';

export interface RemediationProposal {
  action: string;
  risk: string;
  riskDetails?: string;
  command: string;
  diffPreview?: string | string[];
}

export interface SafetyPromptProps {
  proposal?: RemediationProposal;
  action?: string;
  risk?: string;
  riskDetails?: string;
  command?: string;
  diffPreview?: string | string[];
  promptMessage?: string;
  onConfirm?: () => void;
  onAbort?: () => void;
  onDecision?: (confirmed: boolean) => void;
}

export interface PromptSafetyOptions {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

/**
 * Resolves the display color for a given risk level string.
 */
export function getRiskColor(risk: string): 'green' | 'yellow' | 'red' | 'cyan' {
  const normalized = risk.trim().toLowerCase();
  if (normalized === 'low') {
    return 'green';
  }
  if (normalized === 'medium') {
    return 'yellow';
  }
  if (normalized === 'high') {
    return 'red';
  }
  return 'cyan';
}

/**
 * Parses raw diff preview content into clean line entries.
 */
export function parseDiffLines(diffPreview?: string | string[]): string[] {
  if (!diffPreview) {
    return [];
  }
  if (Array.isArray(diffPreview)) {
    return diffPreview.map((line) => line.trimEnd()).filter(Boolean);
  }
  return diffPreview
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

/**
 * Renders diff lines with syntax coloring.
 */
function renderDiffLines(diffLines: string[]): React.ReactNode {
  return diffLines.map((line, idx) => {
    let color: 'green' | 'red' | undefined;
    if (line.startsWith('+')) {
      color = 'green';
    } else if (line.startsWith('-')) {
      color = 'red';
    }
    return React.createElement(
      Text,
      { key: idx, color },
      `  ${line}`
    );
  });
}

/**
 * Interactive Safety Confirmation Prompt Component.
 */
export const SafetyPrompt: React.FC<SafetyPromptProps> = (props) => {
  const {
    proposal,
    action = proposal?.action || 'Remediation Action',
    risk = proposal?.risk || 'LOW',
    riskDetails = proposal?.riskDetails || (risk.toLowerCase() === 'low' ? 'Safe rollback available' : undefined),
    command = proposal?.command || '',
    diffPreview = proposal?.diffPreview,
    promptMessage = 'Apply this remediation to the cluster? [y/N]:',
    onConfirm,
    onAbort,
    onDecision,
  } = props;

  const [decided, setDecided] = useState<boolean | null>(null);
  const handledRef = useRef(false);

  let exitFn: (() => void) | undefined;
  try {
    const app = useApp();
    exitFn = app.exit;
  } catch {
    // Outside Ink App context
  }

  useInput((input, _key) => {
    if (handledRef.current) {
      return;
    }
    handledRef.current = true;

    if (input === 'y' || input === 'Y') {
      setDecided(true);
      onConfirm?.();
      onDecision?.(true);
      exitFn?.();
      return;
    }

    // Default Enter, 'n', 'N', Escape, or any other single keypress aborts
    setDecided(false);
    onAbort?.();
    onDecision?.(false);
    exitFn?.();
  });

  const riskBadgeText = `${risk.toUpperCase()}${riskDetails ? ` · ${riskDetails}` : ''}`;
  const riskColor = getRiskColor(risk);
  const diffLines = parseDiffLines(diffPreview);

  const statusFeedback = decided === true
    ? React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { color: 'green', bold: true }, '✔ Remediation confirmed by user.')
      )
    : decided === false
    ? React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { color: 'red', bold: true }, '✖ Remediation aborted.')
      )
    : React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { bold: true, color: 'cyan' }, `${promptMessage} `)
      );

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: 'cyan',
      paddingX: 1,
      minWidth: 60,
    },
    // Header
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(Text, { bold: true, color: 'cyan' }, 'Remediation Proposal')
    ),
    // Action line
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { bold: true }, 'Action: '),
      React.createElement(Text, null, action)
    ),
    // Risk line
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { bold: true }, 'Risk:   '),
      React.createElement(Text, { bold: true, color: riskColor }, riskBadgeText)
    ),
    // Command section
    React.createElement(
      Box,
      { flexDirection: 'column', marginTop: 1 },
      React.createElement(Text, { bold: true }, 'Command:'),
      React.createElement(Text, { color: 'yellow' }, `  $ ${command}`)
    ),
    // Diff Preview section
    diffLines.length > 0 &&
      React.createElement(
        Box,
        { flexDirection: 'column', marginTop: 1 },
        React.createElement(Text, { bold: true }, 'Diff Preview:'),
        renderDiffLines(diffLines)
      ),
    // Prompt or Decision status
    statusFeedback
  );
};

/**
 * Helper function to mount and prompt for user confirmation interactively.
 *
 * @param proposal - The remediation proposal details or prompt props.
 * @param options - Custom stdin/stdout streams for testing or terminal routing.
 * @returns Promise resolving to true if confirmed, false if aborted.
 */
export function promptSafetyConfirmation(
  proposal: RemediationProposal | SafetyPromptProps,
  options?: PromptSafetyOptions
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const settle = (confirmed: boolean) => {
      if (!resolved) {
        resolved = true;
        resolve(confirmed);
      }
    };

    const hasProposalField = 'proposal' in proposal;
    const isDirectProps = 'action' in proposal || 'command' in proposal;
    const props: SafetyPromptProps = isDirectProps && !hasProposalField
      ? { ...(proposal as SafetyPromptProps), onDecision: settle }
      : { proposal: proposal as RemediationProposal, onDecision: settle };

    const instance = render(React.createElement(SafetyPrompt, props), {
      stdin: (options?.stdin as any) || process.stdin,
      stdout: (options?.stdout as any) || process.stdout,
    });

    instance.waitUntilExit().then(() => {
      settle(false);
    }).catch(() => {
      settle(false);
    });
  });
}
