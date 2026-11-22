import React, { useMemo, type FC } from 'react';
import { Box, Text } from 'ink';
import { createTwoFilesPatch } from 'diff';

export interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'header' | 'other';
  oldLine?: number;
  newLine?: number;
  content: string;
}

export interface DiffRendererProps {
  diff?: string;
  diffContent?: string;
  oldContent?: string;
  newContent?: string;
  filePath?: string;
  filename?: string;
  maxLines?: number;
  showLineNumbers?: boolean;
  terminalWidth?: number;
  availableTerminalHeight?: number;
  disableColor?: boolean;
  disableTruncation?: boolean;
}

/**
 * Parses unified diff strings and tracks old/new line numbers.
 */
export function parseDiffWithLineNumbers(diffText: string): DiffLine[] {
  const lines = diffText.split(/\r?\n/);
  const result: DiffLine[] = [];
  let currentOldLine = 0;
  let currentNewLine = 0;
  let inHunk = false;
  const hunkHeaderRegex = /^@@ -(\d+),?\d* \+(\d+),?\d* @@/;

  for (const line of lines) {
    const hunkMatch = line.match(hunkHeaderRegex);
    if (hunkMatch) {
      currentOldLine = parseInt(hunkMatch[1], 10) - 1;
      currentNewLine = parseInt(hunkMatch[2], 10) - 1;
      inHunk = true;
      result.push({ type: 'hunk', content: line });
      continue;
    }

    if (!inHunk) {
      result.push({ type: 'header', content: line });
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentNewLine++;
      result.push({
        type: 'add',
        newLine: currentNewLine,
        content: line,
      });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentOldLine++;
      result.push({
        type: 'del',
        oldLine: currentOldLine,
        content: line,
      });
    } else if (line.startsWith(' ')) {
      currentOldLine++;
      currentNewLine++;
      result.push({
        type: 'context',
        oldLine: currentOldLine,
        newLine: currentNewLine,
        content: line,
      });
    } else if (line.startsWith('\\')) {
      result.push({ type: 'other', content: line });
    } else {
      result.push({ type: 'other', content: line });
    }
  }

  return result;
}

/**
 * DiffRenderer component:
 * Unified color-coded diff viewer for Kubernetes manifests and Dockerfile changes.
 * Color codes additions (green), deletions (red), hunk headers (cyan), and file headers (yellow).
 * Handles line numbers, empty diffs, line truncation, and terminal width safety.
 */
export const DiffRenderer: FC<DiffRendererProps> = ({
  diff,
  diffContent,
  oldContent,
  newContent,
  filePath,
  filename,
  maxLines = 50,
  showLineNumbers = false,
  terminalWidth,
  disableColor = false,
  disableTruncation = false,
}) => {
  const fileLabel = filePath || filename;

  // Resolve diff string
  const rawDiff = useMemo(() => {
    if (diff !== undefined) return diff;
    if (diffContent !== undefined) return diffContent;
    if (oldContent !== undefined && newContent !== undefined) {
      if (oldContent === newContent) return '';
      const name = fileLabel || 'manifest.yaml';
      return createTwoFilesPatch(name, `${name}.patched`, oldContent, newContent);
    }
    return '';
  }, [diff, diffContent, oldContent, newContent, fileLabel]);

  const safeTerminalWidth = terminalWidth ? Math.max(0, Math.floor(terminalWidth)) : undefined;

  const normalizedDiff = rawDiff.replace(/\\n/g, '\n').trim();

  if (!normalizedDiff) {
    return (
      <Box padding={1} width={safeTerminalWidth}>
        <Text dimColor>No configuration differences detected.</Text>
      </Box>
    );
  }

  const rawLines = normalizedDiff.split('\n');
  const totalLineCount = rawLines.length;
  const effectiveMaxLines = disableTruncation ? totalLineCount : maxLines;
  const displayLines = rawLines.slice(0, effectiveMaxLines);
  const remainingCount = totalLineCount - displayLines.length;

  const parsedLines = useMemo(() => {
    return showLineNumbers ? parseDiffWithLineNumbers(normalizedDiff) : [];
  }, [showLineNumbers, normalizedDiff]);

  const maxLineNum = useMemo(() => {
    if (!showLineNumbers) return 0;
    return parsedLines.reduce((max, item) => {
      const lineNum = Math.max(item.oldLine || 0, item.newLine || 0);
      return Math.max(max, lineNum);
    }, 0);
  }, [showLineNumbers, parsedLines]);

  const gutterWidth = maxLineNum > 0 ? maxLineNum.toString().length + 1 : 3;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      padding={1}
      width={safeTerminalWidth}
    >
      {/* Header */}
      <Box flexDirection="row" justifyContent="space-between" marginBottom={0}>
        <Text bold color="cyan">
          ── Manifest Unified Diff ───────────────────
        </Text>
        {fileLabel ? <Text dimColor>File: {fileLabel}</Text> : null}
      </Box>

      {/* Diff Lines */}
      {displayLines.map((line, idx) => {
        let color: string | undefined = undefined;

        if (!disableColor) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            color = 'green';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            color = 'red';
          } else if (line.startsWith('@@')) {
            color = 'cyan';
          } else if (line.startsWith('---') || line.startsWith('+++')) {
            color = 'yellow';
          }
        }

        if (showLineNumbers && idx < parsedLines.length) {
          const parsed = parsedLines[idx];
          const lineNum = parsed?.newLine || parsed?.oldLine || '';
          const gutter = lineNum ? String(lineNum).padStart(gutterWidth) : ' '.repeat(gutterWidth);

          return (
            <Box key={`diff-line-${idx}`} flexDirection="row">
              <Text dimColor>{gutter} </Text>
              <Text color={color}>{line}</Text>
            </Box>
          );
        }

        return (
          <Text key={`diff-line-${idx}`} color={color}>
            {line}
          </Text>
        );
      })}

      {/* Truncation notice */}
      {remainingCount > 0 ? (
        <Text dimColor italic>
          ... and {remainingCount} more lines
        </Text>
      ) : null}
    </Box>
  );
};
