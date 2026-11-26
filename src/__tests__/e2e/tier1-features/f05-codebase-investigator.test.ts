import { describe, it, expect } from 'vitest';
import { CodebaseInvestigatorAgent } from '../harness';

describe('Tier 1: F-05 Codebase Investigator Agent Port', () => {
  it('TC-E2E-T1-F05-01: Workspace manifest discovery (Kubernetes YAML & Helm values)', async () => {
    const mockFiles: Record<string, string> = {
      'charts/payment/values.yaml': 'image:\n  repository: payment-service\n',
      'k8s/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\n',
      'src/server.ts': 'console.log("running");\n',
      'README.md': '# Payment Service\n',
    };

    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: mockFiles });
    expect(report.discoveredManifests).toContain('charts/payment/values.yaml');
    expect(report.discoveredManifests).toContain('k8s/deployment.yaml');
    expect(report.discoveredManifests).not.toContain('src/server.ts');
    expect(report.discoveredManifests).not.toContain('README.md');
  });

  it('TC-E2E-T1-F05-02: Dockerfile and container build spec analysis for JVM/cgroup flags', async () => {
    const mockFiles: Record<string, string> = {
      'Dockerfile': 'FROM eclipse-temurin:17\nENV JAVA_OPTS="-Xmx768m"\nENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]\n',
    };

    const report = await CodebaseInvestigatorAgent.run({
      workspaceFiles: mockFiles,
      liveClusterState: { memoryLimit: '512Mi' },
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].file).toBe('Dockerfile');
    expect(report.findings[0].issue).toContain('-Xmx768m');
    expect(report.findings[0].issue).toContain('512Mi');
  });

  it('TC-E2E-T1-F05-03: Local manifest vs live cluster config discrepancy detection', async () => {
    const mockFiles: Record<string, string> = {
      'k8s/auth-deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n      - name: auth\n        env:\n        - name: DATABASE_URL\n          valueFrom:\n            secretKeyRef:\n              name: auth-secrets\n              key: db-url\n',
    };

    const report = await CodebaseInvestigatorAgent.run({
      workspaceFiles: mockFiles,
      liveClusterState: { podName: 'auth-api-v2-7c91' },
    });

    expect(report.driftDetected).toBe(true);
    expect(report.findings[0].issue).toContain('db-url');
    expect(report.findings[0].recommendation).toContain('DATABASE_URL');
  });

  it('TC-E2E-T1-F05-04: Remediation patch generation for local workspace manifest', async () => {
    const mockFiles: Record<string, string> = {
      'deploy/payment-service.yaml': 'apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n      - name: payment\n        resources:\n          limits:\n            memory: 512Mi\n        env:\n        - name: JAVA_OPTS\n          value: "-Xmx768m"\n',
    };

    const report = await CodebaseInvestigatorAgent.run({
      workspaceFiles: mockFiles,
      liveClusterState: { memoryLimit: '512Mi' },
    });

    expect(report.findings[0].patch).toBeDefined();
    expect(report.findings[0].patch).toContain('--- deploy/payment-service.yaml');
    expect(report.findings[0].patch).toContain('+++ deploy/payment-service.yaml.patched');
  });

  it('TC-E2E-T1-F05-05: Missing resource definition graceful fallback to live cluster inspection', async () => {
    // Empty workspace directory with 0 manifests
    const report = await CodebaseInvestigatorAgent.run({ workspaceFiles: {} });
    expect(report.discoveredManifests).toHaveLength(0);
    expect(report.findings[0].file).toBe('none');
    expect(report.findings[0].issue).toContain('No relevant configuration or manifest files discovered');
  });
});
