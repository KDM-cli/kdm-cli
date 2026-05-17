// import { describe, it, expect, vi, beforeEach } from 'vitest';
// import { Command } from 'commander';
// import { registerHealthCommand } from '../commands/health';
// import { logger } from '../utils/logger';

// vi.mock('../utils/logger', () => ({
//   logger: {
//     info: vi.fn(),
//   },
// }));

// vi.mock('../ui/spinner', () => ({
//   createSpinner: vi.fn(() => ({
//     start: vi.fn().mockReturnThis(),
//     stop: vi.fn().mockReturnThis(),
//     fail: vi.fn().mockReturnThis(),
//   })),
// }));

// describe('health command', () => {
//   let program: Command;

//   beforeEach(() => {
//     vi.clearAllMocks();
//     program = new Command();
//     registerHealthCommand(program);
//   });

//   it('should register health command', () => {
//     const healthCmd = program.commands.find((c) => c.name() === 'health');
//     expect(healthCmd).toBeDefined();
//   });

//   it('should call logger.info on health <target>', async () => {
//     await program.parseAsync(['node', 'test', 'health', 'all']);
//     expect(logger.info).toHaveBeenCalledWith('Showing health for all...');
//   });
// });


// updated

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommand } from '../commands/health';
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
});