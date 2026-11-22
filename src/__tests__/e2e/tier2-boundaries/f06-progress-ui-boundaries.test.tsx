import React from 'react';
import { describe, it, expect } from 'vitest';
import { Box, Text } from 'ink';
import { renderTUI, ThinkingMessage, stripAnsi, translateNDJSONToSubagentProgress } from '../harness';
import { AgentCard } from '../../../ui/components/AgentCard';

describe('Tier 2: F-06 Progress UI Boundaries & Corner Cases', () => {
  it('TC-E2E-T2-F06-01: Terminal viewport narrower than card minimum width (40 columns)', () => {
    const { getCleanOutput, unmount } = renderTUI(
      <Box width={35} flexDirection="column">
        <AgentCard
          role="runtime"
          name="RuntimeAgent"
          status="running"
          message="Very long message that wraps safely"
        />
      </Box>,
      { columns: 40, rows: 20 }
    );

    const output = getCleanOutput();
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('Runtime');
    unmount();
  });

  it('TC-E2E-T2-F06-02: Rapid high-frequency progress event storm (100 events/sec) batched smoothly', async () => {
    let latestProgress: ReturnType<typeof translateNDJSONToSubagentProgress> = null;

    // Stream 100 events in rapid succession through NDJSON translation
    for (let i = 0; i < 100; i++) {
      latestProgress = translateNDJSONToSubagentProgress({
        event: 'agent_progress',
        role: 'RuntimeAgent',
        message: `Progress step #${i}`,
      });
    }

    expect(latestProgress).not.toBeNull();
    expect(latestProgress?.thought).toBe('Progress step #99');

    const { getCleanOutput, unmount } = renderTUI(
      <AgentCard
        role="runtime"
        name={latestProgress!.agentName}
        status="running"
        message={latestProgress!.thought}
      />
    );

    const frame = getCleanOutput();
    expect(frame).toContain('RuntimeAgent');
    expect(frame).toContain('Progress step #99');
    unmount();
  });

  it('TC-E2E-T2-F06-03: Empty thought stream (thought: "") consumes zero vertical rows', () => {
    const { getCleanOutput, unmount } = renderTUI(<ThinkingMessage thought="" />);
    const output = getCleanOutput();
    expect(output.trim()).toBe('');
    unmount();
  });

  it('TC-E2E-T2-F06-04: Long reasoning trace (>1500 chars) rendered with compact preview', () => {
    const longTrace = 'A'.repeat(2000);

    const { getCleanOutput, unmount } = renderTUI(
      <ThinkingMessage thought={longTrace} />
    );

    const output = getCleanOutput();
    expect(output.length).toBeLessThan(140);
    expect(output).toContain('... [+more]');
    unmount();
  });

  it('TC-E2E-T2-F06-05: Unicode and raw ANSI color injection in progress messages sanitized', () => {
    const injectedMessage = '\u001b[31;1mDanger Red\u001b[0m 🚀 Pod crash detected';
    const sanitized = stripAnsi(injectedMessage);

    expect(sanitized).toBe('Danger Red 🚀 Pod crash detected');
    expect(sanitized).not.toContain('\u001b');
  });
});
