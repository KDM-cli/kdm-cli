import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommand } from '../commands/health';
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

  it('should call logger.info on health <target>', async () => {
    await program.parseAsync(['node', 'test', 'health', 'all']);
    expect(logger.info).toHaveBeenCalledWith('Showing health for all...');
  });
});
