import { vi } from 'vitest';

export interface MockGenAIPart {
  text?: string;
  thought?: boolean;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
}

export interface MockGenAICandidate {
  content: {
    parts: MockGenAIPart[];
    role?: string;
  };
  finishReason?: string;
}

export interface MockGenAIChunk {
  text?: string;
  candidates?: MockGenAICandidate[];
  thought?: string;
  functionCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}

export interface MockGenAIClientOptions {
  shouldFail?: boolean;
  failError?: Error;
}

export class MockGenAIStreamBuilder {
  private chunks: MockGenAIChunk[] = [];
  private shouldFail = false;
  private failAfterChunks = -1;
  private failError: Error = new Error('Simulated GenAI stream failure');

  /**
   * Appends reasoning/thought tokens (thinking mode).
   */
  addThought(thought: string): this {
    this.chunks.push({
      thought,
      candidates: [
        {
          content: {
            parts: [{ thought: true, text: thought }],
            role: 'model',
          },
        },
      ],
    });
    return this;
  }

  /**
   * Appends regular generated text chunk.
   */
  addText(text: string): this {
    this.chunks.push({
      text,
      candidates: [
        {
          content: {
            parts: [{ text }],
            role: 'model',
          },
        },
      ],
    });
    return this;
  }

  /**
   * Appends a function call / tool invocation part.
   */
  addFunctionCall(name: string, args: Record<string, unknown>): this {
    this.chunks.push({
      functionCalls: [{ name, args }],
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name, args } }],
            role: 'model',
          },
        },
      ],
    });
    return this;
  }

  /**
   * Configures the stream to abort with an error after yielding N chunks.
   */
  simulateError(error: Error, afterChunks = 0): this {
    this.shouldFail = true;
    this.failError = error;
    this.failAfterChunks = afterChunks;
    return this;
  }

  /**
   * Converts the recorded chunks into an AsyncIterable compatible with @google/genai stream.
   */
  toAsyncIterable(): AsyncIterable<{ text?: string; candidates?: MockGenAICandidate[] }> {
    const chunks = this.chunks;
    const shouldFail = this.shouldFail;
    const failAfter = this.failAfterChunks;
    const failErr = this.failError;

    return {
      async *[Symbol.asyncIterator]() {
        let count = 0;
        for (const chunk of chunks) {
          if (shouldFail && count >= failAfter) {
            throw failErr;
          }
          count++;
          yield {
            text: chunk.text ?? '',
            candidates: chunk.candidates ?? [
              {
                content: {
                  parts: chunk.thought
                    ? [{ thought: true, text: chunk.thought }]
                    : chunk.text
                    ? [{ text: chunk.text }]
                    : [],
                  role: 'model',
                },
              },
            ],
          };
        }
        if (shouldFail && count >= failAfter) {
          throw failErr;
        }
      },
    };
  }

  /**
   * Returns complete text aggregated across all text chunks.
   */
  getFullText(): string {
    return this.chunks.map((c) => c.text || '').join('');
  }

  /**
   * Returns all thoughts aggregated across all thought chunks.
   */
  getFullThoughts(): string[] {
    return this.chunks.filter((c) => c.thought).map((c) => c.thought as string);
  }

  /**
   * Returns all function calls in sequence.
   */
  getFunctionCalls(): Array<{ name: string; args: Record<string, unknown> }> {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    for (const chunk of this.chunks) {
      if (chunk.functionCalls) {
        calls.push(...chunk.functionCalls);
      }
    }
    return calls;
  }

  /**
   * Instantiates a mock GoogleGenAI client instance with generateContentStream and generateContent.
   */
  createMockClient() {
    const stream = this.toAsyncIterable();
    const fullText = this.getFullText();
    const functionCalls = this.getFunctionCalls();

    const generateContentStream = vi.fn().mockImplementation(async () => stream);
    const generateContent = vi.fn().mockImplementation(async () => {
      if (this.shouldFail) {
        throw this.failError;
      }
      return {
        text: fullText,
        candidates: [
          {
            content: {
              parts: [
                ...this.getFullThoughts().map((t) => ({ thought: true, text: t })),
                ...(fullText ? [{ text: fullText }] : []),
                ...functionCalls.map((fc) => ({ functionCall: fc })),
              ],
              role: 'model',
            },
          },
        ],
      };
    });

    return {
      models: {
        generateContentStream,
        generateContent,
      },
    };
  }
}
