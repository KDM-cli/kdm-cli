import React, { useState, useRef, useEffect, type FC } from 'react';
import { Box, Text, useInput } from 'ink';

export interface SlashCommandDefinition {
  command: string;
  description: string;
  usage?: string;
}

export const DEFAULT_SLASH_COMMANDS: SlashCommandDefinition[] = [
  { command: '/pods', description: 'Inspect Kubernetes pods in namespace', usage: '/pods [-n <namespace>]' },
  { command: '/containers', description: 'Inspect Docker containers', usage: '/containers [--all]' },
  { command: '/watch', description: 'Launch live cluster monitoring dashboard', usage: '/watch' },
  { command: '/analyze', description: 'Run multi-agent automated root cause analysis', usage: '/analyze [pod-name]' },
  { command: '/investigate', description: 'Inspect local workspace manifests' },
  { command: '/diff', description: 'View pending remediation changes' },
  { command: '/health', description: 'Check Docker and Kubernetes connectivity', usage: '/health' },
  { command: '/help', description: 'Display available slash commands', usage: '/help' },
  { command: '/clear', description: 'Clear terminal screen', usage: '/clear' },
  { command: '/quit', description: 'Exit shell', usage: '/quit' },
];

/**
 * Parses slash command string into command name and arguments.
 */
export function parseSlashCommand(input: string): {
  isSlash: boolean;
  command: string;
  args: string[];
  raw: string;
} | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.split(/\s+/);
  return {
    isSlash: true,
    command: parts[0],
    args: parts.slice(1),
    raw: trimmed,
  };
}

/**
 * Validates whether a command is a registered slash command.
 */
export function executeSlashCommand(
  cmd: string,
  allowedCommands?: string[]
): { success: boolean; error?: string } {
  const valid = allowedCommands ?? DEFAULT_SLASH_COMMANDS.map((c) => c.command);
  if (!valid.includes(cmd)) {
    return {
      success: false,
      error: `Unknown command '${cmd}'. Type /help for available commands.`,
    };
  }
  return { success: true };
}

export interface ComposerProps {
  onSubmit: (prompt: string) => void;
  onSlashCommand?: (command: string, args: string[]) => void;
  history?: string[];
  placeholder?: string;
  disabled?: boolean;
  isFocused?: boolean;
  initialValue?: string;
  commands?: SlashCommandDefinition[];
  slashCommands?: Array<SlashCommandDefinition | { name: string; description: string; usage?: string }>;
  maxBufferLength?: number;
  terminalWidth?: number;
}

/**
 * Composer component:
 * Interactive multiline command prompt with history traversal (Up/Down),
 * slash command autocompletion on '/' (/pods, /containers, /watch, /analyze, /health, /help, /clear, /quit),
 * Tab completion, Escape dismissal, debounce lock, and newline insertion (Shift+Enter / Alt+Enter).
 */
export const Composer: FC<ComposerProps> = ({
  onSubmit,
  onSlashCommand,
  history = [],
  placeholder = 'Type a prompt or / command...',
  disabled = false,
  isFocused = true,
  initialValue = '',
  commands,
  slashCommands: propSlashCommands,
  maxBufferLength = 10000,
  terminalWidth,
}) => {
  const [buffer, setBuffer] = useState(initialValue);
  const [draftBuffer, setDraftBuffer] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSubmittingRef = useRef(false);

  // Normalize commands list
  const allCommands: SlashCommandDefinition[] = (commands ??
    (propSlashCommands
      ? propSlashCommands.map((c) => ('command' in c ? c : { command: c.name, description: c.description, usage: c.usage }))
      : DEFAULT_SLASH_COMMANDS)) as SlashCommandDefinition[];

  const registeredCommandNames = allCommands.map((c) => c.command);

  // Filter commands by active buffer prefix
  const filteredCommands = buffer.startsWith('/') && !buffer.includes(' ')
    ? allCommands.filter((c) => c.command.startsWith(buffer.trim()))
    : [];

  useEffect(() => {
    if (filteredCommands.length === 0) {
      setAutocompleteIndex(0);
    } else if (autocompleteIndex >= filteredCommands.length) {
      setAutocompleteIndex(0);
    }
  }, [filteredCommands.length, autocompleteIndex]);

  useInput((input, key) => {
    if (disabled || !isFocused) return;

    // 1. Shift+Enter / Alt+Enter multiline insertion OR explicit newline character
    if ((key.return && (key.shift || key.meta)) || (input === '\n' && !key.return)) {
      setBuffer((prev) => {
        if (prev.length >= maxBufferLength) return prev;
        return prev + '\n';
      });
      return;
    }

    // 2. Pure Enter (Submit or Complete Autocomplete)
    if (key.return) {
      if (showAutocomplete && filteredCommands.length > 0 && autocompleteIndex >= 0) {
        const selected = filteredCommands[autocompleteIndex]?.command || filteredCommands[0]?.command;
        if (selected) {
          setBuffer(selected + ' ');
          setShowAutocomplete(false);
          return;
        }
      }

      // Debounce rapid double Enter
      if (isSubmittingRef.current) return;

      const trimmed = buffer.trim();
      if (!trimmed) return; // Ignore whitespace-only

      // Slash command evaluation
      if (trimmed.startsWith('/')) {
        const parsed = parseSlashCommand(trimmed);
        if (parsed) {
          const validation = executeSlashCommand(parsed.command, registeredCommandNames);
          if (!validation.success) {
            setErrorMessage(validation.error || 'Unknown command');
            return;
          }
          onSlashCommand?.(parsed.command, parsed.args);
        }
      }

      isSubmittingRef.current = true;
      onSubmit(trimmed);
      setBuffer('');
      setDraftBuffer('');
      setHistoryIndex(-1);
      setShowAutocomplete(false);
      setErrorMessage(null);

      setTimeout(() => {
        isSubmittingRef.current = false;
      }, 50);
      return;
    }

    // 3. Tab: Complete active slash command
    if (key.tab) {
      if (showAutocomplete && filteredCommands.length > 0) {
        const selected = filteredCommands[autocompleteIndex]?.command || filteredCommands[0]?.command;
        if (selected) {
          setBuffer(selected + ' ');
          setShowAutocomplete(false);
          return;
        }
      }
      return;
    }

    // 4. Escape: Dismiss autocomplete and clear errors, preserve buffer
    if (key.escape) {
      if (showAutocomplete) {
        setShowAutocomplete(false);
        return;
      }
      setErrorMessage(null);
      return;
    }

    // 5. Up Arrow: Autocomplete navigation or history traversal
    if (key.upArrow) {
      if (showAutocomplete && filteredCommands.length > 0) {
        setAutocompleteIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
        return;
      }

      if (history.length > 0) {
        if (historyIndex === -1) {
          setDraftBuffer(buffer);
          const nextIdx = history.length - 1;
          setHistoryIndex(nextIdx);
          setBuffer(history[nextIdx]);
        } else if (historyIndex > 0) {
          const nextIdx = historyIndex - 1;
          setHistoryIndex(nextIdx);
          setBuffer(history[nextIdx]);
        }
      }
      return;
    }

    // 6. Down Arrow: Autocomplete navigation or history forward traversal
    if (key.downArrow) {
      if (showAutocomplete && filteredCommands.length > 0) {
        setAutocompleteIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
        return;
      }

      if (historyIndex !== -1) {
        const nextIdx = historyIndex + 1;
        if (nextIdx >= history.length) {
          setHistoryIndex(-1);
          setBuffer(draftBuffer);
        } else {
          setHistoryIndex(nextIdx);
          setBuffer(history[nextIdx]);
        }
      }
      return;
    }

    // 7. Backspace / Delete
    if (key.backspace || key.delete) {
      setBuffer((prev) => {
        const next = prev.slice(0, -1);
        if (!next.startsWith('/') || next.includes(' ')) {
          setShowAutocomplete(false);
        }
        return next;
      });
      setErrorMessage(null);
      return;
    }

    // 8. Printable character typing
    if (input && !key.ctrl && !key.meta) {
      setErrorMessage(null);
      setBuffer((prev) => {
        if (prev.length >= maxBufferLength) return prev;
        const next = (prev + input).slice(0, maxBufferLength);
        if (next.startsWith('/') && !next.includes(' ')) {
          setShowAutocomplete(true);
        } else {
          setShowAutocomplete(false);
        }
        return next;
      });
    }
  });

  const safeTerminalWidth = terminalWidth ? Math.max(0, Math.floor(terminalWidth)) : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isFocused ? 'cyan' : 'gray'}
      padding={1}
      width={safeTerminalWidth}
    >
      {/* Slash Autocomplete Suggestions Dropdown */}
      {showAutocomplete && filteredCommands.length > 0 ? (
        <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="blue" paddingX={1}>
          <Text dimColor>Available Commands:</Text>
          {filteredCommands.map((item, idx) => (
            <Box key={item.command} flexDirection="row" justifyContent="space-between">
              <Text color={idx === autocompleteIndex ? 'cyan' : 'yellow'} bold={idx === autocompleteIndex}>
                {idx === autocompleteIndex ? '▶ ' : '  '}
                {item.command}
              </Text>
              <Text dimColor> {item.description}</Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {/* Prompt Line */}
      <Box flexDirection="row">
        <Text bold color="green">
          ❯{' '}
        </Text>
        <Text>{buffer || <Text dimColor>{placeholder}</Text>}</Text>
      </Box>

      {/* Error Message */}
      {errorMessage ? (
        <Box marginTop={1}>
          <Text color="red">{errorMessage}</Text>
        </Box>
      ) : null}

      {/* Helper Footer */}
      <Box marginTop={1}>
        <Text dimColor>Enter: Send · Shift+Enter: Newline · Up/Down: History · /: Commands</Text>
      </Box>
    </Box>
  );
};
