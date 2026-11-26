import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderTUI, stripAnsi } from './e2e/harness/tui-test-utils.js';
import { Composer, parseSlashCommand, executeSlashCommand } from '../ui/components/Composer.js';

describe('F-08: Interactive Prompt & Slash Command Composer', () => {
  it('TC-COMPOSER-01: Initial placeholder rendering with prompt symbol ❯', () => {
    const onSubmit = vi.fn();
    const { getCleanOutput, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} placeholder="Type a prompt or / command..." />
    );

    const output = getCleanOutput();
    expect(output).toContain('❯');
    expect(output).toContain('Type a prompt or / command...');
    unmount();
  });

  it('TC-COMPOSER-02: Interactive character typing accumulates in buffer', async () => {
    const onSubmit = vi.fn();
    const { stdin, wait, getCleanOutput, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} />
    );

    stdin.send('pods');
    await wait(30);

    const output = getCleanOutput();
    expect(output).toContain('❯');
    expect(output).toContain('pods');
    unmount();
  });

  it('TC-COMPOSER-03: Backspace editing modifies input buffer', async () => {
    const onSubmit = vi.fn();
    const { stdin, wait, getCleanOutput, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} />
    );

    stdin.send('helm');
    await wait(20);
    // Send backspace character (\x08)
    stdin.send('\x08');
    await wait(20);
    stdin.send('p');
    await wait(20);

    const output = getCleanOutput();
    expect(output).toContain('help');
    unmount();
  });

  it('TC-COMPOSER-04: Command submission on Enter invokes onSubmit with trimmed prompt', async () => {
    const onSubmit = vi.fn();
    const { stdin, wait, getCleanOutput, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} />
    );

    stdin.send('  diagnose oom in checkout  ');
    await wait(20);
    stdin.sendEnter();
    await wait(40);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('diagnose oom in checkout');

    // Buffer is cleared after submit
    const output = getCleanOutput();
    expect(output).toContain('Type a prompt or / command...');
    unmount();
  });

  it('TC-COMPOSER-05: Empty / whitespace prompt debounce ignores submission', async () => {
    const onSubmit = vi.fn();
    const { stdin, wait, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} />
    );

    stdin.sendEnter();
    await wait(20);
    stdin.send('     ');
    await wait(20);
    stdin.sendEnter();
    await wait(20);

    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
  });

  it('TC-COMPOSER-06: Command history navigation Up and Down arrows preserves draft', async () => {
    const onSubmit = vi.fn();
    const history = ['/pods', '/watch -n staging', '/health'];
    const { stdin, wait, getCleanOutput, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} history={history} />
    );

    // Type a draft
    stdin.send('my draft query');
    await wait(20);
    expect(getCleanOutput()).toContain('my draft query');

    // Press Up arrow -> should recall latest history '/health'
    stdin.sendUp();
    await wait(30);
    expect(getCleanOutput()).toContain('/health');

    // Press Up arrow again -> '/watch -n staging'
    stdin.sendUp();
    await wait(30);
    expect(getCleanOutput()).toContain('/watch -n staging');

    // Press Up arrow again -> clamped to index 0 '/pods'
    stdin.sendUp();
    await wait(30);
    expect(getCleanOutput()).toContain('/pods');

    // Press Up arrow once more -> remains clamped at '/pods'
    stdin.sendUp();
    await wait(30);
    expect(getCleanOutput()).toContain('/pods');

    // Press Down arrow -> returns forward to '/watch -n staging'
    stdin.sendDown();
    await wait(30);
    expect(getCleanOutput()).toContain('/watch -n staging');

    // Press Down arrow -> '/health'
    stdin.sendDown();
    await wait(30);
    expect(getCleanOutput()).toContain('/health');

    // Press Down arrow past end of history -> restores 'my draft query'
    stdin.sendDown();
    await wait(30);
    expect(getCleanOutput()).toContain('my draft query');

    unmount();
  });

  it('TC-COMPOSER-07: Slash command autocompletion menu opens on "/"', async () => {
    const onSubmit = vi.fn();
    const { stdin, wait, getCleanOutput, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} />
    );

    stdin.send('/');
    await wait(30);

    const output = getCleanOutput();
    expect(output).toContain('Available Commands:');
    expect(output).toContain('/pods');
    expect(output).toContain('/containers');
    expect(output).toContain('/watch');
    expect(output).toContain('/analyze');
    expect(output).toContain('/health');
    expect(output).toContain('/help');
    unmount();
  });

  it('TC-COMPOSER-08: Slash command prefix filtering (/p and /co)', async () => {
    const onSubmit = vi.fn();
    const { stdin, wait, getLastFrame, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} />
    );

    stdin.send('/p');
    await wait(30);

    let output = stripAnsi(getLastFrame());
    expect(output).toContain('/pods');
    expect(output).not.toContain('/containers');

    // Backspace 'p' and type 'co'
    stdin.send('\x08');
    await wait(20);
    stdin.send('co');
    await wait(30);

    output = stripAnsi(getLastFrame());
    expect(output).toContain('/containers');
    expect(output).not.toContain('/pods');

    unmount();
  });

  it('TC-COMPOSER-09: Tab key completion autocompletes matching command', async () => {
    const onSubmit = vi.fn();
    const { stdin, wait, getLastFrame, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} />
    );

    stdin.send('/w');
    await wait(30);
    expect(stripAnsi(getLastFrame())).toContain('/watch');

    // Send Tab
    stdin.sendTab();
    await wait(30);

    const output = stripAnsi(getLastFrame());
    expect(output).toContain('/watch ');
    expect(output).not.toContain('Available Commands:');
    unmount();
  });

  it('TC-COMPOSER-10: Escape key dismisses autocomplete while preserving input buffer', async () => {
    const onSubmit = vi.fn();
    const { stdin, wait, getLastFrame, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} />
    );

    stdin.send('/po');
    await wait(30);
    expect(stripAnsi(getLastFrame())).toContain('Available Commands:');

    // Dismiss with Escape
    stdin.sendEscape();
    await wait(30);

    const output = stripAnsi(getLastFrame());
    expect(output).not.toContain('Available Commands:');
    expect(output).toContain('/po');
    unmount();
  });

  it('TC-COMPOSER-11: Multiline prompt input inserts newline character', async () => {
    const onSubmit = vi.fn();
    const { stdin, wait, getCleanOutput, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} />
    );

    stdin.send('Line 1');
    await wait(20);
    // Send newline \n directly
    stdin.send('\n');
    await wait(20);
    stdin.send('Line 2');
    await wait(30);

    const output = getCleanOutput();
    expect(output).toContain('Line 1');
    expect(output).toContain('Line 2');
    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
  });

  it('TC-COMPOSER-12: Extreme paste input (>5,000 characters) handled safely without throwing', async () => {
    const onSubmit = vi.fn();
    const hugeInput = 'A'.repeat(6000);
    const { stdin, wait, getCleanOutput, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} />
    );

    expect(() => stdin.send(hugeInput)).not.toThrow();
    await wait(50);

    const output = getCleanOutput();
    expect(output.length).toBeGreaterThan(0);
    unmount();
  });

  it('TC-COMPOSER-13: Displays helpful error on unknown slash command', async () => {
    const onSubmit = vi.fn();
    const { stdin, wait, getCleanOutput, unmount } = renderTUI(
      <Composer onSubmit={onSubmit} />
    );

    stdin.send('/unknowncmd');
    await wait(30);
    stdin.sendEnter();
    await wait(30);

    const output = getCleanOutput();
    expect(output).toContain("Unknown command '/unknowncmd'. Type /help for available commands.");
    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
  });

  it('TC-COMPOSER-14: Slash command parsing and execution helpers', () => {
    const parsed = parseSlashCommand('/pods -n staging --filter redis');
    expect(parsed).toEqual({
      isSlash: true,
      command: '/pods',
      args: ['-n', 'staging', '--filter', 'redis'],
      raw: '/pods -n staging --filter redis',
    });

    expect(parseSlashCommand('normal text')).toBeNull();

    expect(executeSlashCommand('/pods').success).toBe(true);
    expect(executeSlashCommand('/unknown').success).toBe(false);
  });
});
