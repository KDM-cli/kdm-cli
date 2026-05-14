import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerLogsCommand } from '../commands/logs';
import { logger } from '../utils/logger';

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}));

vi.mock('../ui/spinner', () => ({
  createSpinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

describe('logs command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    registerLogsCommand(program);
  });

  it('should register logs command', () => {
    const logsCmd = program.commands.find((c) => c.name() === 'logs');
    expect(logsCmd).toBeDefined();
  });

  it('should call logger.info on logs <name>', async () => {
    await program.parseAsync(['node', 'test', 'logs', 'my-pod']);
    expect(logger.info).toHaveBeenCalledWith('Showing logs for my-pod...');
  });
});
