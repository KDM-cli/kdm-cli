import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderTUI, ComposerView } from '../harness';

describe('Tier 2: F-08 Composer Boundaries & Corner Cases', () => {
  it('TC-E2E-T2-F08-01: Whitespace-only / empty prompt submission ignored', async () => {
    const onSubmit = vi.fn();
    const { sendKey, stdin, wait, unmount } = renderTUI(
      <ComposerView onSubmit={onSubmit} />
    );

    // Empty enter
    stdin.sendEnter();
    await wait(20);

    // Whitespace enter
    sendKey('    ');
    await wait(20);
    stdin.sendEnter();
    await wait(20);

    expect(onSubmit).not.toHaveBeenCalled();

    // Valid prompt succeeds
    sendKey('diagnose auth');
    await wait(20);
    stdin.sendEnter();
    await wait(50);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('diagnose auth');
    unmount();
  });

  it('TC-E2E-T2-F08-02: Unknown slash command (/unknowncommand) displays helpful error', async () => {
    const onSubmit = vi.fn();
    const { sendKey, stdin, wait, getLastFrame, unmount } = renderTUI(
      <ComposerView onSubmit={onSubmit} />
    );

    sendKey('/unknowncommand');
    await wait(20);
    stdin.sendEnter();
    await wait(50);

    expect(onSubmit).not.toHaveBeenCalled();
    const output = getLastFrame();
    expect(output).toContain("Unknown command '/unknowncommand'. Type /help for available commands.");
    unmount();
  });

  it('TC-E2E-T2-F08-03: Rapid double Enter keystroke debounced to single dispatch', async () => {
    const onSubmit = vi.fn();
    const { sendKey, stdin, wait, unmount } = renderTUI(
      <ComposerView onSubmit={onSubmit} />
    );

    sendKey('diagnose pod');
    await wait(20);

    // Rapid double enter
    stdin.sendEnter();
    stdin.sendEnter();
    await wait(50);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('diagnose pod');
    unmount();
  });

  it('TC-E2E-T2-F08-04: Extreme input string length (10,000 characters pasted) handled safely', async () => {
    const hugeInput = 'x'.repeat(10000);
    const onSubmit = vi.fn();

    const { sendKey, stdin, wait, unmount } = renderTUI(
      <ComposerView onSubmit={onSubmit} maxBufferLength={10000} />
    );

    sendKey(hugeInput);
    await wait(50);
    stdin.sendEnter();
    await wait(50);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].length).toBe(10000);
    unmount();
  });

  it('TC-E2E-T2-F08-05: Arrow key navigation at history boundaries clamped safely', async () => {
    const history = ['first', 'second', 'third'];
    const onSubmit = vi.fn();

    const { stdin, wait, getLastFrame, unmount } = renderTUI(
      <ComposerView onSubmit={onSubmit} history={history} />
    );

    // Spam Up Arrow beyond upper bound
    for (let i = 0; i < 10; i++) {
      stdin.sendUp();
    }
    await wait(50);
    expect(getLastFrame()).toContain('first');

    // Spam Down Arrow beyond lower bound
    for (let i = 0; i < 10; i++) {
      stdin.sendDown();
    }
    await wait(50);
    // Returns cleanly to empty prompt buffer
    expect(getLastFrame()).toContain('Type a prompt or / command...');
    unmount();
  });
});
