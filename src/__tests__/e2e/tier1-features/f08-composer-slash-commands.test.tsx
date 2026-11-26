import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderTUI, ComposerView } from '../harness';

describe('Tier 1: F-08 Interactive Prompt & Slash Command Composer', () => {
  it('TC-E2E-T1-F08-01: Multiline prompt input and editing in Composer', async () => {
    const onSubmit = vi.fn();
    const promptText = 'Diagnose why pod checkout-api is restarting in staging';

    const { sendKey, wait, getCleanOutput, unmount } = renderTUI(
      <ComposerView onSubmit={onSubmit} />
    );

    sendKey(promptText);
    await wait(50);

    const output = getCleanOutput();
    expect(output).toContain('❯');
    expect(output).toContain(promptText);
    unmount();
  });

  it('TC-E2E-T1-F08-02: Slash command autocompletion dropdown on "/"', async () => {
    const onSubmit = vi.fn();
    const { sendKey, wait, getCleanOutput, unmount } = renderTUI(
      <ComposerView onSubmit={onSubmit} />
    );

    // Typing '/' opens autocomplete dropdown
    sendKey('/');
    await wait(50);

    const output = getCleanOutput();
    expect(output).toContain('Available Slash Commands:');
    expect(output).toContain('/pods');
    expect(output).toContain('/containers');
    expect(output).toContain('/watch');
    expect(output).toContain('/analyze');
    unmount();
  });

  it('TC-E2E-T1-F08-03: Slash command selection and parameter parsing (/pods -n staging)', async () => {
    const onSubmit = vi.fn();
    const { sendKey, stdin, wait, unmount } = renderTUI(
      <ComposerView onSubmit={onSubmit} />
    );

    sendKey('/pods -n staging');
    await wait(20);
    stdin.sendEnter();
    await wait(50);

    expect(onSubmit).toHaveBeenCalledWith('/pods -n staging');
    unmount();
  });

  it('TC-E2E-T1-F08-04: Command history navigation with Up / Down arrow keys', async () => {
    const history = ['/pods', 'diagnose payment', '/watch'];
    const onSubmit = vi.fn();

    const { stdin, wait, getCleanOutput, unmount } = renderTUI(
      <ComposerView onSubmit={onSubmit} history={history} />
    );

    // Navigate Up to most recent command
    stdin.sendUp();
    await wait(20);
    expect(getCleanOutput()).toContain('/watch');

    // Navigate Up again
    stdin.sendUp();
    await wait(20);
    expect(getCleanOutput()).toContain('diagnose payment');

    // Navigate Down back to /watch
    stdin.sendDown();
    await wait(20);
    expect(getCleanOutput()).toContain('/watch');

    unmount();
  });

  it('TC-E2E-T1-F08-05: Escape key autocomplete dismissal preserving input buffer', async () => {
    const onSubmit = vi.fn();
    const { sendKey, stdin, wait, getLastFrame, unmount } = renderTUI(
      <ComposerView onSubmit={onSubmit} />
    );

    // Type partial slash command
    sendKey('/po');
    await wait(20);
    expect(getLastFrame()).toContain('Available Slash Commands:');

    // Press Escape
    stdin.sendEscape();
    await wait(50);

    const output = getLastFrame();
    expect(output).not.toContain('Available Slash Commands:');
    expect(output).toContain('/po'); // Buffer preserved
    unmount();
  });
});
