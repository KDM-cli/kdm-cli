import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import EventEmitter from 'node:events';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { createTwoFilesPatch, diffLines } from 'diff';
import { createAIClient } from '../ai/factory';

describe('Milestone 1: Build & Foundation (F-01)', () => {
  const rootDir = path.resolve(__dirname, '../..');

  describe('package.json dependencies', () => {
    it('declares required runtime and dev dependencies with expected versions', () => {
      const packageJsonPath = path.join(rootDir, 'package.json');
      expect(fs.existsSync(packageJsonPath)).toBe(true);

      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      expect(pkg.dependencies).toBeDefined();
      expect(pkg.dependencies['@google/genai']).toBe('^1.30.0');
      expect(pkg.dependencies['zod']).toBe('^3.25.76');
      expect(pkg.dependencies['diff']).toBe('^8.0.3');

      expect(pkg.devDependencies).toBeDefined();
      expect(pkg.devDependencies['@types/diff']).toBe('^8.0.0');
    });

    it('configures an automated clean step in the build pipeline', () => {
      const packageJsonPath = path.join(rootDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      expect(pkg.scripts).toBeDefined();
      const hasCleanInBuild = typeof pkg.scripts.build === 'string' && pkg.scripts.build.includes('rm -rf dist');
      const hasPrebuildClean = typeof pkg.scripts.prebuild === 'string' && pkg.scripts.prebuild.includes('rm -rf dist');
      expect(hasCleanInBuild || hasPrebuildClean).toBe(true);
    });
  });

  describe('@google/genai SDK availability', () => {
    it('imports @google/genai and exports the GoogleGenAI class', () => {
      expect(GoogleGenAI).toBeDefined();
      expect(typeof GoogleGenAI).toBe('function');

      const ai = new GoogleGenAI({ apiKey: 'test-fake-key' });
      expect(ai).toBeInstanceOf(GoogleGenAI);
      expect(ai.models).toBeDefined();
    });
  });

  describe('zod schema parsing and validation', () => {
    it('parses valid objects and rejects invalid structures with ZodError', () => {
      const ToolCallSchema = z.object({
        name: z.string().min(1),
        args: z.record(z.unknown()),
        timeout: z.number().int().positive().default(5000),
      });

      const validPayload = {
        name: 'k8s_get_pods',
        args: { namespace: 'default' },
      };

      const parsed = ToolCallSchema.parse(validPayload);
      expect(parsed.name).toBe('k8s_get_pods');
      expect(parsed.args).toEqual({ namespace: 'default' });
      expect(parsed.timeout).toBe(5000);

      const invalidPayload = {
        name: '',
        args: 'not-an-object',
        timeout: -10,
      };

      const result = ToolCallSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('diff patch generation', () => {
    it('creates unified two-file patches and computes line diffs', () => {
      const oldYaml = 'apiVersion: v1\nkind: Pod\nspec:\n  replicas: 1\n';
      const newYaml = 'apiVersion: v1\nkind: Pod\nspec:\n  replicas: 3\n';

      const patch = createTwoFilesPatch('pod-v1.yaml', 'pod-v2.yaml', oldYaml, newYaml);
      expect(patch).toContain('--- pod-v1.yaml');
      expect(patch).toContain('+++ pod-v2.yaml');
      expect(patch).toContain('-  replicas: 1');
      expect(patch).toContain('+  replicas: 3');

      const changes = diffLines(oldYaml, newYaml);
      expect(changes.some((c) => c.added && c.value.includes('replicas: 3'))).toBe(true);
      expect(changes.some((c) => c.removed && c.value.includes('replicas: 1'))).toBe(true);
    });
  });

  describe('tsconfig.json compiler options & exclusions', () => {
    it('configures proper exclusion rules for test files and directories', () => {
      const tsconfigPath = path.join(rootDir, 'tsconfig.json');
      expect(fs.existsSync(tsconfigPath)).toBe(true);

      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));

      expect(tsconfig.compilerOptions).toBeDefined();
      expect(tsconfig.compilerOptions.target).toBe('es2022');
      expect(tsconfig.compilerOptions.jsx).toBe('react-jsx');
      expect(tsconfig.compilerOptions.strict).toBe(true);

      expect(tsconfig.exclude).toBeDefined();
      expect(tsconfig.exclude).toContain('node_modules');
      expect(tsconfig.exclude).toContain('dist');
      expect(tsconfig.exclude).toContain('**/*.test.ts');
      expect(tsconfig.exclude).toContain('**/*.test.tsx');
      expect(tsconfig.exclude).toContain('src/__tests__/**');
      expect(tsconfig.exclude).toContain('src/**/__tests__/**');
    });
  });

  describe('dist/ output verification', () => {
    function getAllEntriesRecursive(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const paths: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        paths.push(fullPath);
        if (entry.isDirectory()) {
          paths.push(...getAllEntriesRecursive(fullPath));
        }
      }
      return paths;
    }

    it('confirms zero test declaration files and zero __tests__ directories exist in dist/', () => {
      const distDir = path.join(rootDir, 'dist');
      expect(fs.existsSync(distDir)).toBe(true);

      const allEntries = getAllEntriesRecursive(distDir);
      expect(allEntries.length).toBeGreaterThan(0);

      const testDeclarationFiles = allEntries.filter(
        (filePath) => filePath.endsWith('.test.d.ts') || /\.test\.[a-z]+\.d\.ts$/.test(filePath),
      );
      const testDirectories = allEntries.filter((filePath) => {
        const relative = path.relative(distDir, filePath);
        return relative.split(path.sep).includes('__tests__');
      });
      const anyTestDeclarationFiles = allEntries.filter((filePath) => {
        const base = path.basename(filePath);
        return base.includes('test') && base.endsWith('.d.ts');
      });

      expect(testDeclarationFiles).toEqual([]);
      expect(testDirectories).toEqual([]);
      expect(anyTestDeclarationFiles).toEqual([]);

      // Verify that standard declarations are emitted cleanly
      expect(fs.existsSync(path.join(distDir, 'index.d.ts'))).toBe(true);
      expect(fs.existsSync(path.join(distDir, 'index.js'))).toBe(true);
    });
  });

  describe('Node stream mocking compatibility for Ink components', () => {
    it('supports mock stdin/stdout event emission and stream casting', async () => {
      class MockStdin extends EventEmitter {
        isTTY = true;
        setRawMode = () => this;
        resume = () => this;
        pause = () => this;
        ref = () => this;
        unref = () => this;
        send(data: string) {
          this.emit('data', Buffer.from(data));
        }
      }

      class MockStdout extends EventEmitter {
        output = '';
        columns = 80;
        rows = 24;
        write = (chunk: string | Buffer) => {
          this.output += chunk.toString();
          return true;
        };
      }

      const stdin = new MockStdin();
      const stdout = new MockStdout();

      // Verify defensive casting compatibility
      const renderOptions = {
        stdin: stdin as any,
        stdout: stdout as any,
        debug: true,
      };

      expect(renderOptions.stdin).toBe(stdin);
      expect(renderOptions.stdout).toBe(stdout);

      let receivedData = '';
      stdin.on('data', (buf: Buffer) => {
        receivedData += buf.toString();
      });

      stdin.send('q');
      expect(receivedData).toBe('q');

      stdout.write('Rendered UI output');
      expect(stdout.output).toBe('Rendered UI output');
    });
  });

  describe('AI client factory importability', () => {
    it('imports createAIClient and can instantiate the noop client', async () => {
      expect(typeof createAIClient).toBe('function');

      const noopClient = await createAIClient('noop');
      expect(noopClient).toBeDefined();
      expect(typeof noopClient.configure).toBe('function');
      expect(typeof noopClient.getCompletion).toBe('function');

      const response = await noopClient.getCompletion('test prompt');
      expect(response).toBeDefined();
      expect(typeof response).toBe('string');
      expect(response).toBe('noop completion explanation');
    });

    it('throws error for unsupported provider backend', async () => {
      await expect(createAIClient('unsupported-backend-xyz')).rejects.toThrow(
        /Unsupported AI provider/,
      );
    });
  });
});
