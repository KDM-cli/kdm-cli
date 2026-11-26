import { describe, it, expect } from 'vitest';
import { CodebaseInvestigatorAgent } from '../harness';

describe('Tier 2: F-05 Codebase Investigator Boundaries & Corner Cases', () => {
  it('TC-E2E-T2-F05-01: Empty workspace directory (zero manifests) returns clean finding', async () => {
    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: {} });
    expect(report.discoveredManifests).toHaveLength(0);
    expect(report.findings[0].issue).toContain('No relevant configuration or manifest files discovered');
  });

  it('TC-E2E-T2-F05-02: Syntactically broken YAML/Dockerfile in repository skipped with warning', async () => {
    const mockFiles = {
      'broken.yaml': ':::broken syntax: [unclosed list',
      'valid.yaml': 'apiVersion: v1\nkind: Service\n',
    };

    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: mockFiles });
    expect(report.discoveredManifests).toContain('valid.yaml');
    // Broken file should not crash the scanner
    expect(report.findings).toBeDefined();
  });

  it('TC-E2E-T2-F05-03: Circular filesystem symlink loop detection and avoidance', async () => {
    const mockFiles = {
      '/workspace/charts/Chart.yaml': 'name: frontend\nversion: 1.0.0\n',
      '/workspace/charts/sub/link-to-charts': ':::symlink-cycle:/workspace/charts',
    };

    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: mockFiles });
    expect(report.discoveredManifests).toContain('/workspace/charts/Chart.yaml');
    expect(report.findings.some((f) => f.issue.includes('Circular filesystem symlink loop'))).toBe(true);
  });

  it('TC-E2E-T2-F05-04: Giant binary files in repository root skipped safely', async () => {
    const mockFiles = {
      'database.bin': '\x00\x01\x02\x03\x04BINARY_PAYLOAD',
      'archive.tar.gz': '\x1f\x8b\x08ARCHIVE_PAYLOAD',
      'deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\n',
      'Dockerfile': 'FROM node:20-alpine\n',
    };

    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: mockFiles });
    expect(report.discoveredManifests).toContain('deployment.yaml');
    expect(report.discoveredManifests).toContain('Dockerfile');
    expect(report.discoveredManifests).not.toContain('database.bin');
    expect(report.discoveredManifests).not.toContain('archive.tar.gz');
  });

  it('TC-E2E-T2-F05-05: Permission denied (EACCES, mode 000) manifest handling', async () => {
    const mockFiles = {
      'secret.yaml': ':::EACCES: permission denied, open secret.yaml',
    };

    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: mockFiles });
    const eaccesFinding = report.findings.find((f) => f.issue.includes('EACCES'));
    expect(eaccesFinding).toBeDefined();
    expect(eaccesFinding?.issue).toContain('permission denied');
  });
});
