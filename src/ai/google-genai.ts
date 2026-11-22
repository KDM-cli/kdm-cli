import { GoogleGenAI } from '@google/genai';
import { AIProviderConfig } from '../config/schema';
import {
  AIClient,
  FunctionCallPart,
  GeminiSessionOptions,
  GenerateContentOptions,
  ModernAIClient,
  StreamChunk,
  StructuredOutputOptions,
  ThinkingConfig,
} from './types';
import { GeminiSession, normalizeTools } from './gemini-session';

export { normalizeTools };

export class GoogleGenAIClient implements ModernAIClient, AIClient {
  readonly name = 'google-genai';
  private client?: any;
  private apiKey = '';
  private model = 'gemini-2.0-flash';
  private temperature = 0.7;
  private topP?: number;
  private topK?: number;
  private maxOutputTokens?: number;
  private baseUrl?: string;
  private customHeaders?: Record<string, string>;
  private thinkingConfig?: ThinkingConfig;

  constructor(clientInstance?: any) {
    if (clientInstance) {
      this.client = clientInstance;
    }
  }

  setClient(client: any): void {
    this.client = client;
  }

  async configure(config: AIProviderConfig): Promise<void> {
    const key =
      config.password ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.GOOGLE_API_KEY;

    if (!key && !this.client) {
      throw new Error('API key is required for Google GenAI provider (password field in AIProviderConfig)');
    }

    this.apiKey = key ?? '';
    this.model = config.model || 'gemini-2.0-flash';
    this.temperature = config.temperature ?? 0.7;
    this.topP = config.topP;
    this.topK = config.topK;
    this.maxOutputTokens = config.maxTokens;
    this.baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : undefined;
    this.customHeaders = config.customHeaders;

    if (!this.client) {
      const options: any = { apiKey: this.apiKey };
      if (this.baseUrl) options.baseUrl = this.baseUrl;
      if (this.customHeaders) options.httpOptions = { headers: this.customHeaders };
      this.client = new GoogleGenAI(options);
    }
  }

  async getCompletion(prompt: string): Promise<string> {
    if (!this.client) {
      throw new Error('GoogleGenAIClient is not configured. Call configure() before use.');
    }
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        temperature: this.temperature,
        topP: this.topP,
        topK: this.topK,
        maxOutputTokens: this.maxOutputTokens,
      },
    });

    if (response.text !== undefined && response.text !== null) {
      return response.text;
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    return parts
      .filter((p: any) => !p.thought && p.text)
      .map((p: any) => p.text)
      .join('');
  }

  async *generateContentStream(
    promptOrParts: string | any[],
    options?: GenerateContentOptions
  ): AsyncIterable<StreamChunk> {
    if (!this.client) {
      throw new Error('GoogleGenAIClient is not configured. Call configure() before use.');
    }

    const contents =
      typeof promptOrParts === 'string'
        ? [{ role: 'user', parts: [{ text: promptOrParts }] }]
        : promptOrParts;

    const stream = await this.client.models.generateContentStream({
      model: options?.model ?? this.model,
      contents,
      config: {
        temperature: options?.temperature ?? this.temperature,
        topP: options?.topP ?? this.topP,
        topK: options?.topK ?? this.topK,
        maxOutputTokens: options?.maxOutputTokens ?? this.maxOutputTokens,
        systemInstruction: options?.systemInstruction,
        thinkingConfig: options?.thinkingConfig ?? this.thinkingConfig,
        tools: normalizeTools(options?.tools),
        responseMimeType: options?.responseMimeType,
        responseSchema: options?.responseSchema,
        abortSignal: options?.abortSignal,
      },
    });

    for await (const chunk of stream) {
      let thoughtDelta = '';
      let textDelta = '';
      const functionCalls: FunctionCallPart[] = [];

      if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
        for (const part of chunk.candidates[0].content.parts) {
          if (part.thought && part.text) {
            thoughtDelta += part.text;
            options?.onThought?.(part.text);
          } else if (!part.thought && part.text) {
            textDelta += part.text;
            options?.onText?.(part.text);
          }
          if (part.functionCall) {
            const fc: FunctionCallPart = {
              name: part.functionCall.name ?? '',
              args: (part.functionCall.args as Record<string, unknown>) ?? {},
              id: part.functionCall.id,
            };
            functionCalls.push(fc);
            options?.onFunctionCall?.(fc);
          }
        }
      }

      if (!textDelta && chunk.text && !thoughtDelta) {
        textDelta = chunk.text;
        options?.onText?.(chunk.text);
      }

      if (chunk.functionCalls && functionCalls.length === 0) {
        for (const fc of chunk.functionCalls) {
          const partFc: FunctionCallPart = {
            name: fc.name ?? '',
            args: (fc.args as Record<string, unknown>) ?? {},
            id: fc.id,
          };
          functionCalls.push(partFc);
          options?.onFunctionCall?.(partFc);
        }
      }

      yield {
        text: textDelta || undefined,
        thought: thoughtDelta || undefined,
        isThought: Boolean(thoughtDelta),
        functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
        finishReason: chunk.candidates?.[0]?.finishReason,
      };
    }
  }

  createSession(options?: GeminiSessionOptions): GeminiSession {
    if (!this.client) {
      throw new Error('GoogleGenAIClient is not configured. Call configure() before use.');
    }
    return new GeminiSession(this.client, {
      model: options?.model ?? this.model,
      temperature: options?.temperature ?? this.temperature,
      thinkingConfig: options?.thinkingConfig ?? this.thinkingConfig,
      ...options,
    });
  }

  async getStructuredOutput<T>(
    prompt: string,
    schemaOrOptions: unknown | StructuredOutputOptions<T>
  ): Promise<T> {
    if (!this.client) {
      throw new Error('GoogleGenAIClient is not configured. Call configure() before use.');
    }

    const isOptions =
      schemaOrOptions &&
      typeof schemaOrOptions === 'object' &&
      ('schema' in (schemaOrOptions as any) || 'validator' in (schemaOrOptions as any));
    const options = isOptions
      ? (schemaOrOptions as StructuredOutputOptions<T>)
      : { schema: schemaOrOptions };

    const response = await this.client.models.generateContent({
      model: options.model ?? this.model,
      contents: prompt,
      config: {
        temperature: options.temperature ?? 0.1,
        systemInstruction: options.systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: options.schema,
      },
    });

    let rawText = response.text ?? '';
    if (!rawText.trim()) {
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      rawText = parts
        .filter((p: any) => !p.thought && p.text)
        .map((p: any) => p.text)
        .join('');
    }

    if (!rawText.trim()) {
      throw new Error('Google GenAI returned empty response for structured output request');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (err: any) {
      throw new Error(`Failed to parse structured JSON output from Gemini: ${err.message}. Response was: ${rawText}`);
    }

    if (options.validator) {
      if (typeof (options.validator as any).parse === 'function') {
        return (options.validator as any).parse(parsed);
      }
      return (options.validator as (data: unknown) => T)(parsed);
    }

    return parsed as T;
  }

  async close(): Promise<void> {
    this.client = undefined;
  }
}
