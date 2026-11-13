import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  exportIncidentAudit,
  sanitizeAuditData,
  isSensitiveKey,
  createIncidentAuditSession,
  REDACTED_PLACEHOLDER,
  type IncidentAuditSession,
} from '../utils/audit-exporter';

describe('audit-exporter & secret redaction', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kdm-audit-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('isSensitiveKey', () => {
    it.each([
      ['password', true],
      ['PASSWORD', true],
      ['db_password', true],
      ['secret', true],
      ['client_secret', true],
      ['api_key', true],
      ['apiKey', true],
      ['token', true],
      ['bearer', true],
      ['auth', true],
      ['authorization', true],
      ['private_key', true],
      ['kind', false],
      ['name', false],
      ['namespace', false],
      ['durationMs', false],
      ['status', false],
      ['rootCause', false],
    ])('evaluates key %s as sensitive=%s', (key, expected) => {
      expect(isSensitiveKey(key)).toBe(expected);
    });
  });

  describe('sanitizeAuditData', () => {
    it('redacts sensitive dictionary keys with [REDACTED]', () => {
      const raw = {
        name: 'checkout-service',
        password: 'super-secret-password',
        api_key: 'sk-123456789',
        bearer_token: 'xyz-token',
        auth_secret: 'nested-auth',
        config: {
          port: 8080,
          database_password: 'db-password-val',
          nestedSecret: 'vault-key',
        },
      };

      const sanitized = sanitizeAuditData(raw);

      expect(sanitized.name).toBe('checkout-service');
      expect(sanitized.password).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.api_key).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.bearer_token).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.auth_secret).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.config.port).toBe(8080);
      expect(sanitized.config.database_password).toBe(REDACTED_PLACEHOLDER);
      expect(sanitized.config.nestedSecret).toBe(REDACTED_PLACEHOLDER);
    });

    it('redacts Kubernetes environment entry value when sibling name is sensitive', () => {
      const raw = {
        env: [
          { name: 'PORT', value: '8080' },
          { name: 'DB_PASSWORD', value: 'prod-db-pass-99' },
          { name: 'API_SECRET_TOKEN', value: 'sec-tok-123' },
          { name: 'APP_ENV', value: 'production' },
        ],
      };

      const sanitized = sanitizeAuditData(raw);

      expect(sanitized.env[0]).toEqual({ name: 'PORT', value: '8080' });
      expect(sanitized.env[1]).toEqual({ name: 'DB_PASSWORD', value: REDACTED_PLACEHOLDER });
      expect(sanitized.env[2]).toEqual({ name: 'API_SECRET_TOKEN', value: REDACTED_PLACEHOLDER });
      expect(sanitized.env[3]).toEqual({ name: 'APP_ENV', value: 'production' });
    });

    it('redacts bearer tokens, basic auth, and private keys from strings', () => {
      const samplePrivateKey =
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0m\n-----END RSA PRIVATE KEY-----';

      const raw = {
        logs: [
          'User logged in with Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token.sig',
          'Connecting to proxy using Basic dXNlcjpwYXNz',
          `TLS cert loaded, private key: ${samplePrivateKey}`,
          'Connection url: redis://cache:6379?password=superSecretPassword&timeout=5',
        ],
      };

      const sanitized = sanitizeAuditData(raw);

      expect(sanitized.logs[0]).toContain(`Authorization: Bearer ${REDACTED_PLACEHOLDER}`);
      expect(sanitized.logs[0]).not.toContain('eyJhbGci');
      expect(sanitized.logs[1]).toContain(`Basic ${REDACTED_PLACEHOLDER}`);
      expect(sanitized.logs[1]).not.toContain('dXNlcjpwYXNz');
      expect(sanitized.logs[2]).toContain(REDACTED_PLACEHOLDER);
      expect(sanitized.logs[2]).not.toContain('MIIEowIBAAKCAQEA0m');
      expect(sanitized.logs[3]).toContain(`password=${REDACTED_PLACEHOLDER}`);
      expect(sanitized.logs[3]).not.toContain('superSecretPassword');
    });

    it('handles circular references without throwing', () => {
      const cyclic: Record<string, unknown> = {
        name: 'cyclic-node',
        safeProperty: 'hello',
      };
      cyclic.self = cyclic;

      const sanitized = sanitizeAuditData(cyclic);
      expect(sanitized.name).toBe('cyclic-node');
      expect(sanitized.self).toBe('[CIRCULAR]');
    });

    it('does not mutate the source object', () => {
      const original = {
        token: 'secret-token-123',
        nested: { password: 'pass' },
      };

      const originalCopy = JSON.parse(JSON.stringify(original));
      sanitizeAuditData(original);

      expect(original).toEqual(originalCopy);
    });
  });

  describe('createIncidentAuditSession', () => {
    it('constructs a standardized incident audit bundle with defaults', () => {
      const session = createIncidentAuditSession({
        target: { kind: 'Deployment', name: 'checkout-api', namespace: 'production' },
        evidence: { logs: 'Container failed' },
        toolCalls: [{ tool: 'get_container_logs', durationMs: 140, status: 'success' }],
        consensus: { rootCause: 'Container OOMKilled', confidence: 'high' },
      });

      expect(session.sessionId).toMatch(/^an-\d+$/);
      expect(session.cliVersion).toBe('4.0.0');
      expect(session.target.name).toBe('checkout-api');
      expect(session.toolCalls).toHaveLength(1);
      expect(session.consensus?.rootCause).toBe('Container OOMKilled');
      expect(session.timestamp).toBeDefined();
    });
  });

  describe('exportIncidentAudit', () => {
    const mockSession: IncidentAuditSession = {
      sessionId: 'an-123',
      cliVersion: '4.0.0',
      target: {
        kind: 'Deployment',
        name: 'checkout-api',
        namespace: 'production',
        authSecret: 'should-be-redacted',
      },
      evidence: {
        events: ['Pod failed to pull image'],
        credentials: {
          api_key: 'top-secret-api-key',
        },
      },
      toolCalls: [
        {
          tool: 'get_container_logs',
          durationMs: 140,
          status: 'success',
          args: { auth_token: 'header-token' },
        },
      ],
      consensus: {
        rootCause: 'Container OOMKilled',
        confidence: 'high',
      },
    };

    it('writes sanitized formatted JSON to requested file path', async () => {
      const exportPath = path.join(tempDir, 'subfolder', 'incident.json');

      const result = await exportIncidentAudit(exportPath, mockSession);

      expect(result.sessionId).toBe('an-123');
      expect(fs.existsSync(exportPath)).toBe(true);

      const fileContent = await fs.promises.readFile(exportPath, 'utf8');
      const parsed = JSON.parse(fileContent);

      expect(parsed.target.kind).toBe('Deployment');
      expect(parsed.target.name).toBe('checkout-api');
      expect(parsed.target.authSecret).toBe(REDACTED_PLACEHOLDER);
      expect(parsed.evidence.credentials.api_key).toBe(REDACTED_PLACEHOLDER);
      expect(parsed.toolCalls[0].args.auth_token).toBe(REDACTED_PLACEHOLDER);
      expect(parsed.consensus.rootCause).toBe('Container OOMKilled');
      expect(fileContent.endsWith('\n')).toBe(true);
    });

    it('supports ExportAuditOptions object parameter signature', async () => {
      const exportPath = path.join(tempDir, 'opts-test.json');

      await exportIncidentAudit({
        filePath: exportPath,
        session: mockSession,
      });

      expect(fs.existsSync(exportPath)).toBe(true);
      const parsed = JSON.parse(await fs.promises.readFile(exportPath, 'utf8'));
      expect(parsed.sessionId).toBe('an-123');
      expect(parsed.target.authSecret).toBe(REDACTED_PLACEHOLDER);
    });

    it('rejects invalid inputs with descriptive errors', async () => {
      await expect(exportIncidentAudit('', mockSession)).rejects.toThrow(
        'Target file path must be a non-empty string'
      );
      await expect(exportIncidentAudit(null as any)).rejects.toThrow(
        'Invalid export arguments'
      );
      await expect(exportIncidentAudit('test.json', undefined as any)).rejects.toThrow(
        'Incident audit session data must be provided'
      );
    });
  });
});
