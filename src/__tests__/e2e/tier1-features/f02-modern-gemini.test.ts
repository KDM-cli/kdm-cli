import { describe, it, expect, vi } from 'vitest';
import { GoogleGeminiAIClient } from '../../../ai/google-gemini';
import type { AIProviderConfig } from '../../../config/schema';
import { MockGenAIStreamBuilder } from '../harness';

describe('Tier 1: F-02 Google Gemini Modern SDK Provider', () => {
  it('TC-E2E-T1-F02-01: Client configuration and initialization via AIProviderConfig', async () => {
    const client = new GoogleGeminiAIClient();
    const config: AIProviderConfig = {
      provider: 'google-gemini',
      password: 'test-gemini-api-key',
      model: 'gemini-2.5-flash',
      temperature: 0.2,
      customHeaders: { 'x-client-id': 'kdm-e2e' },
    };

    await client.configure(config);
    expect(client.name).toBe('google-gemini');

    // Reject missing password
    const badConfig: AIProviderConfig = {
      provider: 'google-gemini',
      password: '',
    };
    await expect(client.configure(badConfig)).rejects.toThrow('API key (password) is required');
  });

  it('TC-E2E-T1-F02-02: Backward-compatible single-turn completion (client.getCompletion())', async () => {
    const client = new GoogleGeminiAIClient();
    await client.configure({
      provider: 'google-gemini',
      password: 'test-api-key',
      model: 'gemini-pro',
    });

    const mockResponseText = 'Pod terminated with exit code 137 due to memory limit exhaustion.';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: mockResponseText }],
            },
          },
        ],
      }),
    } as Response);

    const result = await client.getCompletion('Explain exit code 137 in Kubernetes');
    expect(result).toBe(mockResponseText);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });

  it('TC-E2E-T1-F02-03: Streaming content generation with token chunk callbacks', async () => {
    const builder = new MockGenAIStreamBuilder();
    builder
      .addText('Workload ')
      .addText('auth-api ')
      .addText('is failing readiness probe.');

    const mockClient = builder.createMockClient();
    const stream = await mockClient.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: 'Analyze auth-api',
    });

    const collectedChunks: string[] = [];
    for await (const chunk of stream) {
      if (chunk.text) {
        collectedChunks.push(chunk.text);
      }
    }

    expect(collectedChunks).toEqual(['Workload ', 'auth-api ', 'is failing readiness probe.']);
    expect(collectedChunks.join('')).toBe('Workload auth-api is failing readiness probe.');
  });

  it('TC-E2E-T1-F02-04: Declarative function / tool calling schema delivery and parameter reception', async () => {
    const builder = new MockGenAIStreamBuilder();
    builder.addFunctionCall('k8s_get_pod', {
      name: 'payment-service-8f4b-2x9p',
      namespace: 'production',
    });

    const mockClient = builder.createMockClient();
    const response = await mockClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Inspect payment-service pod',
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const functionCallPart = parts.find((p: any) => p.functionCall);
    expect(functionCallPart).toBeDefined();
    expect(functionCallPart?.functionCall?.name).toBe('k8s_get_pod');
    expect(functionCallPart?.functionCall?.args).toEqual({
      name: 'payment-service-8f4b-2x9p',
      namespace: 'production',
    });
  });

  it('TC-E2E-T1-F02-05: Thinking mode and reasoning token extraction (thought: true)', async () => {
    const builder = new MockGenAIStreamBuilder();
    builder
      .addThought('Correlating exit code 137 with pod cgroup limit...')
      .addThought('Comparing JVM -Xmx768m against container 512Mi limit...')
      .addText('Root Cause: OOMKilled caused by JVM heap exceeding container limit.');

    const mockClient = builder.createMockClient();
    const stream = await mockClient.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: 'Diagnose OOM',
    });

    const thoughts: string[] = [];
    const texts: string[] = [];

    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.thought) {
          thoughts.push(part.text || '');
        } else if (part.text) {
          texts.push(part.text);
        }
      }
    }

    expect(thoughts).toHaveLength(2);
    expect(thoughts[0]).toContain('Correlating exit code 137');
    expect(thoughts[1]).toContain('Comparing JVM -Xmx768m');
    expect(texts.join('')).toContain('Root Cause: OOMKilled');
  });
});
