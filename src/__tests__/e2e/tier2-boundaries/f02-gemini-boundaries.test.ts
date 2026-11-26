import { describe, it, expect, vi } from 'vitest';
import { MockGenAIStreamBuilder } from '../harness';
import { GoogleGeminiAIClient } from '../../../ai/google-gemini';
import { parseNDJSONLine } from '../../../agent/event-schema';

describe('Tier 2: F-02 Gemini Boundaries & Corner Cases', () => {
  it('TC-E2E-T2-F02-01: Socket termination and network disconnect mid-stream (ECONNRESET)', async () => {
    const builder = new MockGenAIStreamBuilder();
    builder.addText('Streaming diagnostic start...');

    const connResetError = new Error('read ECONNRESET');
    (connResetError as any).code = 'ECONNRESET';
    builder.simulateError(connResetError, 1);

    const stream = builder.toAsyncIterable();
    let receivedChunks = 0;
    let caughtError: any = null;

    try {
      for await (const chunk of stream) {
        receivedChunks++;
      }
    } catch (err) {
      caughtError = err;
    }

    expect(receivedChunks).toBe(1);
    expect(caughtError).not.toBeNull();
    expect(caughtError.code).toBe('ECONNRESET');
  });

  it('TC-E2E-T2-F02-02: HTTP 429 quota exhaustion (RESOURCE_EXHAUSTED) with retry notice', async () => {
    const client = new GoogleGeminiAIClient();
    await client.configure({
      provider: 'google-gemini',
      password: 'test-api-key',
    });

    const rateLimitError = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({
        error: {
          code: 429,
          message: 'Resource exhausted: quota limit exceeded for model gemini-2.5-flash',
          status: 'RESOURCE_EXHAUSTED',
        },
      }),
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(rateLimitError as any);

    await expect(client.getCompletion('Explain high CPU usage')).rejects.toThrow(
      'Google Gemini API call failed with status 429'
    );

    fetchSpy.mockRestore();
  });

  it('TC-E2E-T2-F02-03: HTTP 401 unauthorized / invalid API key rejection notice', async () => {
    const client = new GoogleGeminiAIClient();
    await client.configure({
      provider: 'google-gemini',
      password: 'invalid-or-revoked-key',
    });

    const authError = {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({
        error: {
          code: 401,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'UNAUTHENTICATED',
        },
      }),
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(authError as any);

    await expect(client.getCompletion('Diagnose pod')).rejects.toThrow(
      'Google Gemini API call failed with status 401'
    );

    fetchSpy.mockRestore();
  });

  it('TC-E2E-T2-F02-04: Extreme token input / massive cluster log (>2MB) sliding window truncation', () => {
    const client = new GoogleGeminiAIClient();
    const massiveLog = 'A'.repeat(3 * 1024 * 1024);
    const maxAllowedChars = 100_000;

    const { text, truncated } = client.truncatePrompt(massiveLog, maxAllowedChars);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThan(100_100);
    expect(text).toContain('[... Truncated earlier log entries ...]');
  });

  it('TC-E2E-T2-F02-05: Malformed JSON or truncated function call response recovery', () => {
    const client = new GoogleGeminiAIClient();
    const truncatedPayload = '{"name": "k8s_get_pod", "args": {"pod": "paym';

    const result = client.safeParseToolCall(truncatedPayload);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Truncated function call JSON');

    expect(parseNDJSONLine(truncatedPayload)).toBeNull();
  });
});
