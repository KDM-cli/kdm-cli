import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink';
import { Writable, Readable } from 'node:stream';
import { Console } from 'node:console';
import { AnalyzeDashboard } from '../ui/AnalyzeDashboard';
import { AgentCard } from '../ui/components/AgentCard';
import { ActiveToolPanel } from '../ui/components/ActiveToolPanel';
import { ConsensusDiagnosisView } from '../ui/components/ConsensusDiagnosisView';
import {
  councilEventReducer,
  createInitialCouncilState,
  formatToolArgs,
  formatToolInvocation,
  getAgentDisplayName,
  getAgentIcon,
} from '../ui/council-state';
import * as analysisModule from '../analysis/analysis';
import type { AnalysisOutput } from '../analysis/types';
import type { ConsensusDiagnosis, NDJSONEvent } from '../agent/types';

if (!(console as any).Console) {
  (console as any).Console = Console;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class MockStdout extends Writable {
  frames: string[] = [];
  isTTY = true;
  columns = 120;
  rows = 40;
  _write(chunk: any, encoding: any, callback: (error?: Error | null) => void) {
    this.frames.push(chunk.toString());
    callback();
  }
}

class MockStdin extends Readable {
  _read() {}
  isTTY = true;
  setRawMode = vi.fn();
  setEncoding = vi.fn();
  ref = vi.fn();
  unref = vi.fn();
  write(data: any) {
    this.push(Buffer.from(data));
  }
  sendChar(char: string) {
    this.write(char);
  }
}

const waitForFrame = async (mockStdout: MockStdout, substring: string, timeout = 2500) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const output = mockStdout.frames.join('\n');
    if (output.includes(substring)) {
      return;
    }
    await sleep(20);
  }
  const lastOutput = mockStdout.frames.join('\n');
  throw new Error(`Timed out waiting for "${substring}" in stdout frames. Output was:\n${lastOutput}`);
};

describe('Phase 13: Live NDJSON Streaming UI Components', () => {
  let mockStdout: MockStdout;
  let mockStdin: MockStdin;

  const mockProblemResult: AnalysisOutput = {
    status: 'ProblemDetected',
    problems: 1,
    errors: [],
    suggestedFixes: [
      {
        id: 'pod-0-0',
        title: 'Adjust memory limit',
        description: 'Increase memory limits in container spec',
        kind: 'Pod',
        resourceName: 'checkout-api',
        namespace: 'default',
      },
    ],
    results: [
      {
        kind: 'Pod',
        name: 'checkout-api',
        namespace: 'default',
        errors: [{ text: 'OOMKilled: container terminated with exit code 137' }],
      },
    ],
  };

  const mockConsensus: ConsensusDiagnosis = {
    rootCause: 'Detected Exit Code 137 (OOMKilled) due to insufficient container memory limits',
    confidence: 'high',
    findings: [
      {
        role: 'runtime',
        agentName: 'Runtime Agent',
        icon: '🔍',
        status: 'completed',
        statusText: 'Exit Code 137 identified',
        summary: 'Detected Exit Code 137 (OOMKilled)',
      },
      {
        role: 'config',
        agentName: 'Config Agent',
        icon: '⚙️',
        status: 'completed',
        statusText: 'Memory limit too low',
        summary: 'Container spec memory limit is set to 256Mi',
      },
    ],
    bestSolution: {
      actionTitle: 'Increase container memory limit to 512Mi',
      steps: [
        'Open deployment manifest for checkout-api',
        'Update resources.limits.memory from 256Mi to 512Mi',
        'Apply changes with kubectl apply',
      ],
      commandToRun: 'kubectl set resources deployment checkout-api --limits=memory=512Mi -n default',
      riskLevel: 'low',
    },
    evidenceCitations: ['pod-exit-code-137', 'memory-limit-256Mi'],
  };

  beforeEach(() => {
    mockStdout = new MockStdout();
    mockStdin = new MockStdin();
    vi.clearAllMocks();
  });

  describe('Task 13.1: AgentCard Component', () => {
    const cardCases: Array<{
      role: 'runtime' | 'config' | 'resource' | 'synthesizer';
      name: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      message: string;
      expectedIcon: string;
      expectedRoleIcon: string;
      desc: string;
    }> = [
      {
        role: 'config',
        name: 'Config Agent',
        status: 'running',
        message: 'Checking pod memory limits and container spec...',
        expectedIcon: '⠋',
        expectedRoleIcon: '⚙️',
        desc: 'working status with spinner icon and task message',
      },
      {
        role: 'runtime',
        name: 'Runtime Agent',
        status: 'completed',
        message: 'Detected Exit Code 137 (OOMKilled)',
        expectedIcon: '✔',
        expectedRoleIcon: '🔍',
        desc: 'completed status with green checkmark and summary',
      },
      {
        role: 'resource',
        name: 'Resource Agent',
        status: 'failed',
        message: 'Node metrics API unreachable',
        expectedIcon: '✖',
        expectedRoleIcon: '🛡️',
        desc: 'failed status with red cross and error message',
      },
      {
        role: 'synthesizer',
        name: 'Lead SRE',
        status: 'pending',
        message: 'Waiting to synthesize findings...',
        expectedIcon: '⏳',
        expectedRoleIcon: '🎯',
        desc: 'pending status with hourglass and waiting message',
      },
    ];

    it.each(cardCases)(
      'renders $desc',
      ({ role, name, status, message, expectedIcon, expectedRoleIcon }) => {
        const { unmount } = render(
          <AgentCard role={role} name={name} status={status} message={message} />,
          { stdout: mockStdout as any }
        );

        const output = mockStdout.frames.join('\n');
        expect(output).toContain(expectedIcon);
        expect(output).toContain(expectedRoleIcon);
        expect(output).toContain(`${name}:`);
        expect(output).toContain(message);
        unmount();
      }
    );
  });

  describe('Task 13.2: ActiveToolPanel Component', () => {
    it('returns null when no active tool is executing', () => {
      const { unmount } = render(<ActiveToolPanel tool={null} />, {
        stdout: mockStdout as any,
      });

      const output = mockStdout.frames.join('\n');
      expect(output).toBe('');
      unmount();
    });

    it('displays idle message when showIdle is enabled and tool is null', () => {
      const { unmount } = render(<ActiveToolPanel tool={null} showIdle={true} />, {
        stdout: mockStdout as any,
      });

      const output = mockStdout.frames.join('\n');
      expect(output).toContain('⚡ Active Tool: None (idle)');
      unmount();
    });

    it('displays running tool with agent badge, tool name, and arguments', () => {
      const { unmount } = render(
        <ActiveToolPanel
          tool={{
            role: 'config',
            agentName: 'Config Agent',
            tool: 'get_deployment_spec',
            args: { name: 'checkout-api' },
            status: 'running',
          }}
        />,
        { stdout: mockStdout as any }
      );

      const output = mockStdout.frames.join('\n');
      expect(output).toContain('⚡ Active Tool:');
      expect(output).toContain('[Config Agent]');
      expect(output).toContain('get_deployment_spec(checkout-api)');
      unmount();
    });

    it('displays elapsed duration when tool has completed', () => {
      const { unmount } = render(
        <ActiveToolPanel
          tool={{
            role: 'runtime',
            agentName: 'Runtime Agent',
            tool: 'get_container_logs',
            args: { pod: 'checkout-api', tail: 50 },
            durationMs: 42,
            status: 'completed',
          }}
        />,
        { stdout: mockStdout as any }
      );

      const output = mockStdout.frames.join('\n');
      expect(output).toContain('⚡ Active Tool:');
      expect(output).toContain('[Runtime Agent]');
      expect(output).toContain('get_container_logs(pod=checkout-api, tail=50)');
      expect(output).toContain('(42ms)');
      unmount();
    });
  });

  describe('Task 13.3 & Consensus: ConsensusDiagnosisView Component', () => {
    it('renders structured consensus with root cause, confidence badge, findings, and fix command', () => {
      const { unmount } = render(
        <ConsensusDiagnosisView consensus={mockConsensus} />,
        { stdout: mockStdout as any }
      );

      const output = mockStdout.frames.join('\n');
      expect(output).toContain('Root Cause:');
      expect(output).toContain('[HIGH CONFIDENCE]');
      expect(output).toContain('Detected Exit Code 137 (OOMKilled)');
      expect(output).toContain('Specialist Agent Findings:');
      expect(output).toContain('Runtime Agent:');
      expect(output).toContain('Config Agent:');
      expect(output).toContain('Recommended Remediation:');
      expect(output).toContain('[LOW RISK]');
      expect(output).toContain('Increase container memory limit to 512Mi');
      expect(output).toContain('Command: kubectl set resources deployment checkout-api --limits=memory=512Mi -n default');
      expect(output).toContain('Evidence Citations: pod-exit-code-137, memory-limit-256Mi');
      unmount();
    });

    it('renders string details fallback cleanly', () => {
      const detailsText = 'Root Cause (HIGH confidence):\n  Node pressure\nRecommended Remediation:\n  Scale up node pool';
      const { unmount } = render(
        <ConsensusDiagnosisView details={detailsText} />,
        { stdout: mockStdout as any }
      );

      const output = mockStdout.frames.join('\n');
      expect(output).toContain('Root Cause');
      expect(output).toContain('Node pressure');
      expect(output).toContain('Recommended Remediation:');
      expect(output).toContain('Scale up node pool');
      unmount();
    });
  });

  describe('Council Event Reducer & Formatters', () => {
    it('formats tool arguments and invocations correctly', () => {
      expect(formatToolArgs({})).toBe('');
      expect(formatToolArgs({ name: 'checkout-api' })).toBe('checkout-api');
      expect(formatToolArgs({ pod: 'checkout-api', tail: 100 })).toBe('pod=checkout-api, tail=100');
      expect(formatToolInvocation('get_pod_events', { namespace: 'default' })).toBe('get_pod_events(default)');
      expect(getAgentDisplayName('runtime')).toBe('Runtime Agent');
      expect(getAgentDisplayName('config')).toBe('Config Agent');
      expect(getAgentIcon('resource')).toBe('🛡️');
      expect(getAgentIcon('synthesizer')).toBe('🎯');
    });

    it('processes lifecycle events and transitions state accurately', () => {
      let state = createInitialCouncilState();
      expect(state.agents.runtime.status).toBe('pending');

      state = councilEventReducer(state, {
        event: 'agent_start',
        role: 'runtime',
        message: 'Analyzing container logs & exit codes...',
        timestamp: '2026-10-15T00:00:00Z',
      });
      expect(state.agents.runtime.status).toBe('running');
      expect(state.agents.runtime.message).toBe('Analyzing container logs & exit codes...');

      state = councilEventReducer(state, {
        event: 'agent_tool_call',
        role: 'config',
        tool: 'get_deployment_spec',
        args: { name: 'checkout-api' },
        timestamp: '2026-10-15T00:00:01Z',
      });
      expect(state.activeTool).not.toBeNull();
      expect(state.activeTool?.tool).toBe('get_deployment_spec');
      expect(state.activeTool?.agentName).toBe('Config Agent');

      state = councilEventReducer(state, {
        event: 'agent_tool_result',
        role: 'config',
        tool: 'get_deployment_spec',
        durationMs: 38,
        timestamp: '2026-10-15T00:00:02Z',
      });
      expect(state.activeTool?.durationMs).toBe(38);
      expect(state.activeTool?.status).toBe('completed');

      state = councilEventReducer(state, {
        event: 'agent_complete',
        role: 'runtime',
        summary: 'Detected Exit Code 137 (OOMKilled)',
        timestamp: '2026-10-15T00:00:03Z',
      });
      expect(state.agents.runtime.status).toBe('completed');
      expect(state.agents.runtime.message).toBe('Detected Exit Code 137 (OOMKilled)');

      state = councilEventReducer(state, {
        event: 'diagnosis_ready',
        consensus: mockConsensus,
        timestamp: '2026-10-15T00:00:04Z',
      });
      expect(state.consensus).toEqual(mockConsensus);
      expect(state.activeTool).toBeNull();
      expect(state.agents.synthesizer.status).toBe('completed');
    });
  });

  describe('Task 13.4: Ink Live Streaming Event Integration in AnalyzeDashboard', () => {
    it('dispatches live streaming events and renders loaders, active tools, and consensus diagnosis', async () => {
      let allowCompletion: () => void;
      const completionBarrier = new Promise<void>((resolve) => {
        allowCompletion = resolve;
      });

      vi.spyOn(analysisModule, 'explainSingleResult').mockImplementation(async (params) => {
        // Step 1: Agent starts
        params.onEvent?.({
          event: 'agent_start',
          role: 'runtime',
          message: 'Analyzing exit code and logs...',
          timestamp: new Date().toISOString(),
        });
        await sleep(20);

        // Step 2: Tool call
        params.onEvent?.({
          event: 'agent_tool_call',
          role: 'config',
          tool: 'get_deployment_spec',
          args: { name: 'checkout-api' },
          timestamp: new Date().toISOString(),
        });

        // Hold until the test has asserted the live active tool panel
        await completionBarrier;

        // Step 3: Tool result
        params.onEvent?.({
          event: 'agent_tool_result',
          role: 'config',
          tool: 'get_deployment_spec',
          durationMs: 45,
          timestamp: new Date().toISOString(),
        });

        // Step 4: Agent complete
        params.onEvent?.({
          event: 'agent_complete',
          role: 'runtime',
          summary: 'Detected Exit Code 137 (OOMKilled)',
          timestamp: new Date().toISOString(),
        });

        // Step 5: Diagnosis ready
        params.onEvent?.({
          event: 'diagnosis_ready',
          consensus: mockConsensus,
          timestamp: new Date().toISOString(),
        });
        (params.result as any).consensus = mockConsensus;
      });

      const { unmount } = render(
        <AnalyzeDashboard
          initialOptions={{ namespace: 'default', output: 'text', backend: 'ollama' }}
          initialResult={mockProblemResult}
        />,
        { stdout: mockStdout as any, stdin: mockStdin as any, interactive: true }
      );

      await waitForFrame(mockStdout, 'checkout-api');
      mockStdin.sendChar('e');

      // Assert live multi-agent investigation panel renders
      await waitForFrame(mockStdout, 'KDM Multi-Agent SRE Investigation');
      await waitForFrame(mockStdout, 'get_deployment_spec(checkout-api)');

      // Verify active tool panel and duration
      const liveOutput = mockStdout.frames.join('\n');
      expect(liveOutput).toContain('⚡ Active Tool:');
      expect(liveOutput).toContain('[Config Agent]');
      expect(liveOutput).toContain('get_deployment_spec(checkout-api)');

      // Now allow the diagnosis to complete
      allowCompletion!();

      // Wait for consensus diagnosis completion view
      await waitForFrame(mockStdout, 'Root Cause:');
      await waitForFrame(mockStdout, '[HIGH CONFIDENCE]');
      await waitForFrame(mockStdout, 'Increase container memory limit to 512Mi');

      const finalOutput = mockStdout.frames.join('\n');
      expect(finalOutput).toContain('Detected Exit Code 137 (OOMKilled)');
      expect(finalOutput).toContain('kubectl set resources deployment checkout-api');
      expect(finalOutput).toContain('--limits=memory=512Mi');
      unmount();
    });
  });
});
