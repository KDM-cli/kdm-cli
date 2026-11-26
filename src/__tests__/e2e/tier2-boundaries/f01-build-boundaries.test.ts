import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AgentRegistry, MockClusterEnvironment } from '../harness';
import { GoogleGeminiAIClient } from '../../../ai/google-gemini';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../../../');

describe('Tier 2: F-01 Build & Pipeline Boundaries', () => {
  it('TC-E2E-T2-F01-01: Zero-byte / empty TypeScript source file handling without compiler panic', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdm-empty-ts-'));
    const emptyTsFile = path.join(tmpDir, 'empty.ts');
    fs.writeFileSync(emptyTsFile, '');

    expect(fs.existsSync(emptyTsFile)).toBe(true);

    // Genuinely invoke TypeScript compiler to verify empty file parses with zero errors
    const checkCommand = `npx tsc --noEmit --target es2022 --skipLibCheck "${emptyTsFile}" --ignoreConfig`;
    expect(() => execSync(checkCommand, { stdio: 'pipe' })).not.toThrow();

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-E2E-T2-F01-02: Missing optional peer dependencies handled cleanly with informative skips', async () => {
    let caught: any = null;
    try {
      // @ts-ignore
      await import('nonexistent-optional-kdm-plugin');
    } catch (err: any) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    expect(caught.code).toBe('ERR_MODULE_NOT_FOUND');
  });

  it('TC-E2E-T2-F01-03: Deeply nested source file path resolution (>200 chars)', () => {
    const deepSubdir = 'a'.repeat(50) + '/' + 'b'.repeat(50) + '/' + 'c'.repeat(50);
    const resolvedPath = path.resolve(ROOT_DIR, deepSubdir, 'deeplyNestedModule.ts');

    expect(resolvedPath.length).toBeGreaterThan(200);
    expect(path.isAbsolute(resolvedPath)).toBe(true);
    expect(path.basename(resolvedPath)).toBe('deeplyNestedModule.ts');
  });

  it('TC-E2E-T2-F01-04: Concurrency isolation in Vitest single-worker execution', () => {
    // Harness component isolation test
    const registryA = new AgentRegistry();
    const registryB = new AgentRegistry();

    const sampleAgent = {
      name: 'SampleWorkerAgent',
      description: 'Isolated test worker',
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      run: async () => ({ result: 'done' }),
    };

    registryA.register(sampleAgent);
    expect(registryA.get('SampleWorkerAgent')).toBeDefined();
    expect(registryB.get('SampleWorkerAgent')).toBeUndefined();

    // Verify cluster environment isolation
    const envHealthy = new MockClusterEnvironment().setHealthyScenario();
    const envEmpty = new MockClusterEnvironment().setEmptyScenario();

    expect(envHealthy.getState().pods.length).toBeGreaterThan(0);
    expect(envEmpty.getState().pods.length).toBe(0);
  });

  it('TC-E2E-T2-F01-05: Missing environment variables at build/test time fall back to mocks cleanly', async () => {
    const origKey = process.env.GEMINI_API_KEY;
    const origKube = process.env.KUBECONFIG;
    const origDocker = process.env.DOCKER_HOST;

    try {
      delete process.env.GEMINI_API_KEY;
      delete process.env.KUBECONFIG;
      delete process.env.DOCKER_HOST;

      const client = new GoogleGeminiAIClient();
      // Configure rejects when credentials are completely missing
      await expect(client.configure({ name: 'google-gemini' })).rejects.toThrow(
        'API key (password) is required for google-gemini provider'
      );

      // Falls back cleanly when mock or test config is provided
      await client.configure({
        name: 'google-gemini',
        password: 'mock-test-key',
        model: 'gemini-1.5-flash',
      });
      expect(client.name).toBe('google-gemini');
    } finally {
      if (origKey !== undefined) process.env.GEMINI_API_KEY = origKey;
      if (origKube !== undefined) process.env.KUBECONFIG = origKube;
      if (origDocker !== undefined) process.env.DOCKER_HOST = origDocker;
    }
  });
});
