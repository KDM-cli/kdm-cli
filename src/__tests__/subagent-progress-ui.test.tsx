import React, { useEffect } from 'react';
import { describe, it, expect } from 'vitest';
import { Box } from 'ink';
import { renderTUI, stripAnsi } from './e2e/harness/tui-test-utils.js';
import {
  ThinkingMessage,
  compactPreview,
  isNoise,
  normalizeEscapedNewlines,
} from '../ui/components/ThinkingMessage.js';
import {
  SubagentProgressDisplay,
  formatToolArgs,
  type SubagentProgress,
} from '../ui/components/SubagentProgressDisplay.js';
import { StreamingProvider, useStreaming } from '../ui/contexts/StreamingContext.js';

describe('F-06: Subagent Progress & Thought UI', () => {
  it('TC-PROGRESS-01: Subagent status: running renders spinner and agent name', () => {
    const progress: SubagentProgress = {
      agentName: 'RuntimeLogAgent',
      state: 'running',
      thought: 'Analyzing container stdout logs for fatal panics',
    };

    const { getCleanOutput, unmount } = renderTUI(
      <SubagentProgressDisplay progress={progress} />
    );

    const output = getCleanOutput();
    expect(output).toContain('Runtime Agent');
    expect(output).toContain('Analyzing container stdout logs');
    expect(output).toContain('1 running');
    unmount();
  });

  it('TC-PROGRESS-02: Subagent status: completed renders green checkmark ✔ and result text', () => {
    const progress: SubagentProgress = {
      agentName: 'ConfigDependencyAgent',
      state: 'completed',
      result: 'Identified secretKeyRef mismatch: db-url vs DATABASE_URL',
    };

    const { getCleanOutput, unmount } = renderTUI(
      <SubagentProgressDisplay progress={progress} />
    );

    const output = getCleanOutput();
    expect(output).toContain('✔');
    expect(output).toContain('Config Agent');
    expect(output).toContain('Identified secretKeyRef mismatch');
    expect(output).toContain('1 completed');
    unmount();
  });

  it('TC-PROGRESS-03: Subagent status: error renders red ✖ and error message', () => {
    const progress: SubagentProgress = {
      agentName: 'ClusterResourceAgent',
      state: 'error',
      result: 'Kubernetes API connection refused: ETIMEDOUT',
    };

    const { getCleanOutput, unmount } = renderTUI(
      <SubagentProgressDisplay progress={progress} />
    );

    const output = getCleanOutput();
    expect(output).toContain('✖');
    expect(output).toContain('Resource Agent');
    expect(output).toContain('Kubernetes API connection refused: ETIMEDOUT');
    expect(output).toContain('1 failed');
    unmount();
  });

  it('TC-PROGRESS-04: Subagent status: cancelled renders warning indicator and cancellation notice', () => {
    const progress: SubagentProgress = {
      agentName: 'SynthesizerAgent',
      state: 'cancelled',
      toolCall: {
        name: 'k8s_delete_pod',
        args: { pod: 'auth-svc-123' },
        status: 'running',
      },
    };

    const { getCleanOutput, unmount } = renderTUI(
      <SubagentProgressDisplay progress={progress} />
    );

    const output = getCleanOutput();
    expect(output).toContain('ℹ');
    expect(output).toContain('Subagent SynthesizerAgent was cancelled.');
    expect(output).toContain('1 cancelled');
    unmount();
  });

  it('TC-PROGRESS-05: Streaming thoughts (ThinkingMessage with 💭)', () => {
    const thoughtText = 'Correlating exit code 137 with pod cgroup limit';
    const { getCleanOutput, unmount } = renderTUI(
      <ThinkingMessage thought={thoughtText} />
    );

    const output = getCleanOutput();
    expect(output).toContain('💭');
    expect(output).toContain(thoughtText);
    unmount();
  });

  it('TC-PROGRESS-06: Empty thought stream consumes zero vertical space', () => {
    const { getCleanOutput, unmount } = renderTUI(
      <ThinkingMessage thought="" />
    );

    const output = getCleanOutput();
    expect(output.trim()).toBe('');
    unmount();

    const { getCleanOutput: getWhitespaceOutput, unmount: unmountWs } = renderTUI(
      <ThinkingMessage thought="    " />
    );
    expect(getWhitespaceOutput().trim()).toBe('');
    unmountWs();
  });

  it('TC-PROGRESS-07: ThinkingMessage filters noise dots ("...")', () => {
    expect(isNoise('...')).toBe(true);
    expect(isNoise('......')).toBe(true);
    expect(isNoise('Real thought')).toBe(false);

    const { getCleanOutput, unmount } = renderTUI(
      <ThinkingMessage thought="..." />
    );

    expect(getCleanOutput().trim()).toBe('');
    unmount();
  });

  it('TC-PROGRESS-08: ThinkingMessage compact preview truncates long reasoning traces (>1500 chars)', () => {
    const longTrace = 'Z'.repeat(2000);
    const { getCleanOutput, unmount } = renderTUI(
      <ThinkingMessage thought={longTrace} />
    );

    const output = getCleanOutput();
    expect(output).toContain('... [+more]');
    unmount();

    expect(compactPreview('Short text', 120)).toBe('Short text');
    expect(compactPreview('A'.repeat(150), 120)).toContain('... [+more]');
  });

  it('TC-PROGRESS-09: Active tool invocation sub-panel renders tool name and arguments', () => {
    const progress: SubagentProgress = {
      agentName: 'RuntimeLogAgent',
      state: 'running',
      toolCall: {
        name: 'k8s_get_logs',
        args: { pod: 'auth-svc', tail: 50, namespace: 'production' },
        status: 'running',
      },
    };

    const { getCleanOutput, unmount } = renderTUI(
      <SubagentProgressDisplay progress={progress} />
    );

    const output = getCleanOutput();
    expect(output).toContain('⚡ Active Tool:');
    expect(output).toContain('k8s_get_logs');
    expect(output).toContain('pod="auth-svc"');
    expect(output).toContain('tail=50');
    unmount();
  });

  it('TC-PROGRESS-10: Tool call completion duration display', () => {
    const progress: SubagentProgress = {
      agentName: 'ConfigDependencyAgent',
      state: 'completed',
      toolCall: {
        name: 'k8s_get_manifest',
        args: { file: 'deployment.yaml' },
        status: 'success',
        output: 'completed in 45ms',
      },
    };

    const { getCleanOutput, unmount } = renderTUI(
      <SubagentProgressDisplay progress={progress} />
    );

    const output = getCleanOutput();
    expect(output).toContain('⚡ Active Tool:');
    expect(output).toContain('k8s_get_manifest');
    expect(output).toContain('completed in 45ms');
    unmount();
  });

  it('TC-PROGRESS-11: Stacked parallel multi-agent progress cards layout', () => {
    const subagents: SubagentProgress[] = [
      { agentName: 'RuntimeLogAgent', state: 'completed', result: 'Exit code 137 found' },
      { agentName: 'ConfigDependencyAgent', state: 'running', thought: 'Checking memory requests' },
      { agentName: 'ClusterResourceAgent', state: 'running', thought: 'Inspecting node allocatable' },
      { agentName: 'SynthesizerAgent', state: 'completed', result: 'OOMKilled root cause verified' },
    ];

    const { getCleanOutput, unmount } = renderTUI(
      <SubagentProgressDisplay subagents={subagents} />
    );

    const output = getCleanOutput();
    expect(output).toContain('Runtime Agent');
    expect(output).toContain('Config Agent');
    expect(output).toContain('Resource Agent');
    expect(output).toContain('Lead SRE');
    expect(output).toContain('Exit code 137 found');
    expect(output).toContain('Checking memory requests');
    expect(output).toContain('OOMKilled root cause verified');
    unmount();
  });

  it('TC-PROGRESS-12: Interactive card expansion via Ctrl+O keypress', async () => {
    const subagents: SubagentProgress[] = [
      {
        agentName: 'RuntimeLogAgent',
        state: 'completed',
        thought: 'Deep memory investigation details here',
        toolCall: {
          name: 'k8s_get_logs',
          args: { pod: 'auth-svc' },
          status: 'success',
          output: 'Full 500 lines of container output logs',
        },
        result: 'Root cause confirmed',
      },
    ];

    const { stdin, wait, getLastFrame, unmount } = renderTUI(
      <SubagentProgressDisplay subagents={subagents} initiallyExpanded={false} />
    );

    expect(stripAnsi(getLastFrame())).toContain('ctrl+o to expand');

    // Send Ctrl+O (\u000f)
    stdin.send('\u000f');
    await wait(40);

    const expandedOutput = stripAnsi(getLastFrame());
    expect(expandedOutput).toContain('ctrl+o to collapse');
    expect(expandedOutput).toContain('Output: Full 500 lines of container output logs');

    // Send Ctrl+O again to collapse
    stdin.send('\u000f');
    await wait(40);

    const collapsedOutput = stripAnsi(getLastFrame());
    expect(collapsedOutput).toContain('ctrl+o to expand');

    unmount();
  });

  it('TC-PROGRESS-13: Reactivity via StreamingContext and NDJSON mapping', async () => {
    const TestConsumer: React.FC = () => {
      const { subagents, processNDJSON } = useStreaming();

      useEffect(() => {
        // Emit simulated agent events
        processNDJSON({
          event: 'agent_start',
          role: 'runtime',
          message: 'Inspecting auth container logs',
          timestamp: new Date().toISOString(),
        });
        processNDJSON({
          event: 'agent_tool_call',
          role: 'runtime',
          tool: 'k8s_get_logs',
          args: { pod: 'auth-api', lines: 100 },
          timestamp: new Date().toISOString(),
        });
      }, [processNDJSON]);

      return <SubagentProgressDisplay subagents={subagents} />;
    };

    const { wait, getLastFrame, unmount } = renderTUI(
      <StreamingProvider>
        <TestConsumer />
      </StreamingProvider>
    );

    await wait(50);
    const output = stripAnsi(getLastFrame());
    expect(output).toContain('Runtime Agent');
    expect(output).toContain('k8s_get_logs');
    expect(output).toContain('pod="auth-api"');
    unmount();
  });

  it('TC-PROGRESS-14: Terminal viewport narrower than card minimum width (40 cols) wraps safely', () => {
    const progress: SubagentProgress = {
      agentName: 'RuntimeLogAgent',
      state: 'running',
      thought: 'A very long diagnostic reasoning string that must wrap properly without throwing any bounds error',
    };

    const { getCleanOutput, unmount } = renderTUI(
      <SubagentProgressDisplay progress={progress} terminalWidth={35} />,
      { columns: 35, rows: 20 }
    );

    const output = getCleanOutput();
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('Runtime');
    unmount();
  });

  it('TC-PROGRESS-15: formatToolArgs and normalizeEscapedNewlines helpers', () => {
    expect(formatToolArgs({ pod: 'checkout', tail: 50 })).toBe('pod="checkout", tail=50');
    expect(formatToolArgs('{"pod":"checkout"}')).toBe('pod="checkout"');
    expect(formatToolArgs(undefined)).toBe('');

    expect(normalizeEscapedNewlines('Line 1\\nLine 2')).toBe('Line 1\nLine 2');
    expect(normalizeEscapedNewlines(undefined)).toBe('');
  });

  it('TC-PROGRESS-16: formatToolArgs safely handles BigInt and circular structures without crashing', () => {
    // BigInt handling
    const bigIntArgs = { memoryBytes: BigInt(1073741824) };
    expect(formatToolArgs(bigIntArgs)).toBe('memoryBytes=1073741824n');

    // Circular reference handling
    const circ: any = { key: 'value' };
    circ.self = circ;
    expect(() => formatToolArgs({ circ })).not.toThrow();
    expect(formatToolArgs({ circ })).toContain('circ=[Complex]');
  });

  it('TC-PROGRESS-17: isNoise recognizes unicode ellipsis and spaced dot patterns', () => {
    expect(isNoise('…')).toBe(true);
    expect(isNoise('...')).toBe(true);
    expect(isNoise('. . .')).toBe(true);
    expect(isNoise('… …')).toBe(true);
    expect(isNoise(' .  . ')).toBe(true);
    expect(isNoise('Thinking...')).toBe(false);

    const { getCleanOutput, unmount } = renderTUI(<ThinkingMessage thought="…" />);
    expect(getCleanOutput().trim()).toBe('');
    unmount();
  });

  it('TC-PROGRESS-18: ThinkingMessage caps ThoughtSummary description lines', () => {
    const manyLines = Array.from({ length: 100 }, (_, i) => `Thought line ${i + 1}`).join('\n');
    const thoughtObj = {
      subject: 'Root Cause Investigation',
      description: manyLines,
    };

    // Full view caps at 50 description lines
    const { getCleanOutput, unmount } = renderTUI(
      <ThinkingMessage thought={thoughtObj} compact={false} />
    );
    const output = getCleanOutput();
    expect(output).toContain('Thought line 1');
    expect(output).toContain('Thought line 50');
    expect(output).toContain('... [+more]');
    expect(output).not.toContain('Thought line 55');
    unmount();

    // Compact view caps at 3 lines
    const { getCleanOutput: getCompactOutput, unmount: unmountCompact } = renderTUI(
      <ThinkingMessage thought={thoughtObj} compact={true} />
    );
    const compactOutput = getCompactOutput();
    expect(compactOutput).toContain('Thought line 1');
    expect(compactOutput).toContain('Thought line 3');
    expect(compactOutput).toContain('... [+more]');
    expect(compactOutput).not.toContain('Thought line 10');
    unmountCompact();
  });

  it('TC-PROGRESS-19: StreamingContext maps agent_tool_result to subagent toolCall success status', async () => {
    const TestConsumer: React.FC = () => {
      const { subagents, processNDJSON } = useStreaming();

      useEffect(() => {
        processNDJSON({
          event: 'agent_start',
          role: 'runtime',
          message: 'Inspecting auth container logs',
          timestamp: new Date().toISOString(),
        });
        processNDJSON({
          event: 'agent_tool_call',
          role: 'runtime',
          tool: 'k8s_get_logs',
          args: { pod: 'auth-api' },
          timestamp: new Date().toISOString(),
        });
        // Immediately complete tool call
        processNDJSON({
          event: 'agent_tool_result',
          role: 'runtime',
          tool: 'k8s_get_logs',
          durationMs: 45,
          timestamp: new Date().toISOString(),
        });
      }, [processNDJSON]);

      return <SubagentProgressDisplay subagents={subagents} />;
    };

    const { wait, getLastFrame, unmount } = renderTUI(
      <StreamingProvider>
        <TestConsumer />
      </StreamingProvider>
    );

    await wait(60);
    const output = stripAnsi(getLastFrame());
    expect(output).toContain('Runtime Agent');
    expect(output).toContain('k8s_get_logs');
    expect(output).toContain('completed in 45ms');
    expect(output).toContain('✔'); // Green checkmark for toolCall success
    unmount();
  });
});
