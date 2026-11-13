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

interface NormalizedPromptState {
  action: string;
  risk: string;
  riskDetails: string;
  command: string;
  diffPreview?: string | string[];
  promptMessage: string;
}

const DEFAULT_PROMPT = 'Apply this remediation to the cluster? [y/N]:';

const RISK_COLORS: Record<string, 'green' | 'yellow' | 'red'> = {
  low: 'green',
  medium: 'yellow',
  high: 'red',
};

/**
 * Resolves the display color for a given risk level string.
 */
export function getRiskColor(risk: string): 'green' | 'yellow' | 'red' | 'cyan' {
  const normalized = risk.trim().toLowerCase();
  return RISK_COLORS[normalized] || 'cyan';
}

/**
 * Parses raw diff preview content into clean line entries.
 */
export function parseDiffLines(diffPreview?: string | string[]): string[] {
  if (!diffPreview) {
    return [];
  }
  if (Array.isArray(diffPreview)) {
    return diffPreview;
  }
  return diffPreview.split('\n').filter(Boolean);
}

/**
 * Resolves default rollback risk details note.
 */
function extractRiskDetails(risk: string, details?: string): string {
  if (details) {
    return details;
  }
  return risk.toLowerCase() === 'low' ? 'Safe rollback available' : '';
}

/**
 * Normalizes input props into clean presentation fields.
 */
function resolvePromptProps(props: SafetyPromptProps): NormalizedPromptState {
  const source = { ...props.proposal, ...props };
  const action = source.action || 'Remediation Action';
  const risk = source.risk || 'LOW';
  const riskDetails = extractRiskDetails(risk, source.riskDetails);
  const command = source.command || '';
  const promptMessage = source.promptMessage || DEFAULT_PROMPT;

  return {
    action,
    risk,
    riskDetails,
    command,
    diffPreview: source.diffPreview,
    promptMessage,
  };
}

/**
 * Header title banner component.
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
const RiskRow: React.FC<{ risk: string; riskDetails: string }> = ({ risk, riskDetails }) => {
  const badge = riskDetails ? `${risk.toUpperCase()} · ${riskDetails}` : risk.toUpperCase();
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
 * Resolves color for a diff line.
 */
function getDiffLineColor(line: string): 'green' | 'red' | undefined {
  if (line.startsWith('+')) {
    return 'green';
  }
  if (line.startsWith('-')) {
    return 'red';
  }
  return undefined;
}

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
      const color = getDiffLineColor(line);
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
 * Fires callbacks for decision notification.
 */
function notifyCallbacks(
  actionFn?: () => void,
  decisionFn?: (confirmed: boolean) => void,
  decisionResult = false
): void {
  if (actionFn) {
    actionFn();
  }
  if (decisionFn) {
    decisionFn(decisionResult);
  }
}

/**
 * Safely dispatches callback events on user decision.
 */
function dispatchDecision(
  isAffirmative: boolean,
  props: SafetyPromptProps,
  exitFn?: () => void
): void {
  const actionFn = isAffirmative ? props.onConfirm : props.onAbort;
  notifyCallbacks(actionFn, props.onDecision, isAffirmative);
  if (exitFn) {
    exitFn();
  }
}

/**
 * Tests whether input is affirmative ('y' or 'Y').
 */
function isYesKey(input: string): boolean {
  return input === 'y' || input === 'Y';
}

/**
 * Custom hook to manage single keypress interactive confirmation logic.
 */
function useSafetyKeypress(props: SafetyPromptProps): boolean | null {
  const [decided, setDecided] = useState<boolean | null>(null);
  const handledRef = useRef(false);

  let exitFn: (() => void) | undefined;
  try {
    const app = useApp();
    exitFn = app.exit;
  } catch {
    // Outside Ink App context
  }

  useInput((input) => {
    if (handledRef.current) {
      return;
    }
    handledRef.current = true;

    const affirmative = isYesKey(input);
    setDecided(affirmative);
    dispatchDecision(affirmative, props, exitFn);
  });

  return decided;
}

/**
 * Interactive Safety Confirmation Prompt Component.
 */
export const SafetyPrompt: React.FC<SafetyPromptProps> = (props) => {
  const state = resolvePromptProps(props);
  const decided = useSafetyKeypress(props);

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
    React.createElement(ActionRow, { action: state.action }),
    React.createElement(RiskRow, { risk: state.risk, riskDetails: state.riskDetails }),
    React.createElement(CommandBlock, { command: state.command }),
    React.createElement(DiffBlock, { diffPreview: state.diffPreview }),
    React.createElement(PromptStatus, { decided, promptMessage: state.promptMessage })
  );
};

/**
 * Converts proposal or props input into SafetyPromptProps.
 */
function createPromptProps(
  input: RemediationProposal | SafetyPromptProps,
  onDecision: (confirmed: boolean) => void
): SafetyPromptProps {
  if ('action' in input || 'command' in input) {
    return { ...input, onDecision };
  }
  return { proposal: input as RemediationProposal, onDecision };
}

/**
 * Resolves standard or mocked stdin/stdout streams.
 */
function resolveIOOptions(options?: PromptSafetyOptions): { stdin: any; stdout: any } {
  const stdin = options && options.stdin ? options.stdin : process.stdin;
  const stdout = options && options.stdout ? options.stdout : process.stdout;
  return { stdin, stdout };
}

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
    let settled = false;
    const onDecision = (confirmed: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(confirmed);
    };

    const props = createPromptProps(proposal, onDecision);
    const io = resolveIOOptions(options);

    const instance = render(React.createElement(SafetyPrompt, props), io);
    instance.waitUntilExit().finally(() => onDecision(false));
  });
}
