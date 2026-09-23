import React, { useState, useMemo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { registry } from '../analyzers';
import { getActiveFilters, rawConfigStore, setActiveFilters } from '../config/store';
import { Checkbox } from './Checkbox';

export const DEFAULT_FILTERS = ['Pod', 'Deployment', 'Service', 'PersistentVolumeClaim', 'Node'];

export interface FiltersDashboardProps {
  availableAnalyzers?: string[];
  initialActiveFilters?: string[];
  onSave?: (filters: string[]) => void;
}

/**
 * Resolves the starting active filters based on store configuration or defaults.
 */
const resolveInitialActiveFilters = (provided?: string[]): string[] => {
  if (provided !== undefined) {
    return provided;
  }
  const configured = getActiveFilters();
  if (configured.length > 0) {
    return configured;
  }
  try {
    if (rawConfigStore.has('activeFilters')) {
      return configured;
    }
  } catch {
    // Falls back to defaults in test or non-Conf environments
  }
  return DEFAULT_FILTERS;
};

export const FiltersDashboard: React.FC<FiltersDashboardProps> = ({
  availableAnalyzers,
  initialActiveFilters,
  onSave = setActiveFilters,
}) => {
  const { exit } = useApp();

  const analyzers = useMemo(() => {
    return availableAnalyzers ?? registry.list().map((a) => a.name);
  }, [availableAnalyzers]);

  const [activeFilters, setActiveFiltersState] = useState<string[]>(() =>
    resolveInitialActiveFilters(initialActiveFilters),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((prev) => (analyzers.length > 0 ? Math.min(analyzers.length - 1, prev + 1) : 0));
      return;
    }

    if (input === ' ') {
      const current = analyzers[selectedIndex];
      if (!current) return;

      setActiveFiltersState((prev) => {
        const next = prev.includes(current)
          ? prev.filter((f) => f !== current)
          : [...prev, current];
        onSave?.(next);
        return next;
      });
      return;
    }

    if (input === 'q' || input === 'Q' || key.escape) {
      exit();
    }
  });

  const divider = '─'.repeat(54);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box flexDirection="row" justifyContent="space-between" width={54}>
        <Text bold color="cyan">
          Analyzer Filters
        </Text>
        <Text bold color="green">
          {`Active: ${activeFilters.length} / ${analyzers.length}`}
        </Text>
      </Box>

      <Text dimColor>{divider}</Text>

      <Box flexDirection="column">
        {analyzers.length === 0 ? (
          <Text dimColor>(no analyzers available)</Text>
        ) : (
          analyzers.map((name, index) => (
            <Checkbox
              key={name}
              label={name}
              checked={activeFilters.includes(name)}
              isSelected={index === selectedIndex}
            />
          ))
        )}
      </Box>

      <Text dimColor>{divider}</Text>

      <Box flexDirection="row">
        <Text color="cyan" bold>
          SPACE
        </Text>
        <Text dimColor>:Toggle </Text>
        <Text color="cyan" bold>
          ↑↓
        </Text>
        <Text dimColor>:Navigate </Text>
        <Text color="cyan" bold>
          Q
        </Text>
        <Text dimColor>:Quit </Text>
        <Text dimColor>(changes auto-saved)</Text>
      </Box>
    </Box>
  );
};
