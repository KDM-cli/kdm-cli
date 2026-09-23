import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleGeminiAIClient } from '../ai/google-gemini';

describe('GoogleGeminiAIClient', () => {
  let client: GoogleGeminiAIClient;

  beforeEach(() => {
    client = new GoogleGeminiAIClient();
    vi.restoreAllMocks();
  });

  describe('configure', () => {
    it('throws when API key (password) is missing', async () => {
      await expect(client.configure({ name: 'google-gemini' })).rejects.toThrow(
        'API key (password) is required for google-gemini provider'
      );
    });

    it('throws when API key (password) is empty', async () => {
      await expect(client.configure({ name: 'google-gemini', password: '' })).rejects.toThrow(
        'API key (password) is required for google-gemini provider'
      );
    });

    it('applies default configuration when only password is provided', async () => {
      await client.configure({ name: 'google-gemini', password: 'secret-api-key' });
      expect((client as any).apiKey).toBe('secret-api-key');
      expect((client as any).model).toBe('gemini-pro');
      expect((client as any).temperature).toBe(0.7);
      expect((client as any).baseUrl).toBe('https://generativelanguage.googleapis.com');
    });

    it('stores custom model, temperature, and customHeaders', async () => {
      await client.configure({
        name: 'google-gemini',
        password: 'secret-api-key',
        model: 'gemini-1.5-flash',
        temperature: 0.2,
        customHeaders: { 'X-Custom-Tenant': 'tenant-123' },
      });
      expect((client as any).model).toBe('gemini-1.5-flash');
      expect((client as any).temperature).toBe(0.2);
      expect((client as any).customHeaders).toEqual({ 'X-Custom-Tenant': 'tenant-123' });
    });

    it('strips trailing slashes from custom baseUrl', async () => {
      await client.configure({
        name: 'google-gemini',
        password: 'secret-api-key',
        baseUrl: 'https://custom-gateway.internal///',
      });
      expect((client as any).baseUrl).toBe('https://custom-gateway.internal');
    });
  });

  describe('getCompletion', () => {
    it('sends request to /v1beta/ endpoint with x-goog-api-key header and no key query param', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any = null;

      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (input, init) => {
        capturedUrl = input.toString();
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        capturedBody = JSON.parse(init?.body as string);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Analysis of pod failure: CrashLoopBackOff detected.' }],
                },
              },
            ],
          }),
        } as Response;
      });

      await client.configure({
        name: 'google-gemini',
        password: 'secret-token-12345',
        model: 'gemini-1.5-flash',
        temperature: 0.5,
      });

      const response = await client.getCompletion('Explain this issue');

      expect(response).toBe('Analysis of pod failure: CrashLoopBackOff detected.');
      expect(capturedUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent');
      expect(capturedUrl).not.toContain('?key=');
      expect(capturedUrl).not.toContain('secret-token-12345');
      expect(capturedHeaders['x-goog-api-key']).toBe('secret-token-12345');
      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedBody).toEqual({
        contents: [{ parts: [{ text: 'Explain this issue' }] }],
        generationConfig: { temperature: 0.5 },
      });
    });

    it('forwards customHeaders along with x-goog-api-key header', async () => {
      let capturedHeaders: Record<string, string> = {};

      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'response text' }] } }],
          }),
        } as Response;
      });

      await client.configure({
        name: 'google-gemini',
        password: 'my-gemini-key',
        customHeaders: {
          'X-Proxy-Authorization': 'Bearer corporate-proxy',
        },
      });

      const result = await client.getCompletion('hello');
      expect(result).toBe('response text');
      expect(capturedHeaders['x-goog-api-key']).toBe('my-gemini-key');
      expect(capturedHeaders['X-Proxy-Authorization']).toBe('Bearer corporate-proxy');
    });

    it('throws descriptive error on non-ok HTTP responses', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await client.configure({
        name: 'google-gemini',
        password: 'valid-key',
      });

      await expect(client.getCompletion('prompt')).rejects.toThrow(
        'Google Gemini API call failed with status 404: Not Found'
      );
    });

    it('returns empty string when candidate content is missing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ candidates: [] }),
      } as Response);

      await client.configure({
        name: 'google-gemini',
        password: 'valid-key',
      });

      const response = await client.getCompletion('test');
      expect(response).toBe('');
    });
  });
});
