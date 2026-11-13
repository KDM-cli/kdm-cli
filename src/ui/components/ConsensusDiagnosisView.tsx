import React, { FC, ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { ConsensusDiagnosis, AgentFinding, BestSolution } from '../../agent/types';

/**
 * Props for the ConsensusDiagnosisView component.
 */
export interface ConsensusDiagnosisViewProps {
  consensus?: ConsensusDiagnosis | null;
  details?: string | null;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'green',
  medium: 'yellow',
  low: 'red',
};

const RISK_COLORS: Record<string, string> = {
  low: 'green',
  medium: 'yellow',
  high: 'red',
};

function resolveBadgeColor(map: Record<string, string>, val?: string, fallback = 'yellow'): string {
  if (!val) return fallback;
  return map[val.toLowerCase()] || fallback;
}

const FindingsSection: FC<{ findings?: AgentFinding[] }> = ({ findings }) => {
  if (!findings || findings.length === 0) return null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">Specialist Agent Findings:</Text>
      {findings.map((f, i) => (
        <Box key={i} paddingLeft={2}>
          <Text color="green">✔ </Text>
          {f.icon ? <Text>{f.icon} </Text> : null}
          <Text bold>{f.agentName || f.role}: </Text>
          <Text color="white">{f.summary || f.statusText}</Text>
        </Box>
      ))}
    </Box>
  );
};

const RemediationSection: FC<{ solution: BestSolution }> = ({ solution }) => {
  const riskColor = resolveBadgeColor(RISK_COLORS, solution.riskLevel);
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold color="green">Recommended Remediation: </Text>
        <Text bold color={riskColor}>
          [{solution.riskLevel.toUpperCase()} RISK]
        </Text>
      </Box>
      <Box paddingLeft={2}>
        <Text bold color="white">{solution.actionTitle}</Text>
      </Box>
      {solution.steps && solution.steps.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1}>
          {solution.steps.map((step, idx) => (
            <Text key={idx} color="white">
              • {step}
            </Text>
          ))}
        </Box>
      )}
      {solution.commandToRun && (
        <Box marginY={1} borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">Command: {solution.commandToRun}</Text>
        </Box>
      )}
    </Box>
  );
};

const StructuredConsensusView: FC<{ consensus: ConsensusDiagnosis }> = ({ consensus }) => {
  const confColor = resolveBadgeColor(CONFIDENCE_COLORS, consensus.confidence, 'cyan');
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" marginBottom={0}>
        <Text bold color="yellow">Root Cause: </Text>
        <Text bold color={confColor}>
          [{consensus.confidence.toUpperCase()} CONFIDENCE]
        </Text>
      </Box>
      <Box paddingLeft={2} marginBottom={1}>
        <Text bold color="white">{consensus.rootCause}</Text>
      </Box>

      <FindingsSection findings={consensus.findings} />
      <RemediationSection solution={consensus.bestSolution} />

      {consensus.evidenceCitations && consensus.evidenceCitations.length > 0 && (
        <Box marginTop={1} paddingLeft={2}>
          <Text dimColor>Evidence Citations: {consensus.evidenceCitations.join(', ')}</Text>
        </Box>
      )}
    </Box>
  );
};

interface PrefixHandler {
  prefix: string;
  render: (trimmed: string, idx: number) => ReactNode;
}

const PREFIX_HANDLERS: PrefixHandler[] = [
  { prefix: 'Root Cause', render: (t, i) => <Box key={i} marginTop={1}><Text bold color="yellow">{t}</Text></Box> },
  { prefix: 'Recommended Remediation:', render: (t, i) => <Box key={i} marginTop={1}><Text bold color="green">{t}</Text></Box> },
  { prefix: 'Specialist Agent Findings:', render: (t, i) => <Box key={i} marginTop={1}><Text bold color="cyan">{t}</Text></Box> },
  { prefix: 'Command:', render: (t, i) => <Box key={i} marginY={1} borderStyle="single" borderColor="yellow" paddingX={1}><Text bold color="yellow">{t}</Text></Box> },
  { prefix: '•', render: (t, i) => <Box key={i} paddingLeft={1}><Text color="white">{t}</Text></Box> },
];

function formatDetailLine(line: string, idx: number): ReactNode {
  const trimmed = line.trim();
  const handler = PREFIX_HANDLERS.find((h) => trimmed.startsWith(h.prefix));
  if (handler) {
    return handler.render(trimmed, idx);
  }
  return (
    <Text key={idx} wrap="wrap">
      {line.length > 0 ? line : ' '}
    </Text>
  );
}

const FallbackDetailsView: FC<{ details: string }> = ({ details }) => {
  const lines = details.split('\n');
  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.map((line, idx) => formatDetailLine(line, idx))}
    </Box>
  );
};

/** Formats structured consensus diagnosis object or raw fallback text details. */
export const ConsensusDiagnosisView: FC<ConsensusDiagnosisViewProps> = ({
  consensus,
  details,
}) => {
  if (consensus) {
    return <StructuredConsensusView consensus={consensus} />;
  }
  if (details) {
    return <FallbackDetailsView details={details} />;
  }
  return null;
};
