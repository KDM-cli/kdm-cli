import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runPythonAgentCouncil, isPythonAgentAvailable, getCouncilScriptPath } from '../agent/python-bridge';
import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

describe('python-bridge', () => {
  let mockProc: any;

  beforeEach(() => {
    mockProc = new EventEmitter() as any;
    mockProc.stdout = new Readable({ read() {} });
    mockProc.stderr = new Readable({ read() {} });
    mockProc.stdin = {
      write: vi.fn(),
      end: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checks Python agent availability correctly', async () => {
    const mockSpawn = vi.fn().mockImplementation(() => {
      const proc = new EventEmitter() as any;
      setTimeout(() => proc.emit('close', 0), 10);
      return proc;
    });

    const available = await isPythonAgentAvailable(mockSpawn as any);
    expect(available).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith('python3', ['-c', 'import ollama'], { stdio: 'ignore' });
  });

  it('runs council and passes streaming progress events and resolves consensus', async () => {
    const mockSpawn = vi.fn().mockImplementation(() => {
      setTimeout(() => {
        mockProc.stdout.push(Buffer.from(JSON.stringify({
          type: 'progress',
          agent: 'Runtime & Log Agent',
          role: 'runtime',
          icon: '',
          status: 'running',
          message: 'Runtime & Log Agent is working: Analyzing container logs...',
        }) + '\n'));

        mockProc.stdout.push(Buffer.from(JSON.stringify({
          type: 'complete',
          consensus: {
            rootCause: 'Pod exceeded memory limit 256Mi',
            confidence: 'high',
            findings: [
              {
                role: 'runtime',
                agentName: 'Runtime & Log Agent',
                icon: '',
                status: 'completed',
                statusText: 'Exit 137',
              }
            ],
            bestSolution: {
              actionTitle: 'Increase memory limit',
              steps: ['Change memory limit to 512Mi'],
              riskLevel: 'low',
            }
          }
        }) + '\n'));

        mockProc.stdout.push(null);
        mockProc.emit('close', 0);
      }, 20);
      return mockProc;
    });

    const progressEvents: any[] = [];
    const result = await runPythonAgentCouncil({
      failureText: 'OOMKilled',
      context: { namespace: 'default', kind: 'Pod', name: 'my-app' },
      onProgress: (event) => progressEvents.push(event),
      spawnFn: mockSpawn as any,
    });

    expect(progressEvents.length).toBe(1);
    expect(progressEvents[0].agentName).toBe('Runtime & Log Agent');
    expect(progressEvents[0].message).toContain('Analyzing container logs');

    expect(result.rootCause).toContain('memory limit');
    expect(result.bestSolution.actionTitle).toBe('Increase memory limit');
  });

  it('rejects when python process exits with error and no consensus', async () => {
    const mockSpawn = vi.fn().mockImplementation(() => {
      setTimeout(() => {
        mockProc.stderr.push(Buffer.from('Python crashed: MemoryError\n'));
        mockProc.stderr.push(null);
        mockProc.stdout.push(null);
        mockProc.emit('close', 1);
      }, 20);
      return mockProc;
    });

    await expect(runPythonAgentCouncil({
      failureText: 'Crash',
      context: {},
      spawnFn: mockSpawn as any,
    })).rejects.toThrow('Python crashed');
  });

  describe('getCouncilScriptPath', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('resolves packaged script path by default without requiring KDM_ALLOW_LOCAL_AGENTS', () => {
      delete process.env.KDM_ALLOW_LOCAL_AGENTS;
      delete process.env.NODE_ENV;

      const scriptPath = getCouncilScriptPath();
      expect(scriptPath).toContain(path.join('agents', 'council.py'));
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it('prefers cwd path only when development opt-in KDM_ALLOW_LOCAL_AGENTS is enabled', () => {
      process.env.KDM_ALLOW_LOCAL_AGENTS = '1';
      const scriptPath = getCouncilScriptPath();
      const expectedCwdPath = path.resolve(process.cwd(), 'agents', 'council.py');
      expect(scriptPath).toBe(expectedCwdPath);
    });
  });
});
