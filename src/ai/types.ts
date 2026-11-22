import { AIProviderConfig } from '../config/schema';

/**
 * Interface representing a standardized AI provider client.
 */
export interface AIClient {
  /**
   * The name of the backend provider.
   */
  name: string;

  /**
   * Configures the client with the specified credentials and settings.
   * @param config The AI provider config options.
   */
  configure(config: AIProviderConfig): Promise<void>;

  /**
   * Generates a text completion based on the given prompt.
   * @param prompt The string prompt to send to the provider.
   */
  getCompletion(prompt: string): Promise<string>;

  /**
   * Optional clean up operation when the client is closed.
   */
  close?(): Promise<void>;
}

export interface FunctionCallPart {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface StreamChunk {
  text?: string;
  thought?: string;
  isThought?: boolean;
  functionCalls?: FunctionCallPart[];
  finishReason?: string;
}

export interface StreamCallbacks {
  onText?: (delta: string) => void;
  onThought?: (thoughtDelta: string) => void;
  onFunctionCall?: (functionCall: FunctionCallPart) => void;
  onError?: (error: Error) => void;
}

export interface ThinkingConfig {
  includeThoughts?: boolean;
  thinkingBudget?: number;
}

export interface GenerateContentOptions extends StreamCallbacks {
  model?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  thinkingConfig?: ThinkingConfig;
  tools?: any[]; // Tool[] or FunctionDeclaration[]
  responseSchema?: unknown;
  responseMimeType?: string;
  abortSignal?: AbortSignal;
}

export interface StructuredOutputOptions<T> {
  model?: string;
  schema?: unknown;
  systemInstruction?: string;
  temperature?: number;
  validator?: ((data: unknown) => T) | { parse: (data: unknown) => T };
}

export interface GeminiSessionOptions {
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  thinkingConfig?: ThinkingConfig;
  tools?: any[];
  toolHandler?: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  maxToolRoundtrips?: number;
}

export interface SendMessageOptions extends StreamCallbacks {
  thinkingConfig?: ThinkingConfig;
  onToolCall?: (toolCall: FunctionCallPart) => void;
  onToolResult?: (name: string, result: Record<string, unknown>) => void;
  abortSignal?: AbortSignal;
}

export interface SessionMessageResponse {
  text: string;
  thoughts: string[];
  functionCalls: FunctionCallPart[];
  history: any[];
}

export interface ModernAIClient extends AIClient {
  generateContentStream(
    promptOrParts: string | any[],
    options?: GenerateContentOptions
  ): AsyncIterable<StreamChunk>;

  createSession(options?: GeminiSessionOptions): any; // GeminiSession

  getStructuredOutput<T>(
    prompt: string,
    schemaOrOptions: unknown | StructuredOutputOptions<T>
  ): Promise<T>;
}
