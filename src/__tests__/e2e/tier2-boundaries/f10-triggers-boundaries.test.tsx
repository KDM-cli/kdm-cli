import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderTUI, DashboardWithTroubleshootTrigger } from '../harness';
import { AgentCard } from '../../../ui/components/AgentCard';

describe('Tier 2: F-10 Dashboard Triggers Boundaries & Corner Cases', () => {
  it('TC-E2E-T2-F10-01: Pressing "t" with no selected resource shows guidance hint', async () => {
    const onTrigger = vi.fn();
    const { sendKey, wait, getLastFrame, unmount } = renderTUI(
      <DashboardWithTroubleshootTrigger
        dashboardType="watch"
        targetResource={null}
        onTroubleshootTriggered={onTrigger}
      />
    );

    sendKey('t');
    await wait(50);

    expect(onTrigger).not.toHaveBeenCalled();
    expect(getLastFrame()).toContain('No workload selected. Use arrow keys to select a workload.');
    unmount();
  });

  it('TC-E2E-T2-F10-02: Rapid repeated pressing of "t" key spammed ignores duplicates', async () => {
    const onTrigger = vi.fn();
    const { sendKey, wait, unmount } = renderTUI(
      <DashboardWithTroubleshootTrigger
        dashboardType="watch"
        targetResource="payment-service-8f4b-2x9p"
        onTroubleshootTriggered={onTrigger}
      />
    );

    // Spam 't' 5 times rapidly
    for (let i = 0; i < 5; i++) {
      sendKey('t');
    }
    await wait(50);

    expect(onTrigger).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('TC-E2E-T2-F10-03: Pressing "t" on healthy workload runs verification without false alarms', async () => {
    const onTrigger = vi.fn();
    const { sendKey, wait, getLastFrame, unmount } = renderTUI(
      <DashboardWithTroubleshootTrigger
        dashboardType="health"
        targetResource="healthy-pod-zero-restarts"
        onTroubleshootTriggered={onTrigger}
      />
    );

    sendKey('t');
    await wait(50);

    expect(onTrigger).toHaveBeenCalledWith('healthy-pod-zero-restarts');
    expect(getLastFrame()).toContain('🤖 AI Troubleshooting Session: healthy-pod-zero-restarts');
    unmount();
  });

  it('TC-E2E-T2-F10-04: Network disconnect mid-troubleshooting marks subagent failed with retry option', () => {
    const { getLastFrame, unmount } = renderTUI(
      <AgentCard
        role="runtime"
        name="Runtime Agent"
        status="failed"
        message="Network disconnected mid-investigation. Press [r] to retry or [Esc] to return."
      />
    );

    const output = getLastFrame();
    expect(output).toContain('Runtime Agent');
    expect(output).toContain('Network disconnected mid-investigation');
    expect(output).toContain('Press [r] to retry');
    unmount();
  });

  it('TC-E2E-T2-F10-05: Headless flag (--no-interactive) disables "t" keyboard shortcut', async () => {
    const onTrigger = vi.fn();
    const { sendKey, wait, getLastFrame, unmount } = renderTUI(
      <DashboardWithTroubleshootTrigger
        dashboardType="watch"
        targetResource="payment-service-8f4b-2x9p"
        onTroubleshootTriggered={onTrigger}
        isHeadless={true}
      />
    );

    sendKey('t');
    await wait(50);

    expect(onTrigger).not.toHaveBeenCalled();
    expect(getLastFrame()).not.toContain('🤖 AI Troubleshooting Session');
    expect(getLastFrame()).toContain('Active Dashboard: WATCH');
    unmount();
  });
});
