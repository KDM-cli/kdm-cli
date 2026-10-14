import React, { useState, useEffect, useCallback, useReducer } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { runAnalysis, explainSingleResult, resolveBackend } from '../analysis/analysis';
import { executeFix } from '../analysis/fix';
import type { AnalysisOptions, AnalysisOutput, SuggestedFix } from '../analysis/types';
import type { AnalyzerResult, Failure } from '../analyzers/types';
import type { AgentProgressEvent, ConsensusDiagnosis, NDJSONEvent } from '../agent/types';
import { InkSpinner } from './components/InkSpinner';
import { AgentCard } from './components/AgentCard';
import { ActiveToolPanel } from './components/ActiveToolPanel';
import { ConsensusDiagnosisView } from './components/ConsensusDiagnosisView';
import {
  type CouncilDashboardState,
  type AgentState,
  type ActiveToolState,
  createInitialCouncilState,
  councilEventReducer,
  getAgentIcon,
} from './council-state';

export { InkSpinner };

const AVAILABLE_BACKENDS = [
  'openai',
  'ollama',
  'anthropic',
  'google-gemini',
  'azure-openai',
  'cohere',
  'noop',
];

/** Status tracking for each specialist agent in the Multi-Agent Council. */
export interface CouncilAgentInfo {
  role: 'runtime' | 'config' | 'resource' | 'synthesizer';
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
}

export const DEFAULT_COUNCIL_AGENTS: CouncilAgentInfo[] = [
  { role: 'runtime', name: 'Runtime & Log Agent', status: 'pending' },
  { role: 'config', name: 'Config & Dependency Agent', status: 'pending' },
  { role: 'resource', name: 'Cluster & Resource Agent', status: 'pending' },
  { role: 'synthesizer', name: 'Lead SRE Synthesizer', status: 'pending' },
];

/** Matches agent progress event role or name to the corresponding council agent. */
export function matchCouncilRole(
  role?: string,
  name?: string
): 'runtime' | 'config' | 'resource' | 'synthesizer' | null {
  if (role === 'runtime' || role === 'config' || role === 'resource' || role === 'synthesizer') {
    return role;
  }
  const lower = (name || '').toLowerCase();
  if (lower.includes('runtime') || lower.includes('log')) return 'runtime';
  if (lower.includes('config') || lower.includes('depend')) return 'config';
  if (lower.includes('resource') || lower.includes('cluster')) return 'resource';
  if (lower.includes('synthes') || lower.includes('lead') || lower.includes('sre')) return 'synthesizer';
  return null;
}

const COUNCIL_AGENT_ORDER: CouncilAgentInfo['role'][] = [
  'runtime',
  'config',
  'resource',
  'synthesizer',
];

function getCouncilProgressStatus(
  status: AgentProgressEvent['status']
): CouncilAgentInfo['status'] {
  return status === 'completed' || status === 'failed' ? status : 'running';
}

function updateCouncilAgent(
  agent: CouncilAgentInfo,
  event: AgentProgressEvent,
  targetRole: CouncilAgentInfo['role'],
  targetIndex: number
): CouncilAgentInfo {
  if (agent.role === targetRole) {
    return { ...agent, status: getCouncilProgressStatus(event.status), message: event.message };
  }

  const agentIndex = COUNCIL_AGENT_ORDER.indexOf(agent.role);
  const shouldComplete = agentIndex < targetIndex && agent.status !== 'completed' && agent.status !== 'failed';
  return shouldComplete ? { ...agent, status: 'completed' } : agent;
}

/** Applies a council progress event while keeping completed and failed agents terminal. */
export function applyCouncilProgress(
  agents: CouncilAgentInfo[],
  event: AgentProgressEvent
): CouncilAgentInfo[] {
  const targetRole = matchCouncilRole(event.role, event.agentName);
  if (!targetRole) return agents;

  const targetIndex = COUNCIL_AGENT_ORDER.indexOf(targetRole);
  return agents.map((agent) => updateCouncilAgent(agent, event, targetRole, targetIndex));
}

/** Marks all non-failed council agents as complete after a successful explanation. */
export function completeCouncilAgents(agents: CouncilAgentInfo[]): CouncilAgentInfo[] {
  return agents.map((agent) =>
    agent.status === 'failed' ? agent : { ...agent, status: 'completed' }
  );
}

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
  onBack?: () => void;
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
      <Text dimColor>{'─'.repeat(70)}</Text>
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
          [✓] No Problems Detected
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

/**
 * Dedicated real-time Council progress panel showing the 4 specialist agents,
 * their individual status badges, and active diagnostic messages.
 */
export const AgentCouncilProgressView: React.FC<{
  agents: CouncilAgentInfo[] | Record<string, AgentState>;
  activeMessage?: string | null;
  activeTool?: ActiveToolState | null;
  isMultiAgent: boolean;
  backend: string;
}> = ({ agents, activeMessage, activeTool, isMultiAgent, backend }) => {
  if (!isMultiAgent) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="magenta"
        paddingX={1}
        marginY={1}
      >
        <Box marginBottom={1}>
          <Text bold color="magenta">AI Workload Diagnosis</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color="yellow"><InkSpinner /></Text>
          <Text color="yellow">Querying AI backend ({backend})...</Text>
        </Box>
        {activeMessage && (
          <Box marginTop={1}>
            <Text dimColor>{activeMessage}</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (Array.isArray(agents)) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="magenta"
        paddingX={1}
        marginY={1}
      >
        <Box justifyContent="space-between" marginBottom={1}>
          <Text bold color="magenta">Multi-Agent Council Triaging (Ollama)</Text>
          <Text color="yellow"><InkSpinner /> Active</Text>
        </Box>
        {agents.map((agent: CouncilAgentInfo) => {
          let badge = <Text dimColor>[ ] </Text>;
          let nameColor: string | undefined = undefined;
          let statusTag = <Text dimColor>[Pending]</Text>;

          if (agent.status === 'completed') {
            badge = <Text bold color="green">[✓] </Text>;
            nameColor = 'green';
            statusTag = <Text color="green">[Done]</Text>;
          } else if (agent.status === 'running') {
            badge = <Text bold color="yellow"><InkSpinner /> </Text>;
            nameColor = 'yellow';
            statusTag = <Text color="yellow">[Running]</Text>;
          } else if (agent.status === 'failed') {
            badge = <Text bold color="red">[x] </Text>;
            nameColor = 'red';
            statusTag = <Text color="red">[Failed]</Text>;
          }

          return (
            <Box key={agent.role} flexDirection="column" marginBottom={0}>
              <Box flexDirection="row" justifyContent="space-between">
                <Box flexDirection="row">
                  {badge}
                  <Text bold color={nameColor}>{agent.name}</Text>
                </Box>
                {statusTag}
              </Box>
              {agent.message && agent.status === 'running' && (
                <Box paddingLeft={4}>
                  <Text dimColor wrap="wrap">{agent.message}</Text>
                </Box>
              )}
            </Box>
          );
        })}
        {activeMessage && (
          <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
            <Text color="cyan">Active: </Text>
            <Text color="yellow" wrap="wrap">{activeMessage}</Text>
          </Box>
        )}
      </Box>
    );
  }

  const agentList = Object.values(agents) as AgentState[];
  const backendDisplay = backend === 'ollama' ? 'Ollama' : backend;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          KDM Multi-Agent SRE Investigation
        </Text>
        <Text color="yellow">
          <InkSpinner /> Active
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Multi-Agent Council Triaging ({backendDisplay})</Text>
      </Box>

      {agentList.map((agent) => (
        <AgentCard
          key={agent.role}
          role={agent.role}
          name={agent.name}
          icon={agent.icon}
          status={agent.status}
          message={agent.message}
        />
      ))}

      <ActiveToolPanel tool={activeTool} />

      {activeMessage && !activeTool && (
        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="cyan">Active: </Text>
          <Text color="yellow" wrap="wrap">{activeMessage}</Text>
        </Box>
      )}
    </Box>
  );
};

/** Formats consensus diagnosis or single LLM output with structured visual hierarchy. */
export const DiagnosisDetailsView: React.FC<{
  details?: string;
  consensus?: ConsensusDiagnosis | null;
}> = ({ details, consensus }) => {
  return <ConsensusDiagnosisView consensus={consensus} details={details} />;
};

/** Right pane rendering detailed information for the selected problem. */
const ProblemDetailsPane: React.FC<{
  item: ProblemItem | null;
  isExplaining: boolean;
  explainError: string | null;
  agentProgressMessage?: string | null;
  councilAgents: CouncilAgentInfo[];
  councilState: CouncilDashboardState;
  isLiveNDJSON: boolean;
  backend: string;
}> = ({
  item,
  isExplaining,
  explainError,
  agentProgressMessage,
  councilAgents,
  councilState,
  isLiveNDJSON,
  backend,
}) => {
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

  const consensusToDisplay = councilState.consensus || (item.result as any).consensus;

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
          <AgentCouncilProgressView
            agents={isLiveNDJSON ? councilState.agents : councilAgents}
            activeMessage={agentProgressMessage}
            activeTool={isLiveNDJSON ? councilState.activeTool : null}
            isMultiAgent={backend === 'ollama'}
            backend={backend}
          />
        )}
        {explainError && (
          <Box marginTop={1}>
            <Text color="red">Explanation failed: {explainError}</Text>
          </Box>
        )}
        {!isExplaining && !explainError && consensusToDisplay && (
          <ConsensusDiagnosisView consensus={consensusToDisplay} />
        )}
        {!isExplaining && !explainError && !consensusToDisplay && item.result.details && (
          <ConsensusDiagnosisView details={item.result.details} />
        )}
        {!isExplaining && !explainError && !item.result.details && !consensusToDisplay && (
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
    <Text dimColor>[Enter] Apply & Re-analyze   [Esc] Back</Text>
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
        <Text key={b} bold={isSelected} color={isSelected ? 'yellow' : undefined}>
          {isSelected ? '> ' : '  '}
          {b}
        </Text>
      );
    })}
    <Text dimColor>[↑/↓] Choose   [Enter] Select & Re-analyze   [Esc] Back</Text>
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
      Confirm Remediation
    </Text>
    <Text>
      Apply fix "{fix.title}" for {fix.kind ?? 'workload'}{' '}
      {fix.resourceName ?? fix.id}?
    </Text>
    <Text>
      Press <Text bold color="green">[y]</Text> to execute, or{' '}
      <Text bold color="red">[n / Esc]</Text> to go Back.
    </Text>
  </Box>
);

/** Manages an on-demand AI explanation and the Council progress associated with it. */
function useCouncilExplanation(
  selectedItem: ProblemItem | null,
  backend: string,
  options: AnalysisOptions,
  refreshResult: () => void
) {
  const [isExplaining, setIsExplaining] = useState(false);
  const [isLiveNDJSON, setIsLiveNDJSON] = useState(false);
  const [councilState, dispatchCouncilEvent] = useReducer(
    councilEventReducer,
    undefined,
    createInitialCouncilState
  );
  const [councilAgents, setCouncilAgents] = useState<CouncilAgentInfo[]>(DEFAULT_COUNCIL_AGENTS);
  const [agentProgressMessage, setAgentProgressMessage] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const clearExplainError = useCallback(() => setExplainError(null), []);

  const handleExplainCurrent = useCallback(async (targetItem?: ProblemItem | null) => {
    const itemToExplain = targetItem ?? selectedItem;
    if (!itemToExplain || isExplaining) return;

    setIsExplaining(true);
    setIsLiveNDJSON(false);
    setExplainError(null);
    setAgentProgressMessage(null);
    setCouncilAgents(DEFAULT_COUNCIL_AGENTS.map((agent) => ({ ...agent })));

    try {
      await explainSingleResult({
        result: itemToExplain.result,
        backend,
        language: options.language ?? 'english',
        shouldAnonymize: Boolean(options.anonymize),
        noCache: Boolean(options.noCache),
        customHeaders: options.customHeaders,
        onEvent: (event: NDJSONEvent) => {
          setIsLiveNDJSON(true);
          dispatchCouncilEvent(event);
        },
        onAgentProgress: (event) => {
          setAgentProgressMessage(event.message);
          setCouncilAgents((agents) => applyCouncilProgress(agents, event));
        },
      });
      setCouncilAgents(completeCouncilAgents);
      refreshResult();
    } catch (err) {
      setExplainError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExplaining(false);
      setAgentProgressMessage(null);
    }
  }, [selectedItem, isExplaining, backend, options, refreshResult]);

  return {
    isExplaining,
    isLiveNDJSON,
    councilState,
    councilAgents,
    agentProgressMessage,
    explainError,
    clearExplainError,
    handleExplainCurrent,
  };
}

/**
 * Main Interactive Analyze Dashboard Component.
 * Owns navigation, modals, explanation fetching, fix confirmation, and re-analysis triggers.
 */
export function AnalyzeDashboard({
  initialOptions,
  initialResult,
  onExit,
  onBack,
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

  const [actionMessage, setActionMessage] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const items = buildProblemItems(result);
  const selectedItem = items[selectedIndex] ?? null;
  const currentBackend = resolveBackend(options);
  const refreshExplainedResult = useCallback(() => {
    setResult((previousResult) => (previousResult ? { ...previousResult } : null));
  }, []);
  const {
    isExplaining,
    isLiveNDJSON,
    councilState,
    councilAgents,
    agentProgressMessage,
    explainError,
    clearExplainError,
    handleExplainCurrent,
  } = useCouncilExplanation(selectedItem, currentBackend, options, refreshExplainedResult);

  const triggerReanalysis = useCallback(async (opts: AnalysisOptions, preserveAction = false) => {
    setIsLoading(true);
    if (!preserveAction) {
      setActionMessage(null);
    }
    clearExplainError();
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
  }, [clearExplainError]);

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

  const autoExplainedRef = React.useRef(false);
  const firstProblemItem = items[0];
  const shouldAutoExplain = Boolean(
    options.explain &&
    result &&
    !isLoading &&
    !isExplaining &&
    !autoExplainedRef.current &&
    firstProblemItem &&
    !firstProblemItem.result.details
  );
  useEffect(() => {
    if (!shouldAutoExplain || !firstProblemItem) return;
    autoExplainedRef.current = true;
    void handleExplainCurrent(firstProblemItem);
  }, [shouldAutoExplain, firstProblemItem, handleExplainCurrent]);

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

    // Back or Exit dashboard controls
    if (key.escape) {
      if (onBack) {
        onBack();
      } else {
        onExit?.();
        exit();
      }
      return;
    }

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
          agentProgressMessage={agentProgressMessage}
          councilAgents={councilAgents}
          councilState={councilState}
          isLiveNDJSON={isLiveNDJSON}
          backend={currentBackend}
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
          [↑/↓] Navigate  [f] Fix  [e] Explain  [n] Namespace  [b] Backend  [r] Refresh  [Esc] Back  [q] Quit
        </Text>
      </Box>
    </Box>
  );
}
