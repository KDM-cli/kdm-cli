import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CodebaseInvestigatorAgent,
  CodebaseInvestigatorInputSchema,
  CodebaseInvestigationReportSchema,
  parseMemoryBytes,
  isBinaryFile,
  isManifestFile,
} from '../agent/investigator.js';

describe('CodebaseInvestigatorAgent (F-05)', () => {
  it('TC-INV-01: Workspace manifest discovery in virtual files', async () => {
    const mockFiles: Record<string, string> = {
      'charts/payment/values.yaml': 'image:\n  repository: payment-service\n',
      'k8s/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\n',
      'Dockerfile': 'FROM node:20-alpine\n',
      'src/server.ts': 'console.log("running");\n',
      'docs/README.md': '# Payment Service\n',
    };

    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: mockFiles });
    expect(report.discoveredManifests).toContain('charts/payment/values.yaml');
    expect(report.discoveredManifests).toContain('k8s/deployment.yaml');
    expect(report.discoveredManifests).toContain('Dockerfile');
    expect(report.discoveredManifests).not.toContain('src/server.ts');
    expect(report.discoveredManifests).not.toContain('docs/README.md');
  });

  it('TC-INV-02: Dockerfile JVM heap vs container cgroup limit analysis', async () => {
    const mockFiles: Record<string, string> = {
      Dockerfile:
        'FROM eclipse-temurin:17\nENV JAVA_OPTS="-Xmx768m"\nENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]\n',
    };

    const report = await CodebaseInvestigatorAgent.run({
      workspaceFiles: mockFiles,
      liveClusterState: { memoryLimit: '512Mi' },
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].file).toBe('Dockerfile');
    expect(report.findings[0].issue).toContain('-Xmx768m');
    expect(report.findings[0].issue).toContain('512Mi');
    expect(report.driftDetected).toBe(true);
  });

  it('TC-INV-03: Secret key reference discrepancy detection', async () => {
    const mockFiles: Record<string, string> = {
      'k8s/auth-deployment.yaml':
        'apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n      - name: auth\n        env:\n        - name: DATABASE_URL\n          valueFrom:\n            secretKeyRef:\n              name: auth-secrets\n              key: db-url\n',
    };

    const report = await CodebaseInvestigatorAgent.run({
      workspaceFiles: mockFiles,
      liveClusterState: { podName: 'auth-api-v2-7c91' },
    });

    expect(report.driftDetected).toBe(true);
    expect(report.findings[0].issue).toContain('db-url');
    expect(report.findings[0].recommendation).toContain('DATABASE_URL');
  });

  it('TC-INV-04: Remediation unified diff patch generation', async () => {
    const mockFiles: Record<string, string> = {
      'deploy/payment-service.yaml':
        'apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n      - name: payment\n        resources:\n          limits:\n            memory: 512Mi\n        env:\n        - name: JAVA_OPTS\n          value: "-Xmx768m"\n',
    };

    const report = await CodebaseInvestigatorAgent.run({
      workspaceFiles: mockFiles,
      liveClusterState: { memoryLimit: '512Mi' },
    });

    expect(report.findings[0].patch).toBeDefined();
    expect(report.findings[0].patch).toContain('--- deploy/payment-service.yaml');
    expect(report.findings[0].patch).toContain('+++ deploy/payment-service.yaml.patched');
    expect(report.findings[0].patch).toContain('1024Mi');
  });

  it('TC-INV-05: Missing resource definition graceful fallback on empty workspace', async () => {
    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: {} });
    expect(report.discoveredManifests).toHaveLength(0);
    expect(report.findings[0].file).toBe('none');
    expect(report.findings[0].issue).toContain('No relevant configuration or manifest files discovered');
    expect(report.driftDetected).toBe(false);
  });

  it('TC-INV-06: Syntactically broken YAML skipped safely without throwing', async () => {
    const mockFiles = {
      'broken.yaml': ':::broken syntax: [unclosed list',
      'valid.yaml': 'apiVersion: v1\nkind: Service\n',
    };

    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: mockFiles });
    expect(report.discoveredManifests).toContain('valid.yaml');
    expect(report.ExplorationTrace.some((t) => t.includes('Skipping syntactically invalid'))).toBe(true);
  });

  it('TC-INV-07: Symlink loop cycle detection and handling', async () => {
    const mockFiles = {
      'charts/circular-link': ':::symlink-cycle',
      'charts/values.yaml': 'replicaCount: 1\n',
    };

    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: mockFiles });
    expect(report.findings.some((f) => f.issue.includes('Circular filesystem symlink loop'))).toBe(true);
  });

  it('TC-INV-08: Giant binary files skipped safely', () => {
    expect(isBinaryFile('database.bin')).toBe(true);
    expect(isBinaryFile('archive.tar.gz')).toBe(true);
    expect(isBinaryFile('package.zip')).toBe(true);
    expect(isBinaryFile('libcore.so')).toBe(true);
    expect(isBinaryFile('deployment.yaml')).toBe(false);
    expect(isBinaryFile('Dockerfile')).toBe(false);

    expect(isManifestFile('database.bin')).toBe(false);
    expect(isManifestFile('values.yaml')).toBe(true);
    expect(isManifestFile('service.yml')).toBe(true);
    expect(isManifestFile('Dockerfile')).toBe(true);
  });

  it('TC-INV-09: EACCES permission denied handling', async () => {
    const mockFiles = {
      'k8s/secret.yaml': ':::EACCES: permission denied',
      'k8s/valid.yaml': 'apiVersion: v1\nkind: ConfigMap\n',
    };

    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: mockFiles });
    expect(report.findings.some((f) => f.issue.includes('EACCES: permission denied'))).toBe(true);
  });

  it('TC-INV-10: Dual-schema report compliance validation', async () => {
    const mockFiles = {
      'k8s/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\n',
    };

    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: mockFiles });
    const validated = CodebaseInvestigationReportSchema.parse(report);

    // gemini-cli contract fields
    expect(validated.SummaryOfFindings).toBeDefined();
    expect(Array.isArray(validated.ExplorationTrace)).toBe(true);
    expect(Array.isArray(validated.RelevantLocations)).toBe(true);

    // KDM SRE contract fields
    expect(Array.isArray(validated.discoveredManifests)).toBe(true);
    expect(Array.isArray(validated.findings)).toBe(true);
    expect(typeof validated.driftDetected).toBe('boolean');
  });

  it('TC-INV-11: AgentDefinition factory and execution via toDefinition()', async () => {
    const agentDef = CodebaseInvestigatorAgent.toDefinition();
    expect(agentDef.name).toBe('CodebaseInvestigatorAgent');
    expect(agentDef.inputSchema).toBe(CodebaseInvestigatorInputSchema);
    expect(agentDef.outputSchema).toBe(CodebaseInvestigationReportSchema);

    const result = await agentDef.run({
      workspaceFiles: {
        'Chart.yaml': 'name: payment\nversion: 1.0.0\n',
      },
    });

    expect(result.discoveredManifests).toContain('Chart.yaml');
  });

  it('TC-INV-12: Real filesystem workspace discovery with temp directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdm-investigator-test-'));
    try {
      // Create test manifest structure
      fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), 'FROM alpine:3.18\n');
      const k8sDir = path.join(tmpDir, 'k8s');
      fs.mkdirSync(k8sDir);
      fs.writeFileSync(path.join(k8sDir, 'pod.yaml'), 'apiVersion: v1\nkind: Pod\n');
      fs.writeFileSync(path.join(tmpDir, 'main.ts'), 'console.log("hello");\n');
      fs.writeFileSync(path.join(tmpDir, 'data.bin'), Buffer.from([0x00, 0x01, 0x02]));

      const report = await CodebaseInvestigatorAgent.run({ workspaceRoot: tmpDir });
      expect(report.discoveredManifests).toContain('Dockerfile');
      expect(report.discoveredManifests).toContain(path.join('k8s', 'pod.yaml'));
      expect(report.discoveredManifests).not.toContain('main.ts');
      expect(report.discoveredManifests).not.toContain('data.bin');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('TC-INV-13: parseMemoryBytes unit conversion', () => {
    expect(parseMemoryBytes('512Mi')).toBe(512 * 1024 * 1024);
    expect(parseMemoryBytes('1Gi')).toBe(1024 * 1024 * 1024);
    expect(parseMemoryBytes('768m')).toBe(768 * 1024 * 1024);
    expect(parseMemoryBytes('1024K')).toBe(1024 * 1024);
    expect(parseMemoryBytes('invalid')).toBe(0);
  });
});
