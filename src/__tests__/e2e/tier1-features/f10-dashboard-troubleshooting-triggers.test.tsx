import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderTUI, DashboardWithTroubleshootTrigger } from '../harness';

describe('Tier 1: F-10 In-Dashboard Troubleshooting Trigger', () => {
  it('TC-E2E-T1-F10-01: Trigger troubleshooting from kdm watch via "t" key', async () => {
    const onTrigger = vi.fn();
    const { sendKey, wait, getLastFrame, unmount } = renderTUI(
      <DashboardWithTroubleshootTrigger
        dashboardType="watch"
        targetResource="payment-service-8f4b-2x9p"
        onTroubleshootTriggered={onTrigger}
      />
    );

    expect(getLastFrame()).toContain('Active Dashboard: WATCH');
    expect(getLastFrame()).toContain('payment-service-8f4b-2x9p');

    sendKey('t');
    await wait(50);

    expect(onTrigger).toHaveBeenCalledWith('payment-service-8f4b-2x9p');
    const output = getLastFrame();
    expect(output).toContain('🤖 AI Troubleshooting Session: payment-service-8f4b-2x9p');
    expect(output).toContain('Dispatching Multi-Agent Council');
    unmount();
  });

  it('TC-E2E-T1-F10-02: Trigger troubleshooting from kdm show pods via "t" key', async () => {
    const onTrigger = vi.fn();
    const { sendKey, wait, getLastFrame, unmount } = renderTUI(
      <DashboardWithTroubleshootTrigger
        dashboardType="show"
        targetResource="pod/auth-api-v2-7c91"
        onTroubleshootTriggered={onTrigger}
      />
    );

    expect(getLastFrame()).toContain('Active Dashboard: SHOW');
    sendKey('t');
    await wait(50);

    expect(onTrigger).toHaveBeenCalledWith('pod/auth-api-v2-7c91');
    expect(getLastFrame()).toContain('🤖 AI Troubleshooting Session: pod/auth-api-v2-7c91');
    unmount();
  });

  it('TC-E2E-T1-F10-03: Trigger troubleshooting from kdm health via "t" key', async () => {
    const onTrigger = vi.fn();
    const { sendKey, wait, getLastFrame, unmount } = renderTUI(
      <DashboardWithTroubleshootTrigger
        dashboardType="health"
        targetResource="order-service"
        onTroubleshootTriggered={onTrigger}
      />
    );

    expect(getLastFrame()).toContain('Active Dashboard: HEALTH');
    sendKey('t');
    await wait(50);

    expect(onTrigger).toHaveBeenCalledWith('order-service');
    expect(getLastFrame()).toContain('🤖 AI Troubleshooting Session: order-service');
    unmount();
  });

  it('TC-E2E-T1-F10-04: Trigger troubleshooting from kdm logs via "t" key', async () => {
    const onTrigger = vi.fn();
    const { sendKey, wait, getLastFrame, unmount } = renderTUI(
      <DashboardWithTroubleshootTrigger
        dashboardType="logs"
        targetResource="payment-service [FATAL: connection refused]"
        currentLogLines={['[INFO] starting...', 'FATAL: connection refused']}
        onTroubleshootTriggered={onTrigger}
      />
    );

    expect(getLastFrame()).toContain('Active Dashboard: LOGS');
    expect(getLastFrame()).toContain('FATAL: connection refused');
    sendKey('t');
    await wait(50);

    expect(onTrigger).toHaveBeenCalledWith('payment-service [FATAL: connection refused]');
    expect(getLastFrame()).toContain('payment-service [FATAL: connection refused]');
    unmount();
  });

  it('TC-E2E-T1-F10-05: Seamless return to monitoring dashboard after triage dismissal (Esc)', async () => {
    const onDismissal = vi.fn();
    const { sendKey, stdin, wait, getLastFrame, unmount } = renderTUI(
      <DashboardWithTroubleshootTrigger
        dashboardType="watch"
        targetResource="payment-service-8f4b-2x9p"
        onDismissal={onDismissal}
      />
    );

    // 1. Enter troubleshooting
    sendKey('t');
    await wait(50);
    expect(getLastFrame()).toContain('🤖 AI Troubleshooting Session');

    // 2. Press Escape
    stdin.sendEscape();
    await wait(50);

    expect(onDismissal).toHaveBeenCalled();
    const output = getLastFrame();
    expect(output).toContain('Active Dashboard: WATCH');
    expect(output).toContain('Press [t] to trigger AI troubleshooting');
    expect(output).not.toContain('Dispatching Multi-Agent Council');
    unmount();
  });
});
