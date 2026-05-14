import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommand } from '../commands/health';
import { getRunningContainers } from '../docker/containers';
import { getRunningPods } from '../kubernetes/pods';
import { logger } from '../utils/logger';
import * as tableUtils from '../ui/table';

vi.mock('../docker/containers', () => ({
  getRunningContainers: vi.fn(),
}));
vi.mock('../kubernetes/pods', () => ({
  getRunningPods: vi.fn(),
}));
vi.mock('../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../ui/spinner', () => ({
  createSpinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));
vi.mock('../ui/table', () => ({
  renderTable: vi.fn(),
}));

describe('health command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    registerHealthCommand(program);
  });

  it('should register health command', () => {
    const healthCmd = program.commands.find((c) => c.name() === 'health');
    expect(healthCmd).toBeDefined();
  });

  it('should render health for all workloads', async () => {
    (getRunningContainers as any).mockResolvedValue([{ name: 'web', state: 'running', status: 'Up' }]);
    (getRunningPods as any).mockResolvedValue([{ name: 'api', namespace: 'default', status: 'Running', restarts: 0 }]);

    await program.parseAsync(['node', 'test', 'health', 'all']);

    expect(tableUtils.renderTable).toHaveBeenCalledWith(expect.objectContaining({
      head: ['TYPE', 'NAME', 'HEALTH', 'DETAILS'],
      rows: expect.arrayContaining([
        expect.arrayContaining(['container', 'web']),
        expect.arrayContaining(['pod', 'api']),
      ]),
    }));
  });

  it('should reject unknown health targets', async () => {
    await program.parseAsync(['node', 'test', 'health', 'bad-target']);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Unknown target'));
  });
});
