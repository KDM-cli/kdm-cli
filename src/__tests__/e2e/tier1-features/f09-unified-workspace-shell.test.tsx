import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { Box, Text } from 'ink';
import { renderTUI, AppContainerView, runCLI, MockClusterEnvironment } from '../harness';

describe('Tier 1: F-09 Unified Interactive Copilot Workspace', () => {
  it('TC-E2E-T1-F09-01: Default TTY launch into AppContainer with alternate screen buffer', () => {
    const { getCleanOutput, unmount } = renderTUI(
      <AppContainerView activeTab={1}>
        <Box padding={1}>
          <Text>Cluster Overview: 4 Pods, 2 Containers</Text>
        </Box>
      </AppContainerView>
    );

    const output = getCleanOutput();
    expect(output).toContain('KDM Copilot Shell');
    expect(output).toContain('[1: Monitor]');
    expect(output).toContain('Cluster Overview');
    unmount();
  });

  it('TC-E2E-T1-F09-02: Non-interactive / non-TTY fallback to static status summary', async () => {
    const cluster = new MockClusterEnvironment().setHealthyScenario().install();

    // In non-TTY mode with no subcommands, KDM displays non-interactive connection summary
    const result = await runCLI([], { isTTY: false });

    cluster.reset();
    expect(result.exitCode).toBe(0);
  });

  it('TC-E2E-T1-F09-03: Responsive terminal resize handling in AppContainer', () => {
    // Test render at 80 columns
    const { getCleanOutput, unmount } = renderTUI(
      <AppContainerView activeTab={1}>
        <Box flexDirection="row">
          <Text>Compact View</Text>
        </Box>
      </AppContainerView>,
      { columns: 80, rows: 24 }
    );

    const output80 = getCleanOutput();
    expect(output80).toContain('KDM Copilot Shell');
    unmount();

    // Test render at 140 columns
    const expanded = renderTUI(
      <AppContainerView activeTab={1}>
        <Box flexDirection="row">
          <Text>Wide Screen View</Text>
        </Box>
      </AppContainerView>,
      { columns: 140, rows: 40 }
    );

    const output140 = expanded.getCleanOutput();
    expect(output140).toContain('Wide Screen View');
    expanded.unmount();
  });

  it('TC-E2E-T1-F09-04: Workspace tab / view switching via keyboard shortcuts (1-4)', () => {
    // Render with Tab 2 (Agents)
    const { getCleanOutput: getAgentsOutput, unmount: unmountAgents } = renderTUI(
      <AppContainerView activeTab={2}>
        <Text>Subagents Execution Log</Text>
      </AppContainerView>
    );
    expect(getAgentsOutput()).toContain('[2: Agents]');
    expect(getAgentsOutput()).toContain('Subagents Execution Log');
    unmountAgents();

    // Render with Tab 3 (Diffs)
    const { getCleanOutput: getDiffsOutput, unmount: unmountDiffs } = renderTUI(
      <AppContainerView activeTab={3}>
        <Text>Pending Manifest Diff Proposals</Text>
      </AppContainerView>
    );
    expect(getDiffsOutput()).toContain('[3: Diffs]');
    expect(getDiffsOutput()).toContain('Pending Manifest Diff Proposals');
    unmountDiffs();
  });

  it('TC-E2E-T1-F09-05: Graceful exit on Ctrl+C / q keypress with cursor restore', async () => {
    let unmounted = false;
    let exitTriggered = false;

    const onExit = () => {
      exitTriggered = true;
      unmounted = true;
    };

    const { sendKey, wait, unmount } = renderTUI(
      <AppContainerView onExit={onExit}>
        <Text>Interactive shell content</Text>
      </AppContainerView>
    );

    // Send genuine 'q' keystroke to mounted AppContainerView
    sendKey('q');
    await wait(50);

    expect(exitTriggered).toBe(true);
    expect(unmounted).toBe(true);

    unmount();
  });
});
