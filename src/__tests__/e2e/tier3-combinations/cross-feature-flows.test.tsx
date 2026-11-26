import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { z } from 'zod';
import {
  renderTUI,
  MockGenAIStreamBuilder,
  MockPythonCouncil,
  MockClusterEnvironment,
  AgentRegistry,
  AgentTool,
  DeclarativeToolRegistry,
  CodebaseInvestigatorAgent,
  DiffRenderer,
  ThinkingMessage,
  translateNDJSONToSubagentProgress,
  k8sGetPodTool,
  k8sListPodsTool,
  dockerInspectContainerTool,
  runCLI,
  ToolConfirmationQueueView,
  ComposerView,
  DashboardWithTroubleshootTrigger,
  parseSlashCommand,
  type ConfirmationRequest,
  type ConfirmationDecision,
} from '../harness';
import { executeRemediationCommand } from '../../../remediation/executor';

describe('Tier 3: Cross-Feature Interactions & Pairwise Integration Flows', () => {
  let activeCluster: MockClusterEnvironment | null = null;

  afterEach(() => {
    if (activeCluster) {
      activeCluster.reset();
      activeCluster = null;
    }
    MockClusterEnvironment.resetActive();
    vi.restoreAllMocks();
  });

  it('TC-E2E-T3-PAIR-01: Composer Slash Command -> Declarative Tool Execution (F-08 + F-03)', async () => {
    let submittedCommand = '';
    const { sendKey, stdin, wait, unmount, getLastFrame } = renderTUI(
      <ComposerView onSubmit={(cmd) => { submittedCommand = cmd; }} />
    );

    sendKey('/pods -n staging');
    await wait(20);
    expect(getLastFrame()).toContain('/pods -n staging');

    stdin.sendEnter();
    await wait(50);
    unmount();

    expect(submittedCommand).toBe('/pods -n staging');

    const parsed = parseSlashCommand(submittedCommand);
    expect(parsed.command).toBe('/pods');
    expect(parsed.options.namespace).toBe('staging');

    const registry = new DeclarativeToolRegistry();
    registry.register(k8sListPodsTool);

    const result = await registry.invoke('k8s_list_pods', { namespace: parsed.options.namespace });
    expect(result.namespace).toBe('staging');
    expect(result.pods).toHaveLength(2);
  });

  it('TC-E2E-T3-PAIR-02: Copilot Orchestrator Delegation -> EventTranslator -> Subagent Progress UI (F-04 + F-06)', async () => {
    const toolCallEv = {
      event: 'agent_tool_call' as const,
      role: 'runtime',
      tool: 'k8s_get_logs',
      args: { pod: 'payment-service', tail: 50 },
      timestamp: new Date().toISOString(),
    };

    const progress = translateNDJSONToSubagentProgress(toolCallEv);
    expect(progress).not.toBeNull();
    expect(progress?.agentName).toBe('runtime');

    const { getCleanOutput, unmount } = renderTUI(
      <ThinkingMessage thought={`Executing tool: ${progress?.toolCall?.name}`} />
    );

    const output = getCleanOutput();
    expect(output).toContain('Executing tool: k8s_get_logs');
    unmount();
  });

  it('TC-E2E-T3-PAIR-03: Codebase Investigator -> Manifest Diff Generation -> DiffRenderer (F-05 + F-07)', async () => {
    const mockFiles = {
      'charts/payment/values.yaml': 'limits:\n    memory: 512Mi\nJAVA_OPTS: "-Xmx768m"\n',
    };

    const report = await CodebaseInvestigatorAgent.run({
      workspaceFiles: mockFiles,
      liveClusterState: { memoryLimit: '512Mi' },
    });

    expect(report.findings[0].patch).toBeDefined();

    const { getCleanOutput, unmount } = renderTUI(
      <DiffRenderer diff={report.findings[0].patch!} />
    );

    const output = getCleanOutput();
    expect(output).toContain('Manifest Unified Diff');
    expect(output).toContain('memory: 512Mi');
    expect(output).toContain('memory: 1024Mi');
    unmount();
  });

  it('TC-E2E-T3-PAIR-04: ToolConfirmationQueue -> RemediationExecutor -> Post-Fix Verification (F-07 + F-03)', async () => {
    const confirmationRequest: ConfirmationRequest = {
      id: 'remed-001',
      toolName: 'k8s_apply_patch',
      args: { command: 'echo "patch applied successfully"' },
      riskLevel: 'medium',
      prompt: 'Apply patch to memory limits?',
    };

    let decision: ConfirmationDecision | null = null;
    const { sendKey, wait, unmount, getLastFrame } = renderTUI(
      <ToolConfirmationQueueView
        request={confirmationRequest}
        onDecision={(d) => {
          decision = d;
        }}
      />
    );

    expect(getLastFrame()).toContain('MEDIUM RISK ACTION REQUIRED');
    expect(getLastFrame()).toContain('Apply patch to memory limits?');

    sendKey('y');
    await wait(50);
    unmount();

    expect(decision).toBe('ALLOW');

    let execResult;
    if (decision === 'ALLOW') {
      execResult = await executeRemediationCommand('echo "patch applied successfully"', {
        timeoutMs: 5000,
      });
    }
    expect(execResult).toBeDefined();
    expect(execResult?.success).toBe(true);
    expect(execResult?.stdout).toContain('patch applied successfully');

    const postFixCheck = await k8sGetPodTool.execute({
      name: 'payment-service-8f4b-2x9p',
      namespace: 'production',
    });
    expect(postFixCheck.pod).toBe('payment-service-8f4b-2x9p');
  });

  it('TC-E2E-T3-PAIR-05: In-Dashboard "t" Trigger -> Subagent Orchestration -> Live Stream Display (F-10 + F-06)', async () => {
    const targetPod = 'payment-service-8f4b-2x9p';
    let triggeredResource = '';

    const { sendKey, wait, unmount, getLastFrame } = renderTUI(
      <DashboardWithTroubleshootTrigger
        dashboardType="watch"
        targetResource={targetPod}
        onTrigger={(res) => {
          triggeredResource = res;
        }}
      />
    );

    sendKey('t');
    await wait(50);
    expect(getLastFrame()).toContain(`AI Troubleshooting Session: ${targetPod}`);
    expect(triggeredResource).toBe(targetPod);
    unmount();

    const events = MockPythonCouncil.createOOMKilledCouncilEvents(targetPod, 'production');
    const proc = MockPythonCouncil.createMockProcess(events);

    const progressItems: any[] = [];
    await new Promise<void>((resolve, reject) => {
      proc.on('error', reject);
      proc.stdout.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().trim().split('\n');
        for (const line of lines) {
          if (!line) continue;
          const parsed = JSON.parse(line);
          const prog = translateNDJSONToSubagentProgress(parsed);
          if (prog) progressItems.push(prog);
        }
      });
      proc.on('close', () => resolve());
    });

    expect(progressItems.length).toBeGreaterThan(0);
    const completedProgress = progressItems.find((p) => p.state === 'completed');
    expect(completedProgress).toBeDefined();
  });

  it('TC-E2E-T3-PAIR-06: Modern Gemini Client -> Declarative Tools via Function Calling (F-02 + F-03)', async () => {
    const builder = new MockGenAIStreamBuilder();
    builder.addFunctionCall('docker_inspect_container', { containerId: 'postgres-local' });

    const mockClient = builder.createMockClient();
    const response = await mockClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Inspect postgres-local',
    });

    const callPart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
    expect(callPart).toBeDefined();

    const registry = new DeclarativeToolRegistry();
    registry.register(dockerInspectContainerTool);

    const toolResult = await registry.invoke(
      callPart!.functionCall!.name,
      callPart!.functionCall!.args
    );

    expect(toolResult.containerId).toBe('postgres-local');
    expect(toolResult.state).toBe('restarting');
  });

  it('TC-E2E-T3-PAIR-07: Composer Autocomplete -> Slash Command /analyze with Target Flag (F-08 + F-10)', async () => {
    let submittedCommand = '';
    const { sendKey, stdin, wait, unmount, getLastFrame } = renderTUI(
      <ComposerView onSubmit={(cmd) => { submittedCommand = cmd; }} />
    );

    sendKey('/an');
    await wait(20);
    expect(getLastFrame()).toContain('Available Slash Commands:');
    expect(getLastFrame()).toContain('/analyze');

    sendKey('alyze --target pod/payment-service -n production');
    await wait(20);
    expect(getLastFrame()).toContain('/analyze --target pod/payment-service -n production');

    stdin.sendEnter();
    await wait(50);
    unmount();

    expect(submittedCommand).toBe('/analyze --target pod/payment-service -n production');

    const parsed = parseSlashCommand(submittedCommand);
    expect(parsed.command).toBe('/analyze');
    expect(parsed.options.target).toBe('pod/payment-service');
    expect(parsed.options.namespace).toBe('production');

    const triageContext = {
      targetResource: parsed.options.target,
      namespace: parsed.options.namespace,
      initiatedFrom: 'composer_slash_command',
    };
    expect(triageContext.targetResource).toBe('pod/payment-service');
    expect(triageContext.namespace).toBe('production');
  });

  it('TC-E2E-T3-PAIR-08: Codebase Investigator -> Multi-Agent Council Synthesis (F-05 + F-04)', async () => {
    const registry = new AgentRegistry();

    registry.register({
      name: 'CodebaseInvestigatorAgent',
      description: 'Local repo manifest investigator',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ findings: z.array(z.string()) }),
      run: async () => ({ findings: ['Discovered JAVA_OPTS -Xmx768m exceeding 512Mi'] }),
    });

    registry.register({
      name: 'SynthesizerAgent',
      description: 'Consensus root cause synthesizer',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ consensus: z.string() }),
      run: async () => ({ consensus: 'Misaligned JVM memory configuration vs cgroup quota' }),
    });

    const agentTool = new AgentTool(registry);
    const codebaseRes = await agentTool.execute({
      agent_name: 'CodebaseInvestigatorAgent',
      prompt: 'Check Helm charts',
    });
    expect(codebaseRes.findings[0]).toContain('-Xmx768m');

    const synthRes = await agentTool.execute({
      agent_name: 'SynthesizerAgent',
      prompt: 'Synthesize findings',
    });
    expect(synthRes.consensus).toContain('Misaligned JVM memory');
  });

  it('TC-E2E-T3-PAIR-09: ToolConfirmationQueue Denial -> Synthesizer Alternative Suggestion (F-07 + F-02)', async () => {
    const destructiveRequest: ConfirmationRequest = {
      id: 'remed-002',
      toolName: 'docker_remove_container',
      args: { command: 'docker rm -f postgres-local' },
      riskLevel: 'high',
      prompt: 'Permanently remove container postgres-local?',
    };

    let decision: ConfirmationDecision | null = null;
    const { sendKey, wait, unmount, getLastFrame } = renderTUI(
      <ToolConfirmationQueueView
        request={destructiveRequest}
        onDecision={(d) => {
          decision = d;
        }}
      />
    );

    expect(getLastFrame()).toContain('HIGH RISK ACTION REQUIRED');
    expect(getLastFrame()).toContain('Permanently remove container');

    sendKey('n');
    await wait(50);
    unmount();

    expect(decision).toBe('DENY');

    let mutationExecuted = false;
    if (decision === 'ALLOW') {
      await executeRemediationCommand('docker rm -f postgres-local');
      mutationExecuted = true;
    }
    expect(mutationExecuted).toBe(false);

    const builder = new MockGenAIStreamBuilder();
    builder.addText(
      'Remediation was denied by user. Alternative safe recommendation: inspect volume logs or run non-destructive lock file cleanup.'
    );

    const mockClient = builder.createMockClient();
    const response = await mockClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Operator ${decision}ed container removal. Propose non-destructive alternative.`,
    });

    expect(response.text).toContain('Remediation was denied by user');
    expect(response.text).toContain('Alternative safe recommendation');
  });

  it('TC-E2E-T3-PAIR-10: Non-Interactive CLI Mode -> Declarative Tools -> Structured JSON Output (F-03 + F-09)', async () => {
    activeCluster = new MockClusterEnvironment().setHealthyScenario().install();

    const result = await runCLI(['analyze', '-o', 'json'], { isTTY: false });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('\u001b');

    expect(result.stdout.trim().startsWith('{')).toBe(true);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toBeDefined();
    expect(['OK', 'ProblemDetected']).toContain(parsed.status);
  });
});
