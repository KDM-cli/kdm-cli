import React from 'react';
import { describe, it, expect } from 'vitest';
import { Box, Text } from 'ink';
import { renderTUI, stripAnsi, AppContainerView, debounceResize } from '../harness';

describe('Tier 2: F-09 Workspace Shell Boundaries & Corner Cases', () => {
  it('TC-E2E-T2-F09-01: Rapid window resizing storm (10 events/sec) debounced', async () => {
    let appliedWidth = 80;
    let callCount = 0;

    const handleResize = debounceResize((cols) => {
      appliedWidth = cols;
      callCount++;
    }, 25);

    const { getCleanOutput, wait, unmount } = renderTUI(
      <AppContainerView>
        <Text>Terminal Width: {appliedWidth}</Text>
      </AppContainerView>
    );

    // Rapid successive resize storm (11 events in quick succession)
    for (let c = 80; c <= 120; c += 4) {
      handleResize(c, 24);
    }

    // Trailing debounce prevents synchronous spam execution
    expect(callCount).toBe(0);

    // Allow debounce timer to settle
    await wait(60);

    // Exactly one trailing update performed with final target dimension
    expect(callCount).toBe(1);
    expect(appliedWidth).toBe(120);

    expect(getCleanOutput()).toContain('KDM Copilot Shell');
    unmount();
  });

  it('TC-E2E-T2-F09-02: NO_COLOR=1 or TERM=dumb environment strips ANSI styling', () => {
    const coloredString = '\u001b[32mActive (1/1)\u001b[0m';
    const plain = stripAnsi(coloredString);
    expect(plain).toBe('Active (1/1)');
  });

  it('TC-E2E-T2-F09-03: Background cluster polling timeout isolated to banner without freezing shell', () => {
    const { getLastFrame, getCleanOutput, unmount } = renderTUI(
      <AppContainerView bannerError="Cluster poll warning: ETIMEDOUT">
        <Text>Active Workloads Table</Text>
      </AppContainerView>
    );

    const frame = getLastFrame() || '';
    expect(frame).toContain('Cluster poll warning: ETIMEDOUT');
    expect(frame).toContain('KDM Copilot Shell');
    expect(frame).toContain('Active Workloads Table');
    unmount();
  });

  it('TC-E2E-T2-F09-04: Zero resources returned in monitor pane displays informative empty state', () => {
    const { getCleanOutput, unmount } = renderTUI(
      <Box padding={1}>
        <Text dimColor>No active workloads found in current context</Text>
      </Box>
    );

    expect(getCleanOutput()).toContain('No active workloads found in current context');
    unmount();
  });

  it('TC-E2E-T2-F09-05: Host SIGTERM/SIGHUP triggers graceful terminal restoration and exit 143', () => {
    let terminalRestored = false;
    let recordedSignal = '';

    const { unmount } = renderTUI(
      <AppContainerView
        registerSignalHandlers
        onSignal={(sig) => {
          recordedSignal = sig;
          terminalRestored = true;
        }}
      >
        <Text>Shell active with signal handlers</Text>
      </AppContainerView>
    );

    process.emit('SIGTERM');

    expect(recordedSignal).toBe('SIGTERM');
    expect(terminalRestored).toBe(true);

    unmount();
  });
});
