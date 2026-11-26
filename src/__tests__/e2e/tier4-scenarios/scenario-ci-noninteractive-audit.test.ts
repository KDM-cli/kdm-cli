import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCLI, MockClusterEnvironment } from '../harness';

describe('Tier 4: Scenario 4 — Non-Interactive CI Automation: Cluster Health & Log Audit', () => {
  let cluster: MockClusterEnvironment | null = null;
  let tmpDir = '';

  afterEach(() => {
    if (cluster) {
      cluster.reset();
      cluster = null;
    }
    MockClusterEnvironment.resetActive();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('executes headless CI audit with pure JSON stdout, audit trail export, and clean zero exit', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdm-ci-audit-'));
    const auditExportPath = path.join(tmpDir, 'audit-session.json');

    cluster = new MockClusterEnvironment().setHealthyScenario().install();

    const result = await runCLI(
      [
        'analyze',
        '--output',
        'json',
        '--namespace',
        'staging',
        '--council-timeout',
        '10000',
        '--export-audit',
        auditExportPath,
      ],
      { isTTY: false }
    );

    // 1. Process exit code must be 0
    expect(result.exitCode).toBe(0);

    // 2. stdout must not contain ANSI escape sequences
    expect(result.stdout).not.toContain('\u001b');

    // 3. stdout must be pure valid JSON directly without substring slicing
    expect(result.stdout.trim().startsWith('{')).toBe(true);
    const parsedOutput = JSON.parse(result.stdout.trim());

    expect(parsedOutput).toBeDefined();
    expect(['OK', 'ProblemDetected']).toContain(parsedOutput.status);
    expect(typeof parsedOutput.problems).toBe('number');

    // 4. Verify audit file was exported and contains valid JSON
    expect(fs.existsSync(auditExportPath)).toBe(true);
    const auditContent = JSON.parse(fs.readFileSync(auditExportPath, 'utf-8'));
    expect(auditContent).toBeDefined();
    expect(auditContent.sessionId).toBeDefined();
    expect(auditContent.timestamp).toBeDefined();
    expect(auditContent.target).toBeDefined();
  });
});
