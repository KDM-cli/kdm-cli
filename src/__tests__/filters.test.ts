import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerFiltersCommand } from '../commands/filters';
import { getActiveFilters, setActiveFilters } from '../config/store';

vi.mock('../config/store', () => ({
  getActiveFilters: vi.fn(() => []),
  setActiveFilters: vi.fn(),
}));

describe('filters command', () => {
  let program: Command;
  let logSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    registerFiltersCommand(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('lists active and available but inactive filters with empty activeFilters', async () => {
    await program.parseAsync(['node', 'test', 'filters', 'list']);
    expect(getActiveFilters).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Active filters:'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- Pod'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- Deployment'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Available but inactive filters:'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- ReplicaSet'));
  });

  it('lists active and available but inactive filters with explicit activeFilters', async () => {
    vi.mocked(getActiveFilters).mockReturnValueOnce(['Pod']);
    await program.parseAsync(['node', 'test', 'filters', 'list']);
    
    const calls = logSpy.mock.calls.map((c: any) => c[0]);
    const activeIndex = calls.indexOf('Active filters:');
    const inactiveIndex = calls.indexOf('Available but inactive filters:');
    
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    expect(inactiveIndex).toBeGreaterThanOrEqual(0);
    
    const podIndex = calls.indexOf('- Pod');
    expect(podIndex).toBeGreaterThan(activeIndex);
    expect(podIndex).toBeLessThan(inactiveIndex);
    
    const depIndex = calls.indexOf('- Deployment');
    expect(depIndex).toBeGreaterThan(inactiveIndex);
  });

  it('adds a valid filter successfully', async () => {
    vi.mocked(getActiveFilters).mockReturnValueOnce(['Pod']);
    await program.parseAsync(['node', 'test', 'filters', 'add', 'Deployment']);
    expect(setActiveFilters).toHaveBeenCalledWith(['Pod', 'Deployment']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Successfully added filter "Deployment"'));
  });

  it('reports duplicate filter adds', async () => {
    vi.mocked(getActiveFilters).mockReturnValueOnce(['Pod']);
    await program.parseAsync(['node', 'test', 'filters', 'add', 'Pod']);
    expect(setActiveFilters).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('is already active'));
  });

  it('rejects an invalid filter name on add', async () => {
    await program.parseAsync(['node', 'test', 'filters', 'add', 'InvalidName']);
    expect(setActiveFilters).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown filter name'));
    expect(process.exitCode).toBe(1);
  });

  it('removes an active filter', async () => {
    vi.mocked(getActiveFilters).mockReturnValueOnce(['Pod', 'Deployment']);
    await program.parseAsync(['node', 'test', 'filters', 'remove', 'Pod']);
    expect(setActiveFilters).toHaveBeenCalledWith(['Deployment']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Successfully removed filter "Pod"'));
  });

  it('reports no-op when removing an inactive filter', async () => {
    vi.mocked(getActiveFilters).mockReturnValueOnce(['Pod']);
    await program.parseAsync(['node', 'test', 'filters', 'remove', 'Deployment']);
    expect(setActiveFilters).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('is not currently active'));
  });

  it('removes a default filter when activeFilters is empty', async () => {
    vi.mocked(getActiveFilters).mockReturnValueOnce([]);
    await program.parseAsync(['node', 'test', 'filters', 'remove', 'Pod']);
    expect(setActiveFilters).toHaveBeenCalledWith([
      'Deployment',
      'Service',
      'PersistentVolumeClaim',
      'Node',
    ]);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Successfully removed default filter "Pod"'),
    );
  });

  it('reports error when removing an invalid filter', async () => {
    await program.parseAsync(['node', 'test', 'filters', 'remove', 'InvalidName']);
    expect(setActiveFilters).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown filter name'));
    expect(process.exitCode).toBe(1);
  });

  it('exits with error when launched without a TTY terminal', async () => {
    const origStdoutTTY = process.stdout.isTTY;
    const origStdinTTY = process.stdin.isTTY;
    process.stdout.isTTY = false as any;
    process.stdin.isTTY = false as any;

    try {
      await program.parseAsync(['node', 'test', 'filters']);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Interactive filters dashboard requires a TTY terminal.'),
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.stdout.isTTY = origStdoutTTY;
      process.stdin.isTTY = origStdinTTY;
    }
  });
});
