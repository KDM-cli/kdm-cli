import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import path from 'node:path';
import { runAgentCouncilProcess } from '../agent/python-bridge';
import type { ConsensusDiagnosis, NDJSONEvent } from '../agent/types';

interface MockProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  stdin: {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  };
  kill: ReturnType<typeof vi.fn>;
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.stdin = {
    write: vi.fn(),
    end: vi.fn(),
    destroyed: false,
  };
  proc.kill = vi.fn();
  return proc;
}

const sampleConsensus: ConsensusDiagnosis = {
  rootCause: 'Pod exceeded memory limit 256Mi',
  confidence: 'high',
  findings: [
    {
      role: 'runtime',
      agentName: 'Runtime & Log Agent',
      icon: '🔍',
      status: 'completed',
      statusText: 'Exit 137',
      summary: 'Out of memory killer terminated container',
    },
  ],
  bestSolution: {
    actionTitle: 'Increase memory limit',
    steps: ['Change memory limit to 512Mi in deployment'],
    riskLevel: 'low',
  },
};

describe('python-bridge-lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('spawns python3 with -u flag, resolved script path, and JSON payload argument', async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockImplementation(() => {
      setTimeout(() => {
        mockProc.stdout.push(
          JSON.stringify({
            event: 'diagnosis_ready',
            consensus: sampleConsensus,
            timestamp: '2026-10-14T18:00:00Z',
          }) + '\n'
        );
        mockProc.stdout.push(null);
        mockProc.emit('close', 0, null);
      }, 10);
      return mockProc;
    });

    const result = await runAgentCouncilProcess({
      failureText: 'CrashLoopBackOff',
      context: { namespace: 'prod', kind: 'Deployment', name: 'web-api' },
      model: 'qwen2.5:7b',
      baseUrl: 'http://ollama-internal:11434',
      spawnFn: mockSpawn as any,
    });

    expect(result).toEqual(sampleConsensus);
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    const [cmd, args, opts] = mockSpawn.mock.calls[0];
    expect(cmd).toBe('python3');
    expect(args[0]).toBe('-u');
    expect(args[1]).toContain(path.join('agents', 'council.py'));

    expect(args).toHaveLength(2);
    const writtenPayload = mockProc.stdin.write.mock.calls[0][0];
    const payload = JSON.parse(writtenPayload);
    expect(payload.failureText).toBe('CrashLoopBackOff');
    expect(payload.context.namespace).toBe('prod');
    expect(payload.context.name).toBe('web-api');
    expect(payload.model).toBe('qwen2.5:7b');
    expect(payload.baseUrl).toBe('http://ollama-internal:11434');

    expect(opts.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(mockProc.stdin.write).toHaveBeenCalledWith(writtenPayload);
    expect(mockProc.stdin.end).toHaveBeenCalledTimes(1);
  });

  it('streams NDJSON events in real-time via readline and resolves on diagnosis_ready', async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const receivedEvents: NDJSONEvent[] = [];

    const promise = runAgentCouncilProcess({
      failureText: 'OOMKilled',
      context: { namespace: 'default', kind: 'Pod', name: 'app-worker' },
      spawnFn: mockSpawn as any,
      onEvent: (event) => receivedEvents.push(event),
    });

    mockProc.stdout.push(
      JSON.stringify({
        event: 'analysis_start',
        analysisId: 'ana-456',
        timestamp: '2026-10-14T18:01:00Z',
      }) + '\n'
    );

    mockProc.stdout.push(
      JSON.stringify({
        event: 'agent_start',
        role: 'runtime',
        message: 'Inspecting container exit codes',
        timestamp: '2026-10-14T18:01:01Z',
      }) + '\n'
    );

    mockProc.stdout.push(
      JSON.stringify({
        event: 'diagnosis_ready',
        consensus: sampleConsensus,
        timestamp: '2026-10-14T18:01:02Z',
      }) + '\n'
    );

    mockProc.stdout.push(null);
    mockProc.emit('close', 0, null);

    const diagnosis = await promise;
    expect(diagnosis).toEqual(sampleConsensus);
    expect(receivedEvents).toHaveLength(3);
    expect(receivedEvents[0].event).toBe('analysis_start');
    expect(receivedEvents[1].event).toBe('agent_start');
    expect(receivedEvents[2].event).toBe('diagnosis_ready');
  });

  it('triggers SIGTERM and delayed SIGKILL on watchdog timeout', async () => {
    vi.useFakeTimers();
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);

    const promise = runAgentCouncilProcess({
      failureText: 'HangingProcess',
      context: {},
      timeoutMs: 1000,
      spawnFn: mockSpawn as any,
    });
    const rejection = expect(promise).rejects.toThrow(/Python agent council timed out after 1000ms/);

    vi.advanceTimersByTime(1000);
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockProc.kill).not.toHaveBeenCalledWith('SIGKILL');

    vi.advanceTimersByTime(1500);
    expect(mockProc.kill).toHaveBeenCalledWith('SIGKILL');

    await rejection;
  });

  it('cancels SIGKILL escalation if child process terminates before 1500ms grace period', async () => {
    vi.useFakeTimers();
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);

    const promise = runAgentCouncilProcess({
      failureText: 'GracefulTermination',
      context: {},
      timeoutMs: 1000,
      spawnFn: mockSpawn as any,
    });
    const rejection = expect(promise).rejects.toThrow(/timed out/);

    vi.advanceTimersByTime(1000);
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');

    // Child process closes 400ms after SIGTERM
    mockProc.emit('close', null, 'SIGTERM');

    // Advance past 1500ms
    vi.advanceTimersByTime(2000);
    expect(mockProc.kill).not.toHaveBeenCalledWith('SIGKILL');

    await rejection;
  });

  it('traps SIGINT, terminates process, and cleans up signal handler', async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const initialSigintCount = process.listenerCount('SIGINT');

    const promise = runAgentCouncilProcess({
      failureText: 'UserCancellation',
      context: {},
      spawnFn: mockSpawn as any,
    });

    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount + 1);

    process.emit('SIGINT');
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');

    mockProc.emit('close', null, 'SIGTERM');

    await expect(promise).rejects.toThrow('Python agent council terminated by SIGINT');
    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount);
  });

  it('captures stderr lines and streams them via onStderr callback on non-zero exit', async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const stderrChunks: string[] = [];

    const promise = runAgentCouncilProcess({
      failureText: 'ModuleMissingCrash',
      context: {},
      spawnFn: mockSpawn as any,
      onStderr: (chunk) => stderrChunks.push(chunk),
    });

    const errorOutput =
      'Traceback (most recent call last):\n' +
      '  File "council.py", line 8, in <module>\n' +
      "    import ollama\n" +
      "ModuleNotFoundError: No module named 'ollama'\n";

    mockProc.stderr.push(Buffer.from(errorOutput));
    mockProc.stderr.push(null);
    mockProc.stdout.push(null);
    mockProc.emit('close', 1, null);

    await expect(promise).rejects.toThrow(/ModuleNotFoundError: No module named 'ollama'/);
    expect(stderrChunks.join('')).toContain('ModuleNotFoundError');
  });

  it('rejects when process exits with non-zero code without stderr or consensus', async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);

    const promise = runAgentCouncilProcess({
      failureText: 'SilentFailure',
      context: {},
      spawnFn: mockSpawn as any,
    });

    mockProc.stdout.push(null);
    mockProc.stderr.push(null);
    mockProc.emit('close', 137, null);

    await expect(promise).rejects.toThrow(
      'Python agent exited with code 137 without producing a consensus diagnosis'
    );
  });

  it('rejects when child process encounters a spawn error', async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockImplementation(() => {
      setTimeout(() => {
        mockProc.emit('error', new Error('spawn python3 ENOENT'));
      }, 5);
      return mockProc;
    });

    await expect(
      runAgentCouncilProcess({
        failureText: 'SpawnFailure',
        context: {},
        spawnFn: mockSpawn as any,
      })
    ).rejects.toThrow('Failed to spawn Python agent runner: spawn python3 ENOENT');
  });

  it('rejects when stream contains a fatal error event', async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);

    const promise = runAgentCouncilProcess({
      failureText: 'FatalProtocolEvent',
      context: {},
      spawnFn: mockSpawn as any,
    });

    mockProc.stdout.push(
      JSON.stringify({
        event: 'error',
        message: 'Ollama service connection refused on port 11434',
        fatal: true,
        timestamp: '2026-10-14T18:00:00Z',
      }) + '\n'
    );

    mockProc.stdout.push(null);
    mockProc.stderr.push(null);
    mockProc.emit('close', 1, null);

    await expect(promise).rejects.toThrow('Ollama service connection refused on port 11434');
  });

  it('cleans up lifecycle timers and signal handlers upon successful completion', async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const initialSigintCount = process.listenerCount('SIGINT');

    const promise = runAgentCouncilProcess({
      failureText: 'NormalRun',
      context: {},
      spawnFn: mockSpawn as any,
    });

    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount + 1);

    mockProc.stdout.push(
      JSON.stringify({
        event: 'diagnosis_ready',
        consensus: sampleConsensus,
        timestamp: '2026-10-14T18:00:00Z',
      }) + '\n'
    );
    mockProc.stdout.push(null);
    mockProc.emit('close', 0, null);

    await promise;
    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount);
  });
});
