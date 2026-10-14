import React from 'react';
import { Box, Text } from 'ink';
import type { ConsensusDiagnosis } from '../../agent/types';

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

/** Formats structured consensus diagnosis object or raw fallback text details. */
export const ConsensusDiagnosisView: React.FC<ConsensusDiagnosisViewProps> = ({
  consensus,
  details,
}) => {
  if (consensus) {
    const confColor = getConfidenceColor(consensus.confidence);
    const riskColor = getRiskColor(consensus.bestSolution.riskLevel);

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" gap={1} marginBottom={0}>
          <Text bold color="yellow">Root Cause:</Text>
          <Text bold color={confColor}>
            [{consensus.confidence.toUpperCase()} CONFIDENCE]
          </Text>
        </Box>
        <Box paddingLeft={2} marginBottom={1}>
          <Text bold color="white">{consensus.rootCause}</Text>
        </Box>

        {consensus.findings && consensus.findings.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="cyan">Specialist Agent Findings:</Text>
            {consensus.findings.map((f, i) => (
              <Box key={i} paddingLeft={2}>
                <Text color="green">✔ </Text>
                {f.icon ? <Text>{f.icon} </Text> : null}
                <Text bold>{f.agentName || f.role}: </Text>
                <Text color="white">{f.summary || f.statusText}</Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold color="green">Recommended Remediation:</Text>
            <Text bold color={riskColor}>
              [{consensus.bestSolution.riskLevel.toUpperCase()} RISK]
            </Text>
          </Box>
          <Box paddingLeft={2}>
            <Text bold color="white">{consensus.bestSolution.actionTitle}</Text>
          </Box>
          {consensus.bestSolution.steps && consensus.bestSolution.steps.length > 0 && (
            <Box flexDirection="column" paddingLeft={2} marginTop={1}>
              {consensus.bestSolution.steps.map((step, idx) => (
                <Text key={idx} color="white">
                  • {step}
                </Text>
              ))}
            </Box>
          )}
          {consensus.bestSolution.commandToRun && (
            <Box
              marginY={1}
              borderStyle="single"
              borderColor="yellow"
              paddingX={1}
            >
              <Text bold color="yellow">
                Command: {consensus.bestSolution.commandToRun}
              </Text>
            </Box>
          )}
        </Box>

        {consensus.evidenceCitations && consensus.evidenceCitations.length > 0 && (
          <Box marginTop={1} paddingLeft={2}>
            <Text dimColor>Evidence Citations: {consensus.evidenceCitations.join(', ')}</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (details) {
    const lines = details.split('\n');
    return (
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, idx) => {
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
        })}
      </Box>
    );
  }

  return null;
};
