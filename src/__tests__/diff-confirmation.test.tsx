import React, { useState, useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { Text } from 'ink';
import { renderTUI, stripAnsi } from './e2e/harness/tui-test-utils.js';
import {
  DiffRenderer,
  parseDiffWithLineNumbers,
} from '../ui/components/DiffRenderer.js';
import {
  ToolConfirmationQueue,
  evaluateSafetyPolicy,
  type ConfirmationRequest,
} from '../ui/components/ToolConfirmationQueue.js';
import { UIStateProvider, useUIState } from '../ui/contexts/UIStateContext.js';

describe('F-07: Manifest Diff & Confirmation Queue', () => {
  it('TC-DIFF-01: Unified diff header and color-coded lines (DiffRenderer)', () => {
    const sampleDiff =
      '--- deployment.yaml\n+++ deployment.yaml.patched\n@@ -10,4 +10,4 @@\n-      memory: 512Mi\n+      memory: 1024Mi\n';

    const { getCleanOutput, unmount } = renderTUI(<DiffRenderer diff={sampleDiff} />);
    const output = getCleanOutput();

    expect(output).toContain('── Manifest Unified Diff ───────────────────');
    expect(output).toContain('--- deployment.yaml');
    expect(output).toContain('+++ deployment.yaml.patched');
    expect(output).toContain('@@ -10,4 +10,4 @@');
    expect(output).toContain('-      memory: 512Mi');
    expect(output).toContain('+      memory: 1024Mi');
    unmount();
  });

  it('TC-DIFF-02: Empty diff displays clean notice', () => {
    const { getCleanOutput, unmount } = renderTUI(<DiffRenderer diff="" />);
    const output = getCleanOutput();
    expect(output).toContain('No configuration differences detected.');
    unmount();

    const { getCleanOutput: getCleanWhitespace, unmount: unmountWs } = renderTUI(
      <DiffRenderer diff="   \n  " />
    );
    expect(getCleanWhitespace()).toContain('No configuration differences detected.');
    unmountWs();
  });

  it('TC-DIFF-03: Max lines truncation renders ... and X more lines', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `+ line #${i + 1}`);
    const longDiff = lines.join('\n');

    const { getCleanOutput, unmount } = renderTUI(
      <DiffRenderer diff={longDiff} maxLines={20} />
    );

    const output = getCleanOutput();
    expect(output).toContain('+ line #1');
    expect(output).toContain('+ line #20');
    expect(output).toContain('... and 40 more lines');
    expect(output).not.toContain('+ line #25');
    unmount();
  });

  it('TC-DIFF-04: Line numbers gutter and parseDiffWithLineNumbers helper', () => {
    const sampleDiff =
      '@@ -5,2 +5,2 @@\n-old line\n+new line\n context line\n';

    const parsed = parseDiffWithLineNumbers(sampleDiff);
    expect(parsed.length).toBeGreaterThanOrEqual(3);
    expect(parsed.some((p) => p.type === 'del' && p.oldLine === 5)).toBe(true);
    expect(parsed.some((p) => p.type === 'add' && p.newLine === 5)).toBe(true);

    const { getCleanOutput, unmount } = renderTUI(
      <DiffRenderer diff={sampleDiff} showLineNumbers={true} />
    );

    const output = getCleanOutput();
    expect(output).toContain('5');
    expect(output).toContain('-old line');
    expect(output).toContain('+new line');
    unmount();
  });

  it('TC-DIFF-05: Risk level badge HIGH renders [HIGH RISK ACTION REQUIRED]', () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-001',
      toolName: 'k8s_delete_pod',
      args: { pod: 'auth-svc-7f89' },
      riskLevel: 'high',
      prompt: 'Permanently delete pod auth-svc-7f89 to trigger restart?',
    };

    const onDecision = vi.fn();
    const { getCleanOutput, unmount } = renderTUI(
      <ToolConfirmationQueue request={request} onDecision={onDecision} />
    );

    const output = getCleanOutput();
    expect(output).toContain('[HIGH RISK ACTION REQUIRED]');
    expect(output).toContain('conf-req-001');
    expect(output).toContain('k8s_delete_pod');
    expect(output).toContain('Permanently delete pod');
    unmount();
  });

  it('TC-DIFF-06: Risk level badge MEDIUM renders [MEDIUM RISK ACTION REQUIRED]', () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-002',
      toolName: 'k8s_apply_patch',
      args: { resource: 'payment-service', namespace: 'default' },
      riskLevel: 'medium',
      prompt: 'Apply memory limit increase to 1024Mi?',
    };

    const onDecision = vi.fn();
    const { getCleanOutput, unmount } = renderTUI(
      <ToolConfirmationQueue request={request} onDecision={onDecision} />
    );

    const output = getCleanOutput();
    expect(output).toContain('[MEDIUM RISK ACTION REQUIRED]');
    expect(output).toContain('conf-req-002');
    unmount();
  });

  it('TC-DIFF-07: Risk level badge LOW renders [LOW RISK ACTION REQUIRED]', () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-003',
      toolName: 'k8s_label_pod',
      args: { pod: 'checkout-api', label: 'diagnose=active' },
      riskLevel: 'low',
      prompt: 'Attach diagnostic label to pod?',
    };

    const onDecision = vi.fn();
    const { getCleanOutput, unmount } = renderTUI(
      <ToolConfirmationQueue request={request} onDecision={onDecision} />
    );

    const output = getCleanOutput();
    expect(output).toContain('[LOW RISK ACTION REQUIRED]');
    expect(output).toContain('conf-req-003');
    unmount();
  });

  it('TC-DIFF-08: Interactive approval flow ("y" / "Y" keypress -> ALLOW)', async () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-allow',
      toolName: 'k8s_apply_patch',
      args: { file: 'patch.yaml' },
      riskLevel: 'medium',
      prompt: 'Approve rollout patch?',
    };

    const onDecision = vi.fn();
    const { stdin, wait, unmount } = renderTUI(
      <ToolConfirmationQueue request={request} onDecision={onDecision} />
    );

    stdin.send('y');
    await wait(30);

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith('ALLOW', request);
    unmount();
  });

  it('TC-DIFF-09: Interactive denial flow ("n" keypress or Enter -> DENY)', async () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-deny',
      toolName: 'docker_rm',
      args: { container: 'db-local' },
      riskLevel: 'high',
      prompt: 'Force delete container?',
    };

    const onDecision = vi.fn();
    const { stdin, wait, unmount } = renderTUI(
      <ToolConfirmationQueue request={request} onDecision={onDecision} />
    );

    stdin.send('n');
    await wait(30);

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith('DENY', request);
    unmount();

    // Default Enter also triggers DENY
    const onEnterDecision = vi.fn();
    const { stdin: stdinEnter, wait: waitEnter, unmount: unmountEnter } = renderTUI(
      <ToolConfirmationQueue request={request} onDecision={onEnterDecision} />
    );

    stdinEnter.sendEnter();
    await waitEnter(30);

    expect(onEnterDecision).toHaveBeenCalledTimes(1);
    expect(onEnterDecision).toHaveBeenCalledWith('DENY', request);
    unmountEnter();
  });

  it('TC-DIFF-10: Interactive edit flow ("e" keypress -> EDIT)', async () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-edit',
      toolName: 'k8s_apply_patch',
      args: { memory: '2Gi' },
      riskLevel: 'medium',
      prompt: 'Review and edit configuration before apply?',
    };

    const onDecision = vi.fn();
    const { stdin, wait, unmount } = renderTUI(
      <ToolConfirmationQueue request={request} onDecision={onDecision} />
    );

    stdin.send('e');
    await wait(30);

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith('EDIT', request);
    unmount();
  });

  it('TC-DIFF-11: Destructive safety policy auto-blocks hazardous commands', async () => {
    expect(evaluateSafetyPolicy('rm -rf /').allowed).toBe(false);
    expect(evaluateSafetyPolicy('kubectl delete namespace kube-system').allowed).toBe(false);
    expect(evaluateSafetyPolicy('kubectl delete namespace default').allowed).toBe(false);
    expect(evaluateSafetyPolicy('kubectl delete namespace production').allowed).toBe(false);
    expect(evaluateSafetyPolicy('mkfs.ext4 /dev/sda1').allowed).toBe(false);
    expect(evaluateSafetyPolicy('kubectl get pods').allowed).toBe(true);

    const destructiveRequest: ConfirmationRequest = {
      id: 'destructive-001',
      toolName: 'exec_command',
      args: { command: 'rm -rf / --no-preserve-root' },
      riskLevel: 'high',
      prompt: 'Execute destructive root deletion?',
    };

    const onDecision = vi.fn();
    const { stdin, wait, getCleanOutput, unmount } = renderTUI(
      <ToolConfirmationQueue request={destructiveRequest} onDecision={onDecision} />
    );

    const output = getCleanOutput();
    expect(output).toContain('⛔ POLICY VIOLATION: COMMAND BLOCKED');
    expect(output).toContain('Destructive command permanently blocked by safety policy');

    // Attempting to type 'y' does NOT trigger approval
    stdin.send('y');
    await wait(30);
    expect(onDecision).not.toHaveBeenCalled();

    unmount();
  });

  it('TC-DIFF-12: Multi-item queue progression', async () => {
    const queue: ConfirmationRequest[] = [
      {
        id: 'req-multi-1',
        toolName: 'patch_memory',
        args: { limit: '1024Mi' },
        riskLevel: 'medium',
        prompt: 'First remediation patch',
      },
      {
        id: 'req-multi-2',
        toolName: 'patch_cpu',
        args: { limit: '2000m' },
        riskLevel: 'low',
        prompt: 'Second remediation patch',
      },
    ];

    const onDecision = vi.fn();
    const { stdin, wait, getLastFrame, unmount } = renderTUI(
      <ToolConfirmationQueue queue={queue} onDecision={onDecision} />
    );

    expect(stripAnsi(getLastFrame())).toContain('Queue: 1 of 2');
    expect(stripAnsi(getLastFrame())).toContain('req-multi-1');

    // Approve first request
    stdin.send('y');
    await wait(50);

    expect(onDecision).toHaveBeenCalledWith('ALLOW', queue[0]);

    // UI advances to second request
    expect(stripAnsi(getLastFrame())).toContain('Queue: 2 of 2');
    expect(stripAnsi(getLastFrame())).toContain('req-multi-2');

    // Deny second request
    stdin.send('n');
    await wait(50);

    expect(onDecision).toHaveBeenCalledWith('DENY', queue[1]);
    unmount();
  });

  it('TC-DIFF-13: Unrecognized keystrokes are ignored; prompt remains active', async () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-ignore',
      toolName: 'k8s_patch',
      args: {},
      riskLevel: 'low',
      prompt: 'Awaiting operator input',
    };

    const onDecision = vi.fn();
    const { stdin, wait, getCleanOutput, unmount } = renderTUI(
      <ToolConfirmationQueue request={request} onDecision={onDecision} />
    );

    // Send random unmapped keys
    stdin.send('x');
    await wait(20);
    stdin.send('1');
    await wait(20);
    stdin.send(' ');
    await wait(20);

    expect(onDecision).not.toHaveBeenCalled();

    // Now send 'y'
    stdin.send('y');
    await wait(30);
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith('ALLOW', request);

    unmount();
  });

  it('TC-DIFF-14: SIGINT (Ctrl+C) records denial', async () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-ctrlc',
      toolName: 'k8s_cordon_node',
      args: { node: 'worker-node-1' },
      riskLevel: 'high',
      prompt: 'Cordon node worker-node-1?',
    };

    const onDecision = vi.fn();
    const { stdin, wait, unmount } = renderTUI(
      <ToolConfirmationQueue request={request} onDecision={onDecision} />
    );

    // Send Ctrl+C
    stdin.sendCtrlC();
    await wait(30);

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith('DENY', request);
    unmount();
  });

  it('TC-DIFF-15: Embedded DiffRenderer renders diff inside ToolConfirmationQueue', () => {
    const request: ConfirmationRequest = {
      id: 'conf-req-with-diff',
      toolName: 'k8s_apply_patch',
      args: { file: 'deployment.yaml' },
      diff: '@@ -1,2 +1,2 @@\n- replicas: 1\n+ replicas: 3\n',
      riskLevel: 'medium',
      prompt: 'Scale deployment replicas from 1 to 3?',
    };

    const onDecision = vi.fn();
    const { getCleanOutput, unmount } = renderTUI(
      <ToolConfirmationQueue request={request} onDecision={onDecision} />
    );

    const output = getCleanOutput();
    expect(output).toContain('── Manifest Unified Diff ───────────────────');
    expect(output).toContain('- replicas: 1');
    expect(output).toContain('+ replicas: 3');
    unmount();
  });

  it('TC-DIFF-16: Case-insensitive and flag-tolerant safety policy regex', () => {
    expect(evaluateSafetyPolicy('RM -RF /').allowed).toBe(false);
    expect(evaluateSafetyPolicy('rm -fr /').allowed).toBe(false);
    expect(evaluateSafetyPolicy('rm -r -f /').allowed).toBe(false);
    expect(evaluateSafetyPolicy('rm -f -r /').allowed).toBe(false);
    expect(evaluateSafetyPolicy('rm --recursive --force /').allowed).toBe(false);
    expect(evaluateSafetyPolicy('rm --force --recursive /').allowed).toBe(false);
    expect(evaluateSafetyPolicy('KUBECTL delete namespace kube-system').allowed).toBe(false);
    expect(evaluateSafetyPolicy('kubectl delete ns kube-system').allowed).toBe(false);
    expect(evaluateSafetyPolicy('kubectl delete ns default').allowed).toBe(false);
    expect(evaluateSafetyPolicy('kubectl delete ns production').allowed).toBe(false);
    expect(evaluateSafetyPolicy('MKFS.ext4 /dev/sda1').allowed).toBe(false);
    expect(evaluateSafetyPolicy('DD IF=/dev/zero OF=/dev/sda').allowed).toBe(false);
    expect(evaluateSafetyPolicy('kubectl get pods').allowed).toBe(true);
  });

  it('TC-DIFF-17: Policy-blocked commands permit denial via n, Enter, or Escape, but block approval', async () => {
    const destructiveRequest: ConfirmationRequest = {
      id: 'conf-req-blocked-dismiss',
      toolName: 'bash_exec',
      args: { script: 'rm -rf /' },
      riskLevel: 'high',
      prompt: 'Execute root deletion?',
    };

    // 1. Approval 'y' is blocked
    const onDecisionY = vi.fn();
    const { stdin: stdinY, wait: waitY, unmount: unmountY } = renderTUI(
      <ToolConfirmationQueue request={destructiveRequest} onDecision={onDecisionY} />
    );
    stdinY.send('y');
    await waitY(30);
    expect(onDecisionY).not.toHaveBeenCalled();
    unmountY();

    // 2. Edit 'e' is blocked
    const onDecisionE = vi.fn();
    const { stdin: stdinE, wait: waitE, unmount: unmountE } = renderTUI(
      <ToolConfirmationQueue request={destructiveRequest} onDecision={onDecisionE} />
    );
    stdinE.send('e');
    await waitE(30);
    expect(onDecisionE).not.toHaveBeenCalled();
    unmountE();

    // 3. 'n' dismisses with DENY
    const onDecisionN = vi.fn();
    const { stdin: stdinN, wait: waitN, unmount: unmountN } = renderTUI(
      <ToolConfirmationQueue request={destructiveRequest} onDecision={onDecisionN} />
    );
    stdinN.send('n');
    await waitN(30);
    expect(onDecisionN).toHaveBeenCalledTimes(1);
    expect(onDecisionN).toHaveBeenCalledWith('DENY', destructiveRequest);
    unmountN();

    // 4. Enter dismisses with DENY
    const onDecisionEnter = vi.fn();
    const { stdin: stdinEnter, wait: waitEnter, unmount: unmountEnter } = renderTUI(
      <ToolConfirmationQueue request={destructiveRequest} onDecision={onDecisionEnter} />
    );
    stdinEnter.sendEnter();
    await waitEnter(30);
    expect(onDecisionEnter).toHaveBeenCalledTimes(1);
    expect(onDecisionEnter).toHaveBeenCalledWith('DENY', destructiveRequest);
    unmountEnter();

    // 5. Escape dismisses with DENY
    const onDecisionEsc = vi.fn();
    const { stdin: stdinEsc, wait: waitEsc, unmount: unmountEsc } = renderTUI(
      <ToolConfirmationQueue request={destructiveRequest} onDecision={onDecisionEsc} />
    );
    stdinEsc.sendEscape();
    await waitEsc(30);
    expect(onDecisionEsc).toHaveBeenCalledTimes(1);
    expect(onDecisionEsc).toHaveBeenCalledWith('DENY', destructiveRequest);
    unmountEsc();
  });

  it('TC-DIFF-18: Command inspection across multiple argument keys (script, raw, cmd, command)', () => {
    const reqWithScript: ConfirmationRequest = {
      id: 'req-script',
      toolName: 'bash_exec',
      args: { script: 'rm -rf /' },
      riskLevel: 'high',
      prompt: 'Execute script?',
    };
    const { getCleanOutput: getScriptOutput, unmount: unmountScript } = renderTUI(
      <ToolConfirmationQueue request={reqWithScript} onDecision={vi.fn()} />
    );
    expect(getScriptOutput()).toContain('⛔ POLICY VIOLATION: COMMAND BLOCKED');
    unmountScript();

    const reqWithRaw: ConfirmationRequest = {
      id: 'req-raw',
      toolName: 'sh_exec',
      args: { raw: 'kubectl delete ns kube-system' },
      riskLevel: 'high',
      prompt: 'Execute raw command?',
    };
    const { getCleanOutput: getRawOutput, unmount: unmountRaw } = renderTUI(
      <ToolConfirmationQueue request={reqWithRaw} onDecision={vi.fn()} />
    );
    expect(getRawOutput()).toContain('⛔ POLICY VIOLATION: COMMAND BLOCKED');
    unmountRaw();
  });

  it('TC-DIFF-19: Queue state synchronization with single-request controlled wrapper', async () => {
    const req1: ConfirmationRequest = {
      id: 'req-controlled-1',
      toolName: 'k8s_restart',
      args: { pod: 'pod-1' },
      riskLevel: 'low',
      prompt: 'Restart pod 1?',
    };
    const req2: ConfirmationRequest = {
      id: 'req-controlled-2',
      toolName: 'k8s_restart',
      args: { pod: 'pod-2' },
      riskLevel: 'medium',
      prompt: 'Restart pod 2?',
    };

    const decisions: Array<{ decision: string; id: string }> = [];

    const ControlledWrapper: React.FC = () => {
      const [current, setCurrent] = useState<ConfirmationRequest | undefined>(req1);

      return (
        <ToolConfirmationQueue
          request={current}
          onDecision={(decision, r) => {
            decisions.push({ decision, id: r.id });
            if (r.id === 'req-controlled-1') {
              setCurrent(req2);
            } else {
              setCurrent(undefined);
            }
          }}
        />
      );
    };

    const { stdin, wait, getLastFrame, unmount } = renderTUI(<ControlledWrapper />);

    expect(stripAnsi(getLastFrame())).toContain('Restart pod 1?');

    // Approve first request
    stdin.send('y');
    await wait(50);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toEqual({ decision: 'ALLOW', id: 'req-controlled-1' });

    // UI should now show request 2 and accept input
    expect(stripAnsi(getLastFrame())).toContain('Restart pod 2?');

    // Deny second request
    stdin.send('n');
    await wait(50);

    expect(decisions).toHaveLength(2);
    expect(decisions[1]).toEqual({ decision: 'DENY', id: 'req-controlled-2' });

    unmount();
  });

  it('TC-DIFF-20: Sequential multi-item processing when items are removed via onResolve', async () => {
    const initialQueue: ConfirmationRequest[] = [
      {
        id: 'shift-req-1',
        toolName: 'k8s_scale',
        args: { replicas: 3 },
        riskLevel: 'low',
        prompt: 'Scale service?',
      },
      {
        id: 'shift-req-2',
        toolName: 'k8s_drain',
        args: { node: 'node-2' },
        riskLevel: 'high',
        prompt: 'Drain node 2?',
      },
    ];

    const decisions: Array<{ decision: string; id: string }> = [];

    const ShiftingQueueWrapper: React.FC = () => {
      const [queue, setQueue] = useState(initialQueue);

      return (
        <ToolConfirmationQueue
          queue={queue}
          onDecision={(decision, r) => {
            decisions.push({ decision, id: r.id });
          }}
          onResolve={(id) => {
            setQueue((prev) => prev.filter((item) => item.id !== id));
          }}
        />
      );
    };

    const { stdin, wait, getLastFrame, unmount } = renderTUI(<ShiftingQueueWrapper />);

    expect(stripAnsi(getLastFrame())).toContain('Scale service?');

    stdin.send('y');
    await wait(60);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toEqual({ decision: 'ALLOW', id: 'shift-req-1' });

    // After resolution, second item must be visible and interactive
    expect(stripAnsi(getLastFrame())).toContain('Drain node 2?');

    stdin.send('n');
    await wait(60);

    expect(decisions).toHaveLength(2);
    expect(decisions[1]).toEqual({ decision: 'DENY', id: 'shift-req-2' });

    unmount();
  });

  it('TC-DIFF-21: DiffRenderer handles escaped literal newlines (\\n)', () => {
    const escapedDiff =
      '--- deployment.yaml\\n+++ deployment.yaml.patched\\n@@ -1,2 +1,2 @@\\n-replicas: 1\\n+replicas: 3';

    const { getCleanOutput, unmount } = renderTUI(
      <DiffRenderer diff={escapedDiff} showLineNumbers={true} />
    );

    const output = getCleanOutput();
    expect(output).toContain('--- deployment.yaml');
    expect(output).toContain('+++ deployment.yaml.patched');
    expect(output).toContain('-replicas: 1');
    expect(output).toContain('+replicas: 3');
    unmount();
  });

  it('TC-DIFF-22: Identical file comparison renders empty diff notice', () => {
    const sameContent = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: auth\n';

    const { getCleanOutput, unmount } = renderTUI(
      <DiffRenderer oldContent={sameContent} newContent={sameContent} />
    );

    const output = getCleanOutput();
    expect(output).toContain('No configuration differences detected.');
    expect(output).not.toContain('--- manifest.yaml');
    unmount();
  });

  it('TC-DIFF-23: Line gutter alignment in DiffRenderer with git headers and blank lines', () => {
    const gitDiffWithHeaders =
      'diff --git a/foo.txt b/foo.txt\nnew file mode 100644\nindex 0000000..e69de29\n--- /dev/null\n+++ b/foo.txt\n@@ -0,0 +1,2 @@\n+line 1\n+line 2';

    const parsed = parseDiffWithLineNumbers(gitDiffWithHeaders);
    const rawLines = gitDiffWithHeaders.split('\n');
    expect(parsed.length).toBe(rawLines.length);

    // Header lines should have no line numbers
    expect(parsed[0].type).toBe('header');
    expect(parsed[1].type).toBe('header'); // new file mode 100644
    expect(parsed[2].type).toBe('header'); // index ...
    expect(parsed[5].type).toBe('hunk'); // @@ hunk header
    expect(parsed[5].newLine).toBeUndefined();

    // Line 1 and 2
    expect(parsed[6].type).toBe('add');
    expect(parsed[6].newLine).toBe(1);
    expect(parsed[7].type).toBe('add');
    expect(parsed[7].newLine).toBe(2);

    const { getCleanOutput, unmount } = renderTUI(
      <DiffRenderer diff={gitDiffWithHeaders} showLineNumbers={true} />
    );

    const output = getCleanOutput();
    expect(output).toContain('new file mode 100644');
    expect(output).toContain('+line 1');
    expect(output).toContain('+line 2');
    unmount();
  });

  it('TC-DIFF-24: UIStateContext closeConfirmation invokes onDecision with DENY', async () => {
    const onDecision = vi.fn();
    const testReq: ConfirmationRequest = {
      id: 'conf-close-001',
      toolName: 'k8s_delete',
      args: {},
      riskLevel: 'high',
      prompt: 'Delete resource?',
    };

    const TestConsumer: React.FC = () => {
      const { closeConfirmation, state } = useUIState();

      useEffect(() => {
        closeConfirmation();
      }, [closeConfirmation]);

      return <Text>Queue: {state.confirmationQueue.length}</Text>;
    };

    const { wait, unmount } = renderTUI(
      <UIStateProvider initialState={{ confirmationQueue: [testReq] }} onDecision={onDecision}>
        <TestConsumer />
      </UIStateProvider>
    );

    await wait(40);

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith('conf-close-001', 'DENY');
    unmount();
  });
});
