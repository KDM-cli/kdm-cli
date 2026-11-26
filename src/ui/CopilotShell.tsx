/**
 * CopilotShell — KDM SRE Copilot Shell
 * Interactive terminal workspace bringing gemini-cli UI components,
 * streaming sessions, subagent execution tree, and diff confirmations into KDM CLI.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { AppContainer } from './AppContainer.js';
import { Composer, DEFAULT_SLASH_COMMANDS } from './components/Composer.js';
import { ThinkingMessage } from './components/ThinkingMessage.js';
import { SubagentProgressDisplay } from './components/SubagentProgressDisplay.js';
import { DiffRenderer } from './components/DiffRenderer.js';
import { ToolConfirmationQueue } from './components/ToolConfirmationQueue.js';
import type { SubagentProgress } from './components/SubagentProgressDisplay.js';
import type { ConfirmationRequest, ConfirmationDecision } from './components/ToolConfirmationQueue.js';
import { defaultAgentRegistry } from '../agent/registry.js';
import { CodebaseInvestigatorAgent } from '../agent/investigator.js';
import { checkDockerConnection } from '../docker/client.js';
import { checkK8sConnection } from '../kubernetes/client.js';
import { checkMinikubeConnection } from '../minikube/client.js';
import { WatchDashboard } from './WatchDashboard.js';
import { createAIClient } from '../ai/factory.js';
import { getRunningContainers } from '../docker/containers.js';
import { getRunningPods } from '../kubernetes/pods.js';
import { runAnalysis, resolveBackend } from '../analysis/analysis.js';
import { registry } from '../analyzers/index.js';
import { formatTextOutput } from '../analysis/output.js';
import { getAIConfig } from '../config/store.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thought?: string;
  timestamp: Date;
}

export interface CopilotShellProps {
  onExit?: () => void;
  initialTab?: number;
  initialPrompt?: string;
  targetResource?: string;
}

export const CopilotShell: React.FC<CopilotShellProps> = ({
  onExit,
  initialTab = 1,
  initialPrompt,
  targetResource,
}) => {
  const [activeTab, setActiveTab] = useState<number>(initialTab);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [thinkingThought, setThinkingThought] = useState<string | undefined>(undefined);
  const [activeSubagents, setActiveSubagents] = useState<SubagentProgress[]>([]);
  const [pendingConfirmations, setPendingConfirmations] = useState<ConfirmationRequest[]>([]);
  const [activeDiff, setActiveDiff] = useState<{ original: string; modified: string; filename?: string } | null>(null);
  const [watching, setWatching] = useState(false);
  const busy = useRef(false);

  // Register CodebaseInvestigatorAgent if not present
  useEffect(() => {
    if (!defaultAgentRegistry.has(CodebaseInvestigatorAgent.NAME)) {
      defaultAgentRegistry.register(CodebaseInvestigatorAgent.toDefinition());
    }
  }, []);

  // Initialize greeting or initial prompt
  useEffect(() => {
    const greeting: ChatMessage = {
      id: 'msg-0',
      role: 'system',
      content: targetResource
        ? `🤖 SRE Copilot initiated for workload: ${targetResource}. Type a question, run slash commands, or press [Alt+2] to see agent tasks.`
        : '🤖 Welcome to KDM Copilot Shell. Type /help for available slash commands, or ask any Kubernetes/Docker troubleshooting question.',
      timestamp: new Date(),
    };
    setMessages([greeting]);

    if (initialPrompt) {
      handlePromptSubmit(initialPrompt);
    }
  }, [targetResource]);

  const handlePromptSubmit = useCallback(async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed) return;

    // Handle quick slash commands
    if (trimmed === '/quit' || trimmed === '/exit') {
      onExit?.();
      return;
    }

    if (trimmed === '/clear') {
      setMessages([]);
      return;
    }

    if (trimmed === '/help') {
      setMessages(prev => [
        ...prev,
        { id: `msg-${Date.now()}-u`, role: 'user', content: trimmed, timestamp: new Date() },
        {
          id: `msg-${Date.now()}-a`,
          role: 'assistant',
          content: DEFAULT_SLASH_COMMANDS.map(c => c.command + '  ' + c.description).join('\n'),
          timestamp: new Date(),
        },
      ]);
      return;
    }

    if (trimmed === '/watch') { setWatching(true); return; }
    if (trimmed === '/diff') { setActiveTab(3); return; }
    if (busy.current) return;
    busy.current = true;
    const [command, ...args] = trimmed.split(/\s+/);
    const backend = resolveBackend({});
    const label = command.startsWith('/') ? command.slice(1) : backend;
    const id = String(Date.now());
    const append = (role: ChatMessage['role'], content: string) =>
      setMessages(prev => [...prev, { id: id + role, role, content, timestamp: new Date() }]);

    append('user', trimmed);
    setIsThinking(true);
    setThinkingThought('Running ' + label);
    setActiveSubagents([{ agentName: label, state: 'running' }]);
    try {
      let reply: string;
      if (command === '/investigate') {
        const investigator = defaultAgentRegistry.get(CodebaseInvestigatorAgent.NAME);
        if (!investigator) throw new Error('Investigator unavailable');
        reply = JSON.stringify(await investigator.run({ query: args.join(' ') || 'Inspect local manifests' }), null, 2);
      } else if (command === '/analyze') {
        const target = args[0] || targetResource;
        const [kind, name] = target?.includes('/') ? target.split('/') : ['Pod', target];
        const filter = registry.list().find(a => a.name.toLowerCase() === kind.toLowerCase());
        if (target && !filter) throw new Error('Unknown workload kind: ' + kind);
        const output = await runAnalysis({
          multiAgent: true, explain: true, resourceName: name,
          filters: target && filter ? [filter.name] : undefined,
        });
        reply = formatTextOutput(output);
      } else if (command === '/pods') {
        const pods = await getRunningPods();
        reply = pods.filter(p => !args.length || (args[0] === '-n' && p.namespace === args[1]))
          .map(p => p.namespace + '/' + p.name + '  ' + p.status).join('\n') || 'No matching pods.';
      } else if (command === '/containers') {
        reply = (await getRunningContainers()).map(c => c.name + '  ' + c.status).join('\n') || 'No containers.';
      } else if (command === '/health') {
        const [docker, kube] = await Promise.all([checkDockerConnection(), checkK8sConnection()]);
        reply = 'Docker connected: ' + docker + '\nKubernetes connected: ' + kube;
      } else {
        const client = await createAIClient(backend);
        try {
          reply = await client.getCompletion(targetResource ? 'Workload: ' + targetResource + '\n' + trimmed : trimmed);
          if (!reply?.trim()) throw new Error('Provider returned an empty response');
        } finally { await client.close?.(); }
      }
      append('assistant', reply);
      setActiveSubagents([{ agentName: label, state: 'completed' }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      append('assistant', message);
      setActiveSubagents([{ agentName: label, state: 'error', result: message }]);
    } finally {
      busy.current = false;
      setIsThinking(false);
      setThinkingThought(undefined);
    }
  }, [onExit, targetResource]);

  const handleDecision = useCallback((decision: ConfirmationDecision, request: ConfirmationRequest) => {
    setPendingConfirmations(prev => prev.filter(r => r.id !== request.id));
    setMessages(prev => [
      ...prev,
      {
        id: `msg-${Date.now()}-decision`,
        role: 'system',
        content: `Decision for ${request.toolName}: ${decision}`,
        timestamp: new Date(),
      },
    ]);
  }, []);

  if (watching) return <WatchDashboard onBack={() => setWatching(false)} onExit={() => setWatching(false)} />;

  return (
    <AppContainer
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onExit={onExit}
      title="KDM Copilot Shell"
      version="v4.0.0"
    >
      {activeTab === 1 && (
        <Box flexDirection="column" flexGrow={1} padding={1}>
          {/* Conversation history */}
          <Box flexDirection="column" flexGrow={1} overflowY="hidden" marginBottom={1}>
            {messages.slice(-8).map(m => (
              <Box key={m.id} flexDirection="column" marginBottom={1}>
                <Text bold color={m.role === 'user' ? 'green' : m.role === 'system' ? 'yellow' : 'cyan'}>
                  {m.role === 'user' ? '❯ User:' : m.role === 'system' ? 'ℹ System:' : '🤖 Copilot:'}
                </Text>
                <Text>{m.content}</Text>
              </Box>
            ))}
            {isThinking && (
              <ThinkingMessage thought={thinkingThought} />
            )}
          </Box>

          {/* Interactive Composer */}
          <Composer
            onSubmit={handlePromptSubmit}
            placeholder="Ask Copilot, type /pods, /analyze, or /help..."
            disabled={isThinking}
          />
        </Box>
      )}

      {activeTab === 2 && (
        <Box flexDirection="column" flexGrow={1} padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">
              Specialist Agents & Delegation Hierarchy
            </Text>
          </Box>
          <SubagentProgressDisplay
            subagents={activeSubagents}
            initiallyExpanded
          />
        </Box>
      )}

      {activeTab === 3 && (
        <Box flexDirection="column" flexGrow={1} padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">
              Manifest Diff & Tool Safety Confirmation Gate
            </Text>
          </Box>
          {activeDiff && (
            <Box marginBottom={1} flexDirection="column">
              <DiffRenderer
                oldContent={activeDiff.original}
                newContent={activeDiff.modified}
                filename={activeDiff.filename}
              />
            </Box>
          )}
          {pendingConfirmations.length > 0 ? (
            <ToolConfirmationQueue
              requests={pendingConfirmations}
              onDecision={handleDecision}
            />
          ) : (
            <Text dimColor>No pending mutating operations waiting for approval.</Text>
          )}
        </Box>
      )}

      {activeTab === 4 && (
        <Box flexDirection="column" flexGrow={1} padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">
              Settings & AI Provider Configuration
            </Text>
          </Box>
          <Text>Chat provider: {resolveBackend({})}</Text>
          <Text>Analysis council: Ollama</Text>
          <Text>Subagents Registered: {defaultAgentRegistry.list().length}</Text>
          <Box marginTop={1}>
            <Text dimColor>
              Press [1] to return to Copilot, [q] to exit.
            </Text>
          </Box>
        </Box>
      )}
    </AppContainer>
  );
};
