import React from 'react';
import { Box, Text } from 'ink';
import type { ConsensusDiagnosis, AgentFinding, BestSolution } from '../../agent/types';

/**
 * Props for the ConsensusDiagnosisView component.
 */
export interface ConsensusDiagnosisViewProps {
  consensus?: ConsensusDiagnosis | null;
  details?: string | null;
}

function getConfidenceColor(confidence?: string): string {
  switch (confidence?.toLowerCase()) {
    case 'high':
      return 'green';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'red';
    default:
      return 'cyan';
  }
}

function getRiskColor(risk?: string): string {
  switch (risk?.toLowerCase()) {
    case 'low':
      return 'green';
    case 'medium':
      return 'yellow';
    case 'high':
      return 'red';
    default:
      return 'yellow';
  }
}

const FindingsSection: React.FC<{ findings?: AgentFinding[] }> = ({ findings }) => {
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

const RemediationSection: React.FC<{ solution: BestSolution }> = ({ solution }) => {
  const riskColor = getRiskColor(solution.riskLevel);
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

const StructuredConsensusView: React.FC<{ consensus: ConsensusDiagnosis }> = ({ consensus }) => {
  const confColor = getConfidenceColor(consensus.confidence);
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

function formatDetailLine(line: string, idx: number): React.ReactNode {
  const trimmed = line.trim();
  if (trimmed.startsWith('Root Cause')) {
    return (
      <Box key={idx} marginTop={1} marginBottom={0}>
        <Text bold color="yellow">{trimmed}</Text>
      </Box>
    );
  }
  if (trimmed.startsWith('Recommended Remediation:')) {
    return (
      <Box key={idx} marginTop={1} marginBottom={0}>
        <Text bold color="green">{trimmed}</Text>
      </Box>
    );
  }
  if (trimmed.startsWith('Specialist Agent Findings:')) {
    return (
      <Box key={idx} marginTop={1} marginBottom={0}>
        <Text bold color="cyan">{trimmed}</Text>
      </Box>
    );
  }
  if (trimmed.startsWith('Command:')) {
    return (
      <Box key={idx} marginY={1} borderStyle="single" borderColor="yellow" paddingX={1}>
        <Text bold color="yellow">{trimmed}</Text>
      </Box>
    );
  }
  if (trimmed.startsWith('•')) {
    return (
      <Box key={idx} paddingLeft={1}>
        <Text color="white">{trimmed}</Text>
      </Box>
    );
  }
  return (
    <Text key={idx} wrap="wrap">
      {line.length > 0 ? line : ' '}
    </Text>
  );
}

const FallbackDetailsView: React.FC<{ details: string }> = ({ details }) => {
  const lines = details.split('\n');
  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.map((line, idx) => formatDetailLine(line, idx))}
    </Box>
  );
};

/** Formats structured consensus diagnosis object or raw fallback text details. */
export const ConsensusDiagnosisView: React.FC<ConsensusDiagnosisViewProps> = ({
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
