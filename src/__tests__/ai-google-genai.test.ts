import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleGenAIClient } from '../ai/google-genai';
import { GeminiSession } from '../ai/gemini-session';
import { createAIClient } from '../ai/factory';
import { GoogleGeminiAIClient } from '../ai/google-gemini';
import { AIProviderConfig } from '../config/schema';
import { z } from 'zod';

describe('Feature F-02: Google Gemini Modern SDK Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  it('TC-AI-01: Client configuration and initialization via AIProviderConfig', async () => {
    const client = new GoogleGenAIClient();
    const config: AIProviderConfig = {
      name: 'google-genai',
      provider: 'google-genai',
      password: 'test-api-key-12345',
      model: 'gemini-2.5-flash',
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 2048,
      baseUrl: 'https://custom-gateway.googleapis.com',
      customHeaders: { 'X-KDM-Test': 'true' },
    };

    await client.configure(config);
    expect(client.name).toBe('google-genai');
    expect((client as any).apiKey).toBe('test-api-key-12345');
    expect((client as any).model).toBe('gemini-2.5-flash');
    expect((client as any).temperature).toBe(0.3);
    expect((client as any).topP).toBe(0.95);
    expect((client as any).maxOutputTokens).toBe(2048);
    expect((client as any).baseUrl).toBe('https://custom-gateway.googleapis.com');
  });

  it('TC-AI-02: Missing API key rejection', async () => {
    const client = new GoogleGenAIClient();
    const badConfig: AIProviderConfig = {
      name: 'google-genai',
      provider: 'google-genai',
      password: '',
    };

    await expect(client.configure(badConfig)).rejects.toThrow(
      /API key is required for Google GenAI provider/i
    );
  });

  it('TC-AI-03: Single-turn completion via client.getCompletion(prompt)', async () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
      text: 'Container payment-service is healthy with 0 restarts.',
      candidates: [
        {
          content: {
            parts: [{ text: 'Container payment-service is healthy with 0 restarts.' }],
            role: 'model',
          },
        },
      ],
    });

    const mockClient = {
      models: {
        generateContent: mockGenerateContent,
      },
    };

    const client = new GoogleGenAIClient(mockClient);
    await client.configure({
      name: 'google-genai',
      password: 'mock-key',
      model: 'gemini-2.0-flash',
      temperature: 0.5,
    });

    const completion = await client.getCompletion('Check health of payment-service');
    expect(completion).toBe('Container payment-service is healthy with 0 restarts.');
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini-2.0-flash',
      contents: 'Check health of payment-service',
      config: {
        temperature: 0.5,
        topP: undefined,
        topK: undefined,
        maxOutputTokens: undefined,
      },
    });
  });

  it('TC-AI-04: Streaming content generation yielding StreamChunk async iterable', async () => {
    const chunks = [
      {
        text: 'Analyzing ',
        candidates: [{ content: { parts: [{ text: 'Analyzing ' }] } }],
      },
      {
        text: 'cluster ',
        candidates: [{ content: { parts: [{ text: 'cluster ' }] } }],
      },
      {
        text: 'metrics...',
        candidates: [{ content: { parts: [{ text: 'metrics...' }] } }],
      },
    ];

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) {
          yield c;
        }
      },
    };

    const mockClient = {
      models: {
        generateContentStream: vi.fn().mockResolvedValue(mockStream),
      },
    };

    const client = new GoogleGenAIClient(mockClient);
    await client.configure({ name: 'google-genai', password: 'mock' });

    const receivedDeltas: string[] = [];
    const onText = vi.fn((delta: string) => receivedDeltas.push(delta));

    const stream = client.generateContentStream('Diagnose', { onText });
    const collected: string[] = [];

    for await (const chunk of stream) {
      if (chunk.text) {
        collected.push(chunk.text);
      }
    }

    expect(collected).toEqual(['Analyzing ', 'cluster ', 'metrics...']);
    expect(receivedDeltas).toEqual(['Analyzing ', 'cluster ', 'metrics...']);
    expect(onText).toHaveBeenCalledTimes(3);
  });

  it('TC-AI-05: Streaming failure handling (network disconnect mid-stream)', async () => {
    const errorStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          text: 'Beginning analysis...',
          candidates: [{ content: { parts: [{ text: 'Beginning analysis...' }] } }],
        };
        throw new Error('ECONNRESET: Connection to Generative Language API lost');
      },
    };

    const mockClient = {
      models: {
        generateContentStream: vi.fn().mockResolvedValue(errorStream),
      },
    };

    const client = new GoogleGenAIClient(mockClient);
    await client.configure({ name: 'google-genai', password: 'mock' });

    const iterate = async () => {
      const stream = client.generateContentStream('Diagnose');
      for await (const chunk of stream) {
        // iterate
      }
    };

    await expect(iterate()).rejects.toThrow('ECONNRESET');
  });

  it('TC-AI-06: Thinking mode token handling (thought: true)', async () => {
    const streamWithThoughts = {
      async *[Symbol.asyncIterator]() {
        yield {
          candidates: [
            {
              content: {
                parts: [{ thought: true, text: 'Thinking about exit code 137...' }],
              },
            },
          ],
        };
        yield {
          candidates: [
            {
              content: {
                parts: [{ thought: true, text: 'Correlating with memory limits...' }],
              },
            },
          ],
        };
        yield {
          text: 'Root Cause: Out of Memory error.',
          candidates: [
            {
              content: {
                parts: [{ text: 'Root Cause: Out of Memory error.' }],
              },
            },
          ],
        };
      },
    };

    const mockClient = {
      models: {
        generateContentStream: vi.fn().mockResolvedValue(streamWithThoughts),
      },
    };

    const client = new GoogleGenAIClient(mockClient);
    await client.configure({ name: 'google-genai', password: 'mock' });

    const thoughts: string[] = [];
    const texts: string[] = [];

    const onThought = vi.fn((t: string) => thoughts.push(t));
    const onText = vi.fn((txt: string) => texts.push(txt));

    const stream = client.generateContentStream('Analyze', {
      thinkingConfig: { includeThoughts: true },
      onThought,
      onText,
    });

    for await (const chunk of stream) {
      if (chunk.isThought && chunk.thought) {
        expect(chunk.text).toBeUndefined();
      }
    }

    expect(thoughts).toEqual([
      'Thinking about exit code 137...',
      'Correlating with memory limits...',
    ]);
    expect(texts).toEqual(['Root Cause: Out of Memory error.']);
    expect(onThought).toHaveBeenCalledTimes(2);
    expect(onText).toHaveBeenCalledTimes(1);
  });

  it('TC-AI-07: Function / tool calling schema delivery and parameter reception', async () => {
    const toolCallStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'k8s_get_resources',
                      args: { kind: 'pod', namespace: 'production' },
                      id: 'call-1',
                    },
                  },
                ],
              },
            },
          ],
        };
      },
    };

    const mockClient = {
      models: {
        generateContentStream: vi.fn().mockResolvedValue(toolCallStream),
      },
    };

    const client = new GoogleGenAIClient(mockClient);
    await client.configure({ name: 'google-genai', password: 'mock' });

    const onFunctionCall = vi.fn();
    const stream = client.generateContentStream('List pods', { onFunctionCall });

    let functionCallsFound = 0;
    for await (const chunk of stream) {
      if (chunk.functionCalls) {
        functionCallsFound += chunk.functionCalls.length;
        expect(chunk.functionCalls[0].name).toBe('k8s_get_resources');
        expect(chunk.functionCalls[0].args).toEqual({ kind: 'pod', namespace: 'production' });
      }
    }

    expect(functionCallsFound).toBe(1);
    expect(onFunctionCall).toHaveBeenCalledWith({
      name: 'k8s_get_resources',
      args: { kind: 'pod', namespace: 'production' },
      id: 'call-1',
    });
  });

  it('TC-AI-08: GeminiSession multi-turn conversation preserving history', async () => {
    const responses = [
      'Hello SRE! How can I assist with your cluster today?',
      'Cluster health check completed. All nodes are Ready.',
    ];
    let callIdx = 0;

    const mockClient = {
      models: {
        generateContentStream: vi.fn().mockImplementation(async () => ({
          async *[Symbol.asyncIterator]() {
            const resp = responses[callIdx++];
            yield {
              text: resp,
              candidates: [{ content: { parts: [{ text: resp }] } }],
            };
          },
        })),
      },
    };

    const session = new GeminiSession(mockClient, { model: 'gemini-2.0-flash' });

    // Turn 1
    const res1 = await session.sendMessage('Hello');
    expect(res1.text).toBe('Hello SRE! How can I assist with your cluster today?');
    expect(session.getHistory()).toHaveLength(2);
    expect(session.getHistory()[0].role).toBe('user');
    expect(session.getHistory()[0].parts[0].text).toBe('Hello');
    expect(session.getHistory()[1].role).toBe('model');

    // Turn 2
    const res2 = await session.sendMessage('Check cluster');
    expect(res2.text).toBe('Cluster health check completed. All nodes are Ready.');
    expect(session.getHistory()).toHaveLength(4);
    expect(session.getHistory()[2].role).toBe('user');
    expect(session.getHistory()[2].parts[0].text).toBe('Check cluster');
    expect(session.getHistory()[3].role).toBe('model');
  });

  it('TC-AI-09: GeminiSession automated tool loop with toolHandler', async () => {
    let callStep = 0;
    const mockClient = {
      models: {
        generateContentStream: vi.fn().mockImplementation(async () => ({
          async *[Symbol.asyncIterator]() {
            if (callStep === 0) {
              callStep++;
              yield {
                candidates: [
                  {
                    content: {
                      parts: [
                        {
                          functionCall: {
                            name: 'k8s_get_resources',
                            args: { kind: 'pod', namespace: 'default' },
                            id: 'call-abc',
                          },
                        },
                      ],
                    },
                  },
                ],
              };
            } else {
              yield {
                text: 'Found 2 pods in default namespace: payment-api and web.',
                candidates: [
                  {
                    content: {
                      parts: [{ text: 'Found 2 pods in default namespace: payment-api and web.' }],
                    },
                  },
                ],
              };
            }
          },
        })),
      },
    };

    const toolHandler = vi.fn().mockResolvedValue({
      count: 2,
      pods: ['payment-api', 'web'],
    });

    const session = new GeminiSession(mockClient, {
      model: 'gemini-2.0-flash',
      toolHandler,
    });

    const response = await session.sendMessage('Show pods');
    expect(toolHandler).toHaveBeenCalledWith('k8s_get_resources', {
      kind: 'pod',
      namespace: 'default',
    });
    expect(response.text).toBe('Found 2 pods in default namespace: payment-api and web.');
    const history = session.getHistory();
    // user -> model (functionCall) -> user (functionResponse) -> model (text)
    expect(history).toHaveLength(4);
    expect(history[2].role).toBe('user');
    expect(history[2].parts[0].functionResponse?.name).toBe('k8s_get_resources');
  });

  it('TC-AI-10: GeminiSession max tool roundtrips guard prevents infinite loop', async () => {
    // Model continuously emits functionCalls without stopping
    const mockClient = {
      models: {
        generateContentStream: vi.fn().mockImplementation(async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: 'infinite_tool',
                          args: {},
                          id: 'loop-id',
                        },
                      },
                    ],
                  },
                },
              ],
            };
          },
        })),
      },
    };

    const toolHandler = vi.fn().mockResolvedValue({ ok: true });
    const session = new GeminiSession(mockClient, {
      model: 'gemini-2.0-flash',
      toolHandler,
      maxToolRoundtrips: 3,
    });

    const res = await session.sendMessage('Run infinite loop');
    expect(toolHandler).toHaveBeenCalledTimes(3);
    expect(res.functionCalls).toHaveLength(1);
  });

  it('TC-AI-11: Structured JSON output validation with Zod schema', async () => {
    const analysisSchema = z.object({
      rootCause: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      recommendedAction: z.string(),
    });

    type AnalysisResult = z.infer<typeof analysisSchema>;

    const mockOutput: AnalysisResult = {
      rootCause: 'OOMKilled due to container memory limit exhaustion (512Mi)',
      severity: 'high',
      recommendedAction: 'Increase limits.memory to 1024Mi',
    };

    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify(mockOutput),
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(mockOutput) }],
              },
            },
          ],
        }),
      },
    };

    const client = new GoogleGenAIClient(mockClient);
    await client.configure({ name: 'google-genai', password: 'mock' });

    const result = await client.getStructuredOutput<AnalysisResult>('Analyze crash', {
      validator: analysisSchema,
    });

    expect(result.rootCause).toContain('OOMKilled');
    expect(result.severity).toBe('high');
    expect(result.recommendedAction).toBe('Increase limits.memory to 1024Mi');
  });

  it('TC-AI-12: Structured JSON output error handling for malformed non-JSON output', async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: 'Sorry, I am unable to format this as valid JSON.',
        }),
      },
    };

    const client = new GoogleGenAIClient(mockClient);
    await client.configure({ name: 'google-genai', password: 'mock' });

    await expect(
      client.getStructuredOutput('Analyze crash', { schema: {} })
    ).rejects.toThrow(/Failed to parse structured JSON output/);
  });

  it('TC-AI-13: AIFactory resolution for "google-genai"', async () => {
    process.env.GEMINI_API_KEY = 'factory-test-key';
    const client = await createAIClient('google-genai');
    expect(client).toBeInstanceOf(GoogleGenAIClient);
    expect(client.name).toBe('google-genai');
  });

  it('TC-AI-14: AIFactory backward compatibility for "google-gemini"', async () => {
    await expect(createAIClient('google-gemini')).rejects.toThrow(
      'API key (password) is required for google-gemini provider'
    );
  });

  it('TC-AI-15: AIFactory alias resolution for "gemini"', async () => {
    process.env.GEMINI_API_KEY = 'factory-test-key';
    const client = await createAIClient('gemini');
    expect(client).toBeInstanceOf(GoogleGenAIClient);
    expect(client.name).toBe('google-genai');
  });
});
