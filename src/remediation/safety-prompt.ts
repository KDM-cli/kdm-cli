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
 * Internal header banner component.
 */
const RemediationHeader: React.FC = () => {
  return React.createElement(
    Box,
    { marginBottom: 1 },
    React.createElement(Text, { bold: true, color: 'cyan' }, 'Remediation Proposal')
  );
};

/**
 * Action row display component.
 */
const ActionRow: React.FC<{ action: string }> = ({ action }) => {
  return React.createElement(
    Box,
    { flexDirection: 'row' },
    React.createElement(Text, { bold: true }, 'Action: '),
    React.createElement(Text, null, action)
  );
};

/**
 * Risk badge row display component.
 */
const RiskRow: React.FC<{ risk: string; riskDetails?: string }> = ({ risk, riskDetails }) => {
  const badge = `${risk.toUpperCase()}${riskDetails ? ` · ${riskDetails}` : ''}`;
  const color = getRiskColor(risk);
  return React.createElement(
    Box,
    { flexDirection: 'row' },
    React.createElement(Text, { bold: true }, 'Risk:   '),
    React.createElement(Text, { bold: true, color }, badge)
  );
};

/**
 * Proposed command display component.
 */
const CommandBlock: React.FC<{ command: string }> = ({ command }) => {
  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    React.createElement(Text, { bold: true }, 'Command:'),
    React.createElement(Text, { color: 'yellow' }, `  $ ${command}`)
  );
};

/**
 * Unified diff preview display component.
 */
const DiffBlock: React.FC<{ diffPreview?: string | string[] }> = ({ diffPreview }) => {
  const lines = parseDiffLines(diffPreview);
  if (lines.length === 0) {
    return null;
  }
  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    React.createElement(Text, { bold: true }, 'Diff Preview:'),
    lines.map((line, idx) => {
      const color = line.startsWith('+') ? 'green' : line.startsWith('-') ? 'red' : undefined;
      return React.createElement(Text, { key: idx, color }, `  ${line}`);
    })
  );
};

/**
 * Confirmation status / prompt message row.
 */
const PromptStatus: React.FC<{ decided: boolean | null; promptMessage: string }> = ({
  decided,
  promptMessage,
}) => {
  if (decided === true) {
    return React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(Text, { color: 'green', bold: true }, '✔ Remediation confirmed by user.')
    );
  }
  if (decided === false) {
    return React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(Text, { color: 'red', bold: true }, '✖ Remediation aborted.')
    );
  }
  return React.createElement(
    Box,
    { marginTop: 1 },
    React.createElement(Text, { bold: true, color: 'cyan' }, `${promptMessage} `)
  );
};

/**
 * Custom hook to manage single keypress interactive confirmation logic.
 */
function useSafetyKeypress(
  onConfirm?: () => void,
  onAbort?: () => void,
  onDecision?: (confirmed: boolean) => void
): boolean | null {
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

    const isAffirmative = input === 'y' || input === 'Y';
    setDecided(isAffirmative);
    if (isAffirmative) {
      onConfirm?.();
      onDecision?.(true);
    } else {
      onAbort?.();
      onDecision?.(false);
    }
    exitFn?.();
  });

  return decided;
}

/**
 * Interactive Safety Confirmation Prompt Component.
 */
export const SafetyPrompt: React.FC<SafetyPromptProps> = (props) => {
  const action = props.action || props.proposal?.action || 'Remediation Action';
  const risk = props.risk || props.proposal?.risk || 'LOW';
  const riskDetails =
    props.riskDetails ||
    props.proposal?.riskDetails ||
    (risk.toLowerCase() === 'low' ? 'Safe rollback available' : undefined);
  const command = props.command || props.proposal?.command || '';
  const diffPreview = props.diffPreview ?? props.proposal?.diffPreview;
  const promptMessage = props.promptMessage || 'Apply this remediation to the cluster? [y/N]:';

  const decided = useSafetyKeypress(props.onConfirm, props.onAbort, props.onDecision);

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: 'cyan',
      paddingX: 1,
      minWidth: 60,
    },
    React.createElement(RemediationHeader, null),
    React.createElement(ActionRow, { action }),
    React.createElement(RiskRow, { risk, riskDetails }),
    React.createElement(CommandBlock, { command }),
    React.createElement(DiffBlock, { diffPreview }),
    React.createElement(PromptStatus, { decided, promptMessage })
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
