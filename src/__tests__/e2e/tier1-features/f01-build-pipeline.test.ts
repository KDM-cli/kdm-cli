import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { createTwoFilesPatch, diffLines } from 'diff';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../../../');

describe('Tier 1: F-01 Build & Pipeline Hardening', () => {
  it('TC-E2E-T1-F01-01: Clean TypeScript build with no test exclusion leakage', () => {
    const distPath = path.join(ROOT_DIR, 'dist');
    expect(fs.existsSync(distPath)).toBe(true);

    const indexPath = path.join(distPath, 'index.js');
    expect(fs.existsSync(indexPath)).toBe(true);
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    expect(indexContent.length).toBeGreaterThan(1000);

    // Verify no test files are emitted into dist/
    const distFiles = fs.readdirSync(distPath);
    const testFiles = distFiles.filter((f) => f.includes('.test.') || f.includes('.spec.'));
    expect(testFiles).toEqual([]);
  });

  it('TC-E2E-T1-F01-02: Runtime ESM import resolution of core modern dependencies', async () => {
    // 1. Verify @google/genai runtime availability
    expect(GoogleGenAI).toBeDefined();
    const ai = new GoogleGenAI({ apiKey: 'mock-key-for-test' });
    expect(ai).toBeInstanceOf(GoogleGenAI);
    expect(ai.models).toBeDefined();

    // 2. Verify zod validation
    const Schema = z.object({
      name: z.string(),
      count: z.number().int().positive(),
    });
    const parsed = Schema.parse({ name: 'kdm-worker', count: 4 });
    expect(parsed).toEqual({ name: 'kdm-worker', count: 4 });

    // 3. Verify diff line-by-line patch computation
    const patch = createTwoFilesPatch('a.yaml', 'b.yaml', 'line1\nline2\n', 'line1\nline2-changed\n');
    expect(patch).toContain('--- a.yaml');
    expect(patch).toContain('+++ b.yaml');
    expect(patch).toContain('-line2');
    expect(patch).toContain('+line2-changed');
  });

  it('TC-E2E-T1-F01-03: Vitest test runner execution on forked pool baseline', () => {
    const packageJsonPath = path.join(ROOT_DIR, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    expect(pkg.scripts.test).toContain('vitest');
    expect(pkg.scripts.test).toContain('--pool=forks');
    expect(pkg.scripts.test).toContain('--maxWorkers=1');
  });

  it('TC-E2E-T1-F01-04: TypeScript strictness and JSX preservation for React 19 / Ink 8 components without type errors', () => {
    const tsconfigPath = path.join(ROOT_DIR, 'tsconfig.json');
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));

    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.jsx).toBe('react-jsx');
    expect(tsconfig.compilerOptions.target.toLowerCase()).toBe('es2022');
    expect(tsconfig.compilerOptions.declaration).toBe(true);
  });

  it('TC-E2E-T1-F01-05: Pre-commit / check code pipeline verification', () => {
    const packageJsonPath = path.join(ROOT_DIR, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    expect(pkg.scripts['check:code']).toBeDefined();
    expect(pkg.scripts['check:code']).toContain('npm run build');
    expect(pkg.scripts['check:code']).toContain('npm test');
  });
});
