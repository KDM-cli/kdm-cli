import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer } from '../server/server';
import { registry } from '../analyzers';
import { runAnalysis } from '../analysis/analysis';
import { getConfig } from '../config/store';

vi.mock('../config/store', () => ({
  getActiveFilters: vi.fn(() => []),
  getAIConfig: vi.fn(() => ({ providers: [] })),
  getCacheConfig: vi.fn(() => ({ type: 'file', enabled: false })),
  getConfig: vi.fn(() => ({
    ai: {
      providers: [
          { name: 'openai', model: 'gpt-4', password: 'secret-password', customHeaders: { 'Authorization': 'Bearer secret-token' } },
      ],
    },
      notifications: {
        discordWebhook: 'https://discord.com/api/webhooks/123/secret',
        emailPassword: 'my-email-password'
      }
  })),
}));

vi.mock('../analysis/analysis', () => ({
  runAnalysis: vi.fn(async (options: any) => {
    if (options.backend === 'error-backend') {
      throw new Error('Mocked analysis failure');
    }
    return {
      status: 'OK',
      problems: 0,
      results: [{ kind: 'Pod', name: 'test-pod', errors: [] }],
      errors: [],
    };
  }),
}));

describe('HTTP Server', () => {
  let serverInstance: { close: () => void; port: number } | null = null;

  afterEach(() => {
    serverInstance?.close();
    serverInstance = null;
  });

  it('responds to GET /health with status ok', async () => {
    serverInstance = await createServer({ port: 0 });
    const response = await fetch(`http://localhost:${serverInstance.port}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('responds to GET /filters with registered analyzers', async () => {
    serverInstance = await createServer({ port: 0 });
    const response = await fetch(`http://localhost:${serverInstance.port}/filters`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.filters).toBeDefined();
    expect(Array.isArray(body.filters)).toBe(true);
  });

  it('responds to GET /config with masked secrets', async () => {
    serverInstance = await createServer({ port: 0 });
    const response = await fetch(`http://localhost:${serverInstance.port}/config`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ai.providers[0].password).toBe('****');
    expect(body.ai.providers[0].customHeaders['Authorization']).toBe('****');
    expect(body.notifications.discordWebhook).toBe('****');
    expect(body.notifications.emailPassword).toBe('****');
  });

  it('rejects POST /analyze body larger than 1MB', async () => {
    serverInstance = await createServer({ port: 0 });
    const largeBody = 'a'.repeat(1024 * 1024 + 10);
    const response = await fetch(`http://localhost:${serverInstance.port}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: largeBody,
    });
    expect(response.status).toBe(500);
    const body = await response.json() as any;
    expect(body.error).toBe('Payload Too Large');
  });

  it('strips query parameters when routing', async () => {
    serverInstance = await createServer({ port: 0 });
    const response = await fetch(`http://localhost:${serverInstance.port}/health?probe=1`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('handles GET /config errors gracefully', async () => {
    vi.mocked(getConfig).mockImplementationOnce(() => {
      throw new Error('Config load error');
    });
    serverInstance = await createServer({ port: 0 });
    const response = await fetch(`http://localhost:${serverInstance.port}/config`);
    expect(response.status).toBe(500);
    const body = await response.json() as any;
    expect(body.error).toBe('Config load error');
  });

  it('responds to POST /analyze and handles body parameters', async () => {
    serverInstance = await createServer({ port: 0, backend: 'openai' });
    const response = await fetch(`http://localhost:${serverInstance.port}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: 'kube-system', explain: true }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.results).toHaveLength(1);
    expect(vi.mocked(runAnalysis)).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'kube-system',
        explain: true,
        backend: 'openai',
      }),
    );
  });

  it('handles POST /analyze errors', async () => {
    serverInstance = await createServer({ port: 0 });
    const response = await fetch(`http://localhost:${serverInstance.port}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'error-backend' }),
    });
    expect(response.status).toBe(500);
    const body = await response.json() as any;
    expect(body.error).toBe('Mocked analysis failure');
  });

  it('responds with 404 for unknown endpoints', async () => {
    serverInstance = await createServer({ port: 0 });
    const response = await fetch(`http://localhost:${serverInstance.port}/nonexistent`);
    expect(response.status).toBe(404);
    const body = await response.json() as any;
    expect(body.error).toBe('Not found');
  });
});
