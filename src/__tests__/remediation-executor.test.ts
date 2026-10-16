import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  executeRemediationCommand,
  executeRemediationWithFeedback,
  splitCommand,
  formatApplyingFeedback,
  formatExecutionFeedback,
  RemediationAuditTrail,
  defaultAuditTrail,
  DEFAULT_TIMEOUT_MS,
  type ExecutionResult,
} from '../remediation/executor';

describe('Remediation Executor — splitCommand', () => {
  it('parses executable and arguments correctly', () => {
    const cmd = 'kubectl set resources deployment checkout-api --limits=memory=512Mi';
    const { file, args } = splitCommand(cmd);

    expect(file).toBe('kubectl');
    expect(args).toEqual([
      'set',
      'resources',
      'deployment',
      'checkout-api',
      '--limits=memory=512Mi',
    ]);
  });

  it('safely handles quoted arguments with spaces', () => {
    const cmd = 'kubectl patch deployment checkout-api -p "{\\"spec\\": {\\"replicas\\": 2}}"';
    const { file, args } = splitCommand(cmd);

    expect(file).toBe('kubectl');
    expect(args).toEqual([
      'patch',
      'deployment',
      'checkout-api',
      '-p',
      '{\\"spec\\": {\\"replicas\\": 2}}',
    ]);
  });

  it('returns empty file and args for empty or whitespace-only strings', () => {
    expect(splitCommand('')).toEqual({ file: '', args: [] });
    expect(splitCommand('   \t  \n ')).toEqual({ file: '', args: [] });
  });

  it('preserves single-quoted arguments without shell interpretation', () => {
    const cmd = "kubectl annotate pod api-pod 'kdm.io/managed-by=kdm'";
    const { file, args } = splitCommand(cmd);

    expect(file).toBe('kubectl');
    expect(args).toEqual(['annotate', 'pod', 'api-pod', 'kdm.io/managed-by=kdm']);
  });
});

describe('Remediation Executor — executeRemediationCommand', () => {
  beforeEach(() => {
    defaultAuditTrail.clear();
  });

  it('executes command successfully and captures output and duration', async () => {
    const cmd = `node -e "console.log('deployment.apps/checkout-api resource requirements updated')"`;
    const result = await executeRemediationCommand(cmd);

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('deployment.apps/checkout-api resource requirements updated');
    expect(result.stderr).toBe('');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures non-zero exit code and stderr on failure', async () => {
    const cmd = `node -e "process.stderr.write('Error from server (NotFound): deployments.apps \\"checkout-api\\" not found'); process.exit(1)"`;
    const rollback = 'kubectl rollout undo deployment/checkout-api -n production';
    const result = await executeRemediationCommand(cmd, { rollbackCommand: rollback });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('deployments.apps "checkout-api" not found');
    expect(result.rollbackCommand).toBe(rollback);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('enforces execution timeout properly', async () => {
    const cmd = `node -e "setTimeout(() => {}, 5000)"`;
    const result = await executeRemediationCommand(cmd, { timeoutMs: 150 });

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(50);
  });

  it('rejects empty command strings gracefully', async () => {
    const result = await executeRemediationCommand('   ');

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Command string cannot be empty');
  });

  it('uses DEFAULT_TIMEOUT_MS when not explicitly provided', async () => {
    let capturedTimeout = 0;
    const mockExec = vi.fn().mockImplementation((_file, _args, options) => {
      capturedTimeout = options.timeout;
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    const result = await executeRemediationCommand('kubectl version', {
      execFileFn: mockExec,
    });

    expect(result.success).toBe(true);
    expect(capturedTimeout).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('prevents shell injection by passing tokens as discrete arguments', async () => {
    let capturedFile = '';
    let capturedArgs: string[] = [];

    const mockExec = vi.fn().mockImplementation((file, args) => {
      capturedFile = file;
      capturedArgs = args;
      return Promise.resolve({ stdout: 'patched', stderr: '' });
    });

    const maliciousCmd = 'kubectl set resources deployment checkout-api ; rm -rf /';
    await executeRemediationCommand(maliciousCmd, { execFileFn: mockExec });

    expect(capturedFile).toBe('kubectl');
    expect(capturedArgs).toContain(';');
    expect(capturedArgs).toContain('rm');
    expect(capturedArgs).toContain('-rf');
  });
});

describe('Remediation Executor — Feedback Formatting', () => {
  it('formats initial applying remediation message correctly', () => {
    const cmd = 'kubectl set resources deployment checkout-api --limits=memory=512Mi';
    const lines = formatApplyingFeedback(cmd);

    expect(lines[0]).toBe('⚡ Applying remediation...');
    expect(lines[1]).toBe(`   $ ${cmd}`);
  });

  it('formats full execution feedback on success with stdout details', () => {
    const successRes: ExecutionResult = {
      success: true,
      exitCode: 0,
      stdout: 'resource requirements updated',
      stderr: '',
      durationMs: 320,
    };
    const successLines = formatExecutionFeedback(successRes);
    expect(successLines).toEqual([
      '✓ Command succeeded in 320ms: resource requirements updated',
    ]);
  });

  it('formats full execution feedback on success without stdout', () => {
    const successRes: ExecutionResult = {
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 150,
    };
    const successLines = formatExecutionFeedback(successRes);
    expect(successLines).toEqual(['✓ Command succeeded in 150ms']);
  });

  it('formats full execution feedback on failure with rollback recommendation', () => {
    const failureRes: ExecutionResult = {
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Error from server (NotFound): deployments.apps "checkout-api" not found',
      durationMs: 410,
    };
    const rollback = 'kubectl rollout undo deployment/checkout-api -n production';
    const failureLines = formatExecutionFeedback(failureRes, rollback);

    expect(failureLines).toHaveLength(2);
    expect(failureLines[0]).toBe(
      '✖ Command failed (exit code 1): Error from server (NotFound): deployments.apps "checkout-api" not found'
    );
    expect(failureLines[1]).toBe(`⚠️ Recommended Rollback: ${rollback}`);
  });

  it('executes with feedback and streams lines to printFn', async () => {
    const printed: string[] = [];
    const printFn = (line: string) => printed.push(line);

    const cmd = `node -e "console.log('deployment updated')"`;
    const result = await executeRemediationWithFeedback(cmd, { printFn });

    expect(result.success).toBe(true);
    expect(printed).toHaveLength(3);
    expect(printed[0]).toBe('⚡ Applying remediation...');
    expect(printed[1]).toBe(`   $ ${cmd}`);
    expect(printed[2]).toContain('✓ Command succeeded in');
    expect(printed[2]).toContain('deployment updated');
  });
});

describe('Remediation Executor — Audit Logging Trail', () => {
  it('records execution details into audit trail', async () => {
    const customTrail = new RemediationAuditTrail();
    const cmd = `node -e "console.log('audited action')"`;

    const result = await executeRemediationCommand(cmd, {
      auditTrail: customTrail,
      rollbackCommand: 'kubectl rollout undo deployment/test',
    });

    const records = customTrail.getRecords();
    expect(records).toHaveLength(1);
    expect(records[0].command).toBe(cmd);
    expect(records[0].executable).toBe('node');
    expect(records[0].args).toHaveLength(2);
    expect(records[0].success).toBe(true);
    expect(records[0].exitCode).toBe(0);
    expect(records[0].stdout).toBe('audited action');
    expect(records[0].rollbackCommand).toBe('kubectl rollout undo deployment/test');
    expect(records[0].auditId).toMatch(/^audit-rem-\d+-[a-z0-9]+$/);
    expect(records[0].timestamp).toBeDefined();

    const json = customTrail.exportJson(2);
    expect(json).toContain('audit-rem-');
    expect(json).toContain('audited action');

    customTrail.clear();
    expect(customTrail.getRecords()).toHaveLength(0);
  });
});
