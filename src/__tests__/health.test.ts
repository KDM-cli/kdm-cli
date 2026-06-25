import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommand, showHealth } from '../commands/health';
import { getRunningContainers } from '../docker/containers';
import { getRunningPods } from '../kubernetes/pods';
import { logger } from '../utils/logger';
import * as tableUtils from '../ui/table';

vi.mock('../docker/containers', () => ({ getRunningContainers: vi.fn() }));
vi.mock('../kubernetes/pods',   () => ({ getRunningPods: vi.fn() }));
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../ui/spinner', () => ({
  createSpinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop:  vi.fn().mockReturnThis(),
  })),
}));
vi.mock('../ui/table', () => ({ renderTable: vi.fn() }));

describe('health command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    registerHealthCommand(program);
  });

  it('should register the health command', () => {
    const healthCmd = program.commands.find((c) => c.name() === 'health');
    expect(healthCmd).toBeDefined();
  });

  it('should render a table with containers and pods for "health all"', async () => {
    vi.mocked(getRunningContainers).mockResolvedValue([
      { id: '1', name: 'web', image: 'nginx', state: 'running', status: 'Up 2 hours' },
    ]);
    vi.mocked(getRunningPods).mockResolvedValue([
      { name: 'api', namespace: 'default', status: 'Running', restarts: 0 },
    ]);

    await program.parseAsync(['node', 'test', 'health', 'all']);

    expect(getRunningContainers).toHaveBeenCalledWith({ forceAlert: true });
    expect(getRunningPods).toHaveBeenCalledWith({ forceAlert: true });
    expect(logger.info).toHaveBeenCalledWith('Showing health for all...');
    expect(tableUtils.renderTable).toHaveBeenCalledWith(
      expect.objectContaining({
        head: ['TYPE', 'NAME', 'HEALTH', 'DETAILS'],
        rows: expect.arrayContaining([
          expect.arrayContaining(['container', 'web']),
          expect.arrayContaining(['pod', 'api']),
        ]),
      }),
    );
  });

  it('should render only containers when target is "containers"', async () => {
    vi.mocked(getRunningContainers).mockResolvedValue([
      { id: '2', name: 'nginx', image: 'nginx', state: 'running', status: 'Up 5 minutes' },
    ]);

    await program.parseAsync(['node', 'test', 'health', 'containers']);

    expect(getRunningPods).not.toHaveBeenCalled();
    expect(tableUtils.renderTable).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: expect.arrayContaining([
          expect.arrayContaining(['container', 'nginx']),
        ]),
      }),
    );
  });

  it('should render only pods when target is "pods"', async () => {
    vi.mocked(getRunningPods).mockResolvedValue([
      { name: 'worker', namespace: 'staging', status: 'Running', restarts: 1 },
    ]);

    await program.parseAsync(['node', 'test', 'health', 'pods']);

    expect(getRunningContainers).not.toHaveBeenCalled();
    expect(tableUtils.renderTable).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: expect.arrayContaining([
          expect.arrayContaining(['pod', 'worker']),
        ]),
      }),
    );
  });

  it('should warn and NOT render a table when no workloads are found', async () => {
    vi.mocked(getRunningContainers).mockResolvedValue([]);
    vi.mocked(getRunningPods).mockResolvedValue([]);

    await program.parseAsync(['node', 'test', 'health', 'all']);

    expect(logger.warn).toHaveBeenCalledWith('No workloads found.');
    expect(tableUtils.renderTable).not.toHaveBeenCalled();
  });

  it('should log an error for unknown targets', async () => {
    await program.parseAsync(['node', 'test', 'health', 'bad-target']);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown target'),
    );
    expect(tableUtils.renderTable).not.toHaveBeenCalled();
  });

  it('should log a warning when fetching containers throws', async () => {
    vi.mocked(getRunningContainers).mockRejectedValue(new Error('Docker connection failed'));

    await program.parseAsync(['node', 'test', 'health', 'containers']);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Docker unavailable'),
    );
    expect(tableUtils.renderTable).not.toHaveBeenCalled();
  });

  it('should log a warning when fetching pods throws', async () => {
    vi.mocked(getRunningContainers).mockResolvedValue([]);
    vi.mocked(getRunningPods).mockRejectedValue(new Error('K8s API unreachable'));

    await program.parseAsync(['node', 'test', 'health', 'pods']);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Kubernetes unavailable'),
    );
    expect(tableUtils.renderTable).not.toHaveBeenCalled();
  });

  it('should render available pods when containers fail for "health all"', async () => {
    vi.mocked(getRunningContainers).mockRejectedValue(new Error('Docker connection failed'));
    vi.mocked(getRunningPods).mockResolvedValue([
      { name: 'api', namespace: 'default', status: 'Running', restarts: 0 },
    ]);

    await program.parseAsync(['node', 'test', 'health', 'all']);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Docker unavailable'),
    );
    expect(tableUtils.renderTable).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: expect.arrayContaining([
          expect.arrayContaining(['pod', 'api']),
        ]),
      }),
    );
  });

  it('should register watch and interval options', () => {
    const healthCmd = program.commands.find((c) => c.name() === 'health');
    const watchOption = healthCmd?.options.find((o) => o.short === '-w');
    const intervalOption = healthCmd?.options.find((o) => o.short === '-i');
    expect(watchOption).toBeDefined();
    expect(intervalOption).toBeDefined();
  });

  it('should reject non-integer and malformed intervals strictly', async () => {
    await program.parseAsync(['node', 'test', 'health', 'all', '--watch', '--interval', '-1']);
    expect(logger.error).toHaveBeenLastCalledWith(
      expect.stringContaining('Invalid interval'),
    );

    await program.parseAsync(['node', 'test', 'health', 'all', '--watch', '--interval', '3.5']);
    expect(logger.error).toHaveBeenLastCalledWith(
      expect.stringContaining('Invalid interval'),
    );

    await program.parseAsync(['node', 'test', 'health', 'all', '--watch', '--interval', '3abc']);
    expect(logger.error).toHaveBeenLastCalledWith(
      expect.stringContaining('Invalid interval'),
    );
  });

  it('should poll health status periodically in watch mode', async () => {
    vi.useFakeTimers();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    vi.mocked(getRunningContainers).mockResolvedValue([
      { id: '1', name: 'web', image: 'nginx', state: 'running', status: 'Up 2 hours' },
    ]);
    vi.mocked(getRunningPods).mockResolvedValue([]);

    // Parse to run the watch mode command
    await program.parseAsync(['node', 'test', 'health', 'all', '--watch', '--interval', '3']);
    
    expect(tableUtils.renderTable).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith('\x1Bc');

    // Change mock status to verify the next iteration
    vi.mocked(getRunningContainers).mockResolvedValue([
      { id: '1', name: 'web', image: 'nginx', state: 'exited', status: 'Exited' },
    ]);

    // Advance timer by 3 seconds (3000ms)
    await vi.advanceTimersByTimeAsync(3000);

    expect(tableUtils.renderTable).toHaveBeenCalledTimes(2);
    expect(tableUtils.renderTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rows: expect.arrayContaining([
          expect.arrayContaining(['container', 'web', expect.stringContaining('exited')]),
        ]),
      }),
    );

    // Clean up
    writeSpy.mockRestore();
    vi.useRealTimers();
  });

  it('should stop watch loop when AbortSignal is aborted', async () => {
    vi.useFakeTimers();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    vi.mocked(getRunningContainers).mockResolvedValue([
      { id: '1', name: 'web', image: 'nginx', state: 'running', status: 'Up 2 hours' },
    ]);
    vi.mocked(getRunningPods).mockResolvedValue([]);

    const controller = new AbortController();
    
    // Call showHealth directly with the signal and await the first poll tick
    await showHealth('all', { watch: true, interval: '3', signal: controller.signal });

    expect(tableUtils.renderTable).toHaveBeenCalledTimes(1);

    // Now abort the controller
    controller.abort();

    // Advance timers by 3 seconds
    await vi.advanceTimersByTimeAsync(3000);

    // It should NOT call renderTable again because it was aborted
    expect(tableUtils.renderTable).toHaveBeenCalledTimes(1);

    // Clean up
    writeSpy.mockRestore();
    vi.useRealTimers();
  });
});