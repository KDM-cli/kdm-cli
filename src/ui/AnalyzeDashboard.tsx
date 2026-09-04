import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { runAnalysis, explainSingleResult, resolveBackend } from '../analysis/analysis';
import { executeFix } from '../analysis/fix';
import type { AnalysisOptions, AnalysisOutput, SuggestedFix } from '../analysis/types';
import type { AnalyzerResult, Failure } from '../analyzers/types';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Lightweight animated spinner component compatible with ESM and Vitest. */
export const InkSpinner: React.FC = () => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);
  return <Text>{SPINNER_FRAMES[frame]}</Text>;
};

const AVAILABLE_BACKENDS = [
  'openai',
  'ollama',
  'anthropic',
  'google-gemini',
  'azure-openai',
  'cohere',
  'noop',
];

/** Representation of an individual selectable problem item in the dashboard. */
export interface ProblemItem {
  id: string;
  resultIndex: number;
  failureIndex: number;
  kind: string;
  name: string;
  namespace?: string;
  failure: Failure;
  result: AnalyzerResult;
  fix?: SuggestedFix;
}

/** Props for the AnalyzeDashboard component. */
export interface AnalyzeDashboardProps {
  initialOptions: AnalysisOptions;
  initialResult?: AnalysisOutput;
  onExit?: () => void;
}

/** Flatten analysis results into a flat list of selectable ProblemItems. */
export function buildProblemItems(output: AnalysisOutput | null): ProblemItem[] {
  if (!output?.results) return [];
  const fixes = output.suggestedFixes ?? [];

  return output.results.flatMap((result, rIdx) =>
    result.errors.map((failure, fIdx) => {
      const fixId = `${result.kind.toLowerCase()}-${rIdx}-${fIdx}`;
      const fix = fixes.find((f) => f.id === fixId);
      return {
        id: fixId,
        resultIndex: rIdx,
        failureIndex: fIdx,
        kind: result.kind,
        name: result.name,
        namespace: result.namespace,
        failure,
        result,
        fix,
      };
    })
  );
}

/** Header component displaying status, namespace, and active AI backend. */
const DashboardHeader: React.FC<{
  namespace?: string;
  backend: string;
  problemsCount: number;
  status?: string;
  isLoading: boolean;
}> = ({ namespace, backend, problemsCount, status, isLoading }) => {
  const isOk = status === 'OK' || problemsCount === 0;
  const statusColor = isOk ? 'green' : 'yellow';
  const statusLabel = isOk ? 'OK' : 'PROBLEMS DETECTED';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          KDM Analyze Dashboard
        </Text>
        {isLoading && (
          <Box>
            <Text color="cyan">
              <InkSpinner /> Analyzing...
            </Text>
          </Box>
        )}
      </Box>
      <Box flexDirection="row" gap={2}>
        <Text>
          Namespace: <Text bold color="cyan">{namespace || 'all'}</Text>
        </Text>
        <Text>
          Backend: <Text bold color="magenta">{backend}</Text>
        </Text>
        <Text>
          Status:{' '}
          <Text bold color={statusColor}>
            {statusLabel} ({problemsCount})
          </Text>
        </Text>
      </Box>
      <Text dimColor>─'.repeat(70)</Text>
    </Box>
  );
};

/** Left pane rendering list of detected workload problems or healthy state. */
const ProblemListPane: React.FC<{
  items: ProblemItem[];
  selectedIndex: number;
  namespace?: string;
}> = ({ items, selectedIndex, namespace }) => {
  if (items.length === 0) {
    return (
      <Box flexDirection="column" width="48%" paddingRight={1}>
        <Text bold color="green">
          ✔ No Problems Detected
        </Text>
        <Text dimColor>
          All workloads in namespace [{namespace || 'all'}] are healthy.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="48%" paddingRight={1}>
      <Text bold underline>
        Detected Issues ({items.length})
      </Text>
      {items.map((item, idx) => {
        const isSelected = idx === selectedIndex;
        const prefix = isSelected ? '> ' : '  ';
        const nsStr = item.namespace ? `[${item.namespace}] ` : '';
        return (
          <Box key={item.id}>
            <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
              {prefix}
              {item.kind} {nsStr}
              {item.name}: {item.failure.text.slice(0, 30)}
              {item.failure.text.length > 30 ? '...' : ''}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

/** Right pane rendering detailed information for the selected problem. */
const ProblemDetailsPane: React.FC<{
  item: ProblemItem | null;
  isExplaining: boolean;
  explainError: string | null;
}> = ({ item, isExplaining, explainError }) => {
  if (!item) {
    return (
      <Box flexDirection="column" width="52%" paddingLeft={1}>
        <Text bold underline>
          Details & Fix
        </Text>
        <Text dimColor>No issue selected.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="52%" paddingLeft={1}>
      <Text bold underline>
        Details & Fix
      </Text>
      <Text>
        Resource: <Text bold color="yellow">{item.kind}/{item.name}</Text>
      </Text>
      {item.namespace && (
        <Text>
          Namespace: <Text bold>{item.namespace}</Text>
        </Text>
      )}
      <Text color="red">Issue: {item.failure.text}</Text>
      {item.failure.kubernetesDoc && (
        <Text color="blue">Doc: {item.failure.kubernetesDoc}</Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="magenta">
          AI Explanation:
        </Text>
        {isExplaining && (
          <Text color="yellow">
            <InkSpinner /> Loading AI explanation...
          </Text>
        )}
        {explainError && (
          <Text color="red">Explanation failed: {explainError}</Text>
        )}
        {!isExplaining && !explainError && item.result.details && (
          <Text>{item.result.details}</Text>
        )}
        {!isExplaining && !explainError && !item.result.details && (
          <Text dimColor>Press [e] to generate explanation with active backend.</Text>
        )}
      </Box>

      {item.fix && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="green">
            Suggested Fix:
          </Text>
          <Text>{item.fix.title}</Text>
          <Text dimColor>Press [f] to execute remediation.</Text>
        </Box>
      )}
    </Box>
  );
};

/** Modal prompt for editing target namespace. */
const NamespaceModal: React.FC<{
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
}> = ({ value, onChange, onSubmit }) => (
  <Box
    borderStyle="round"
    borderColor="cyan"
    flexDirection="column"
    padding={1}
    marginTop={1}
  >
    <Text bold color="cyan">
      Change Namespace
    </Text>
    <Box flexDirection="row">
      <Text>Namespace (leave empty for all): </Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
    </Box>
    <Text dimColor>[Enter] Apply & Re-analyze   [Esc] Cancel</Text>
  </Box>
);

/** Modal prompt for switching the AI provider backend. */
const BackendModal: React.FC<{
  selectedIndex: number;
}> = ({ selectedIndex }) => (
  <Box
    borderStyle="round"
    borderColor="magenta"
    flexDirection="column"
    padding={1}
    marginTop={1}
  >
    <Text bold color="magenta">
      Select AI Backend Provider
    </Text>
    {AVAILABLE_BACKENDS.map((b, idx) => {
      const isSelected = idx === selectedIndex;
      return (
        <Text key={b} color={isSelected ? 'magenta' : undefined} bold={isSelected}>
          {isSelected ? '> ' : '  '}
          {b}
        </Text>
      );
    })}
    <Text dimColor>[↑/↓] Choose   [Enter] Select & Re-analyze   [Esc] Cancel</Text>
  </Box>
);

/** Confirmation dialog before executing a suggested remediation. */
const ConfirmDialog: React.FC<{
  fix: SuggestedFix;
}> = ({ fix }) => (
  <Box
    borderStyle="round"
    borderColor="yellow"
    flexDirection="column"
    padding={1}
    marginTop={1}
  >
    <Text bold color="yellow">
      ⚠️ Confirm Remediation
    </Text>
    <Text>
      Apply fix "{fix.title}" for {fix.kind ?? 'workload'}{' '}
      {fix.resourceName ?? fix.id}?
    </Text>
    <Text>
      Press <Text bold color="green">[y]</Text> to execute, or{' '}
      <Text bold color="red">[n / Esc]</Text> to cancel.
    </Text>
  </Box>
);

/**
 * Main Interactive Analyze Dashboard Component.
 * Owns navigation, modals, explanation fetching, fix confirmation, and re-analysis triggers.
 */
export function AnalyzeDashboard({
  initialOptions,
  initialResult,
  onExit,
}: AnalyzeDashboardProps) {
  const { exit } = useApp();
  const [options, setOptions] = useState<AnalysisOptions>(() => ({
    ...initialOptions,
    interactive: true,
  }));
  const [result, setResult] = useState<AnalysisOutput | null>(initialResult ?? null);
  const [isLoading, setIsLoading] = useState(!initialResult);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Status & modal states
  const [confirmingFix, setConfirmingFix] = useState<SuggestedFix | null>(null);
  const [modalMode, setModalMode] = useState<'none' | 'namespace' | 'backend'>('none');
  const [namespaceInput, setNamespaceInput] = useState(options.namespace || '');
  const [backendIndex, setBackendIndex] = useState(() => {
    const current = resolveBackend(options);
    const idx = AVAILABLE_BACKENDS.indexOf(current);
    return idx >= 0 ? idx : 0;
  });

  const [isExplaining, setIsExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const items = buildProblemItems(result);
  const selectedItem = items[selectedIndex] ?? null;
  const currentBackend = resolveBackend(options);

  const triggerReanalysis = useCallback(async (opts: AnalysisOptions, preserveAction = false) => {
    setIsLoading(true);
    if (!preserveAction) {
      setActionMessage(null);
    }
    setExplainError(null);
    try {
      const freshResult = await runAnalysis(opts);
      setResult(freshResult);
      setSelectedIndex(0);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setActionMessage({ text: `Analysis failed: ${errMsg}`, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialResult) {
      void triggerReanalysis(options);
    }
  }, [initialResult, options, triggerReanalysis]);

  const handleFixExecution = async (fix: SuggestedFix) => {
    setConfirmingFix(null);
    setActionMessage({ text: `Applying fix for ${fix.resourceName ?? fix.id}...`, type: 'info' });
    const outcome = await executeFix(fix);
    setActionMessage({
      text: outcome.message,
      type: outcome.success ? 'success' : 'error',
    });
    if (outcome.success) {
      void triggerReanalysis(options, true);
    }
  };

  const handleExplainCurrent = async () => {
    if (!selectedItem || isExplaining) return;
    setIsExplaining(true);
    setExplainError(null);
    try {
      await explainSingleResult({
        result: selectedItem.result,
        backend: currentBackend,
        language: options.language ?? 'english',
        shouldAnonymize: Boolean(options.anonymize),
        noCache: Boolean(options.noCache),
        customHeaders: options.customHeaders,
      });
      setResult((prev) => (prev ? { ...prev } : null));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setExplainError(errMsg);
    } finally {
      setIsExplaining(false);
    }
  };

  const backendIndexRef = React.useRef(backendIndex);
  backendIndexRef.current = backendIndex;

  useInput((input, key) => {
    if (modalMode === 'namespace') {
      if (key.escape) setModalMode('none');
      return;
    }

    if (modalMode === 'backend') {
      if (key.escape) {
        setModalMode('none');
      } else if (key.upArrow) {
        const next = Math.max(0, backendIndexRef.current - 1);
        backendIndexRef.current = next;
        setBackendIndex(next);
      } else if (key.downArrow) {
        const next = Math.min(AVAILABLE_BACKENDS.length - 1, backendIndexRef.current + 1);
        backendIndexRef.current = next;
        setBackendIndex(next);
      } else if (key.return) {
        const nextBackend = AVAILABLE_BACKENDS[backendIndexRef.current];
        const nextOpts = { ...options, backend: nextBackend };
        setOptions(nextOpts);
        setModalMode('none');
        void triggerReanalysis(nextOpts);
      }
      return;
    }

    if (confirmingFix) {
      if (input.toLowerCase() === 'y') {
        void handleFixExecution(confirmingFix);
      } else if (input.toLowerCase() === 'n' || key.escape) {
        setConfirmingFix(null);
      }
      return;
    }

    // Default dashboard controls
    if (input === 'q' || (key.ctrl && input === 'c')) {
      onExit?.();
      exit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(Math.max(items.length - 1, 0), i + 1));
    } else if (input === 'f' && selectedItem?.fix) {
      setConfirmingFix(selectedItem.fix);
    } else if (input === 'e') {
      void handleExplainCurrent();
    } else if (input === 'n') {
      setNamespaceInput('');
      setModalMode('namespace');
    } else if (input === 'b') {
      setModalMode('backend');
    } else if (input === 'r') {
      void triggerReanalysis(options);
    }
  });

  const onNamespaceSubmit = (val: string) => {
    const trimmed = val.trim();
    const nextNs = trimmed || undefined;
    const nextOpts = { ...options, namespace: nextNs };
    setOptions(nextOpts);
    setModalMode('none');
    void triggerReanalysis(nextOpts);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <DashboardHeader
        namespace={options.namespace}
        backend={currentBackend}
        problemsCount={items.length}
        status={result?.status}
        isLoading={isLoading}
      />

      <Box flexDirection="row">
        <ProblemListPane
          items={items}
          selectedIndex={selectedIndex}
          namespace={options.namespace}
        />
        <ProblemDetailsPane
          item={selectedItem}
          isExplaining={isExplaining}
          explainError={explainError}
        />
      </Box>

      {confirmingFix && <ConfirmDialog fix={confirmingFix} />}

      {modalMode === 'namespace' && (
        <NamespaceModal
          value={namespaceInput}
          onChange={setNamespaceInput}
          onSubmit={onNamespaceSubmit}
        />
      )}

      {modalMode === 'backend' && <BackendModal selectedIndex={backendIndex} />}

      {actionMessage && (
        <Box marginTop={1}>
          <Text
            color={
              actionMessage.type === 'success'
                ? 'green'
                : actionMessage.type === 'error'
                ? 'red'
                : 'cyan'
            }
          >
            {actionMessage.text}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          [↑/↓] Navigate  [f] Fix  [e] Explain  [n] Namespace  [b] Backend  [r] Refresh  [q] Quit
        </Text>
      </Box>
    </Box>
  );
}
