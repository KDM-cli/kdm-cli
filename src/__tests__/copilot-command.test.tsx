import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerCopilotCommand } from '../commands/copilot';
import React from 'react';
import { render } from 'ink';

// Mock process.stdout.write
const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

vi.mock('ink', async () => {
  const actual = await vi.importActual<any>('ink');
  return {
    ...actual,
    render: vi.fn().mockReturnValue({
      unmount: vi.fn(),
      waitUntilExit: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

vi.mock('../ui/CopilotShell', () => ({
  CopilotShell: () => null,
}));

describe('copilot command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    registerCopilotCommand(program);
  });

  it('should register copilot command and aliases', () => {
    const copilotCmd = program.commands.find((c) => c.name() === 'copilot');
    expect(copilotCmd).toBeDefined();
    expect(copilotCmd?.aliases()).toContain('agent');
    expect(copilotCmd?.aliases()).toContain('chat');
  });

  it('should clear screen and render CopilotShell on copilot', async () => {
    await program.parseAsync(['node', 'test', 'copilot', 'deployment/checkout-api', '--tab', '2']);
    expect(stdoutWriteSpy).toHaveBeenCalledWith('\x1Bc');
    expect(render).toHaveBeenCalled();
  });
});
