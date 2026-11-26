import React from 'react';
import { describe, it, expect } from 'vitest';
import { Box } from 'ink';
import { renderTUI, ThinkingMessage } from '../harness';
import { AgentCard } from '../../../ui/components/AgentCard';
import { ActiveToolPanel } from '../../../ui/components/ActiveToolPanel';

describe('Tier 1: F-06 Subagent Progress & Thought UI', () => {
  it('TC-E2E-T1-F06-01: Subagent card rendering with status badges and animated spinners', async () => {
    const { getCleanOutput, unmount } = renderTUI(
      <AgentCard
        role="runtime"
        name="Runtime & Log Agent"
        status="running"
        message="Analyzing exit code 137 in container logs..."
      />
    );

    const output = getCleanOutput();
    expect(output).toContain('Runtime & Log Agent');
    expect(output).toContain('Analyzing exit code 137');
    unmount();
  });

  it('TC-E2E-T1-F06-02: Live streaming thought display (ThinkingMessage with 💭)', async () => {
    const thoughtText = 'Correlating exit code 137 with pod cgroup limit...';
    const { getCleanOutput, unmount } = renderTUI(<ThinkingMessage thought={thoughtText} />);

    const output = getCleanOutput();
    expect(output).toContain('💭');
    expect(output).toContain(thoughtText);
    unmount();
  });

  it('TC-E2E-T1-F06-03: Active tool call sub-panel display with running timers', async () => {
    const { getCleanOutput, unmount } = renderTUI(
      <ActiveToolPanel
        tool={{
          role: 'runtime',
          tool: 'k8s_get_logs',
          args: { pod: 'payment-service', tail: 100 },
          durationMs: 45,
        }}
      />
    );

    const output = getCleanOutput();
    expect(output).toContain('Active Tool');
    expect(output).toContain('k8s_get_logs');
    expect(output).toContain('45ms');
    unmount();
  });

  it('TC-E2E-T1-F06-04: Multi-agent parallel progress cards stacked layout', async () => {
    const { getCleanOutput, unmount } = renderTUI(
      <Box flexDirection="column">
        <AgentCard role="runtime" name="Runtime Agent" status="completed" message="Found OOM error" />
        <AgentCard role="config" name="Config Agent" status="running" message="Scanning manifests" />
        <AgentCard role="resource" name="Resource Agent" status="pending" message="Awaiting turn" />
      </Box>
    );

    const output = getCleanOutput();
    expect(output).toContain('Runtime Agent');
    expect(output).toContain('Config Agent');
    expect(output).toContain('Resource Agent');
    expect(output).toContain('Found OOM error');
    expect(output).toContain('Scanning manifests');
    unmount();
  });

  it('TC-E2E-T1-F06-05: Error state display on subagent failure with red border and message', async () => {
    const { getCleanOutput, unmount } = renderTUI(
      <AgentCard
        role="runtime"
        name="Runtime Agent"
        status="failed"
        message="Kubernetes API connection refused: ETIMEDOUT"
      />
    );

    const output = getCleanOutput();
    expect(output).toContain('Runtime Agent');
    expect(output).toContain('✖');
    expect(output).toContain('Kubernetes API connection refused: ETIMEDOUT');
    unmount();
  });
});
