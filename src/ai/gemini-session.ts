import {
  FunctionCallPart,
  GeminiSessionOptions,
  SendMessageOptions,
  SessionMessageResponse,
  StreamChunk,
  ThinkingConfig,
} from './types';

export type {
  FunctionCallPart,
  GeminiSessionOptions,
  SendMessageOptions,
  SessionMessageResponse,
  StreamChunk,
  ThinkingConfig,
};

export function normalizeTools(tools?: any[]): any[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  if ('functionDeclarations' in tools[0] || 'googleSearch' in tools[0] || 'codeExecution' in tools[0]) {
    return tools;
  }
  return [{ functionDeclarations: tools }];
}

export interface ContentPart {
  text?: string;
  thought?: boolean;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
    id?: string;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
    id?: string;
  };
}

export interface SessionContent {
  role: 'user' | 'model';
  parts: ContentPart[];
}

export class GeminiSession {
  private client: any;
  private model: string;
  private history: SessionContent[] = [];
  private systemInstruction?: string;
  private temperature: number;
  private thinkingConfig?: ThinkingConfig;
  private tools?: any[];
  private toolHandler?: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  private maxToolRoundtrips: number;

  constructor(client: any, options?: GeminiSessionOptions) {
    this.client = client;
    this.model = options?.model ?? 'gemini-2.0-flash';
    this.systemInstruction = options?.systemInstruction;
    this.temperature = options?.temperature ?? 0.7;
    this.thinkingConfig = options?.thinkingConfig;
    this.tools = normalizeTools(options?.tools);
    this.toolHandler = options?.toolHandler;
    this.maxToolRoundtrips = options?.maxToolRoundtrips ?? 10;
  }

  getHistory(): SessionContent[] {
    return JSON.parse(JSON.stringify(this.history));
  }

  setHistory(history: SessionContent[]): void {
    this.history = JSON.parse(JSON.stringify(history));
  }

  clearHistory(): void {
    this.history = [];
  }

  async sendMessage(
    message: string,
    options?: SendMessageOptions
  ): Promise<SessionMessageResponse> {
    this.history.push({
      role: 'user',
      parts: [{ text: message }],
    });

    let currentText = '';
    const allThoughts: string[] = [];
    let pendingFunctionCalls: FunctionCallPart[] = [];
    let roundtrips = 0;

    while (roundtrips < this.maxToolRoundtrips) {
      roundtrips++;
      currentText = '';
      pendingFunctionCalls = [];

      const stream = await this.client.models.generateContentStream({
        model: this.model,
        contents: this.history,
        config: {
          systemInstruction: this.systemInstruction,
          temperature: this.temperature,
          thinkingConfig: options?.thinkingConfig ?? this.thinkingConfig,
          tools: this.tools,
          abortSignal: options?.abortSignal,
        },
      });

      for await (const chunk of stream) {
        if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
          for (const part of chunk.candidates[0].content.parts) {
            if (part.thought && part.text) {
              allThoughts.push(part.text);
              options?.onThought?.(part.text);
            } else if (!part.thought && part.text) {
              currentText += part.text;
              options?.onText?.(part.text);
            }
            if (part.functionCall) {
              pendingFunctionCalls.push({
                name: part.functionCall.name ?? '',
                args: (part.functionCall.args as Record<string, unknown>) ?? {},
                id: part.functionCall.id,
              });
            }
          }
        }

        if (!currentText && chunk.text) {
          currentText += chunk.text;
          options?.onText?.(chunk.text);
        }

        if (chunk.functionCalls && pendingFunctionCalls.length === 0) {
          for (const fc of chunk.functionCalls) {
            pendingFunctionCalls.push({
              name: fc.name ?? '',
              args: (fc.args as Record<string, unknown>) ?? {},
              id: fc.id,
            });
          }
        }
      }

      if (pendingFunctionCalls.length === 0) {
        this.history.push({
          role: 'model',
          parts: [{ text: currentText }],
        });
        break;
      }

      this.history.push({
        role: 'model',
        parts: pendingFunctionCalls.map((fc) => ({
          functionCall: {
            name: fc.name,
            args: fc.args,
            id: fc.id,
          },
        })),
      });

      if (!this.toolHandler) {
        break;
      }

      const functionResponses: ContentPart[] = [];
      for (const fc of pendingFunctionCalls) {
        options?.onToolCall?.(fc);
        let result: Record<string, unknown>;
        try {
          result = await this.toolHandler(fc.name, fc.args);
        } catch (err: any) {
          result = { error: err.message ?? String(err) };
        }
        options?.onToolResult?.(fc.name, result);
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: result,
            id: fc.id,
          },
        });
      }

      this.history.push({
        role: 'user',
        parts: functionResponses,
      });
    }

    return {
      text: currentText,
      thoughts: allThoughts,
      functionCalls: pendingFunctionCalls,
      history: this.getHistory(),
    };
  }

  async *sendMessageStream(
    message: string,
    options?: SendMessageOptions
  ): AsyncIterable<StreamChunk> {
    this.history.push({
      role: 'user',
      parts: [{ text: message }],
    });

    let roundtrips = 0;
    while (roundtrips < this.maxToolRoundtrips) {
      roundtrips++;
      let currentText = '';
      const pendingFunctionCalls: FunctionCallPart[] = [];

      const stream = await this.client.models.generateContentStream({
        model: this.model,
        contents: this.history,
        config: {
          systemInstruction: this.systemInstruction,
          temperature: this.temperature,
          thinkingConfig: options?.thinkingConfig ?? this.thinkingConfig,
          tools: this.tools,
          abortSignal: options?.abortSignal,
        },
      });

      for await (const chunk of stream) {
        let thoughtDelta = '';
        let textDelta = '';
        const chunkFunctionCalls: FunctionCallPart[] = [];

        if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
          for (const part of chunk.candidates[0].content.parts) {
            if (part.thought && part.text) {
              thoughtDelta += part.text;
              options?.onThought?.(part.text);
            } else if (!part.thought && part.text) {
              textDelta += part.text;
              currentText += part.text;
              options?.onText?.(part.text);
            }
            if (part.functionCall) {
              const fc: FunctionCallPart = {
                name: part.functionCall.name ?? '',
                args: (part.functionCall.args as Record<string, unknown>) ?? {},
                id: part.functionCall.id,
              };
              chunkFunctionCalls.push(fc);
              pendingFunctionCalls.push(fc);
            }
          }
        }

        if (!textDelta && chunk.text && !thoughtDelta) {
          textDelta = chunk.text;
          currentText += chunk.text;
          options?.onText?.(chunk.text);
        }

        if (chunk.functionCalls && chunkFunctionCalls.length === 0) {
          for (const fc of chunk.functionCalls) {
            const partFc: FunctionCallPart = {
              name: fc.name ?? '',
              args: (fc.args as Record<string, unknown>) ?? {},
              id: fc.id,
            };
            chunkFunctionCalls.push(partFc);
            pendingFunctionCalls.push(partFc);
          }
        }

        yield {
          text: textDelta || undefined,
          thought: thoughtDelta || undefined,
          isThought: Boolean(thoughtDelta),
          functionCalls: chunkFunctionCalls.length > 0 ? chunkFunctionCalls : undefined,
          finishReason: chunk.candidates?.[0]?.finishReason,
        };
      }

      if (pendingFunctionCalls.length === 0) {
        this.history.push({
          role: 'model',
          parts: [{ text: currentText }],
        });
        break;
      }

      this.history.push({
        role: 'model',
        parts: pendingFunctionCalls.map((fc) => ({
          functionCall: {
            name: fc.name,
            args: fc.args,
            id: fc.id,
          },
        })),
      });

      if (!this.toolHandler) {
        break;
      }

      const functionResponses: ContentPart[] = [];
      for (const fc of pendingFunctionCalls) {
        options?.onToolCall?.(fc);
        let result: Record<string, unknown>;
        try {
          result = await this.toolHandler(fc.name, fc.args);
        } catch (err: any) {
          result = { error: err.message ?? String(err) };
        }
        options?.onToolResult?.(fc.name, result);
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: result,
            id: fc.id,
          },
        });
      }

      this.history.push({
        role: 'user',
        parts: functionResponses,
      });
    }
  }
}
