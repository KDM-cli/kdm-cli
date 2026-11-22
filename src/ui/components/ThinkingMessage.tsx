import React, { useMemo, type FC } from 'react';
import { Box, Text } from 'ink';

export interface ThoughtSummary {
  subject?: string;
  description?: string;
}

export interface ThinkingMessageProps {
  thought?: string | ThoughtSummary;
  compact?: boolean;
  maxPreviewLength?: number;
  terminalWidth?: number;
  isFirstThinking?: boolean;
}

/**
 * Strips raw ANSI escape sequences from strings.
 */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '');
}

/**
 * Normalizes escaped newlines (e.g. literal '\n') into real newline characters.
 */
export function normalizeEscapedNewlines(text?: string): string {
  if (!text) return '';
  return text.replace(/\\n/g, '\n');
}

/**
 * Checks whether text is whitespace or repetitive progress dot noise (e.g. '...').
 */
export function isNoise(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed || /^[.\s…]+$/.test(trimmed);
}

/**
 * Compacts long text with an ellipsis and [+more] suffix.
 */
export function compactPreview(text: string, maxLen = 120): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '... [+more]';
}

/**
 * Normalizes thought input into sanitized, noise-filtered lines.
 */
function normalizeThoughtLines(
  thought?: string | ThoughtSummary,
  compact = false,
  maxPreviewLength?: number
): string[] {
  if (!thought) return [];

  let subject = '';
  let description = '';

  if (typeof thought === 'string') {
    const cleaned = stripAnsi(thought);
    const normalized = normalizeEscapedNewlines(cleaned);
    const limit = maxPreviewLength ?? (compact ? 120 : 1500);

    const processed = normalized.length > limit ? compactPreview(normalized, limit) : normalized;
    const parts = processed.split('\n');
    subject = parts[0] || '';
    description = parts.slice(1).join('\n');
  } else {
    subject = normalizeEscapedNewlines(stripAnsi(thought.subject || ''));
    description = normalizeEscapedNewlines(stripAnsi(thought.description || ''));
  }

  const lines: string[] = [];
  const trimmedSubj = subject.trim();
  if (trimmedSubj && !isNoise(trimmedSubj)) {
    lines.push(trimmedSubj);
  }

  if (description) {
    const descLines = description
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => !isNoise(l));
    const maxLines = compact ? 3 : 50;
    if (descLines.length > maxLines) {
      lines.push(...descLines.slice(0, maxLines), '... [+more]');
    } else {
      lines.push(...descLines);
    }
  }

  return lines;
}

/**
 * ThinkingMessage component:
 * Renders model or agent reasoning bubbles with 💭 icon, left vertical rule (│),
 * noise filtering, newline normalization, and compact preview options.
 */
export const ThinkingMessage: FC<ThinkingMessageProps> = ({
  thought,
  compact = false,
  maxPreviewLength,
  terminalWidth,
  isFirstThinking = false,
}) => {
  const fullLines = useMemo(
    () => normalizeThoughtLines(thought, compact, maxPreviewLength),
    [thought, compact, maxPreviewLength]
  );

  if (fullLines.length === 0) {
    return null;
  }

  const displayThought = fullLines.join(' ');

  if (compact) {
    return (
      <Box flexDirection="row" width={terminalWidth}>
        <Text color="magenta">💭 </Text>
        <Text dimColor italic wrap="wrap">
          {displayThought}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={terminalWidth}>
      {isFirstThinking ? (
        <Text italic color="cyan">
          💭 Thinking...
        </Text>
      ) : null}

      <Box
        marginLeft={1}
        paddingLeft={1}
        borderStyle="single"
        borderLeft={true}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor="gray"
        flexDirection="column"
      >
        <Box flexDirection="row">
          <Text color="magenta">💭 </Text>
          <Text bold italic color="white">
            {fullLines[0]}
          </Text>
        </Box>
        {fullLines.slice(1).map((line, index) => (
          <Text key={`thought-line-${index}`} dimColor italic wrap="wrap">
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
