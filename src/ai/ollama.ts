import { AIClient } from './types';
import { AIProviderConfig } from '../config/schema';

/**
 * AI client implementation for querying local Ollama models.
 */
export class OllamaAIClient implements AIClient {
  readonly name = 'ollama';
  private config!: AIProviderConfig;

  /**
   * Returns the configured model name.
   */
  get model(): string {
    return this.config?.model || '';
  }

  /**
   * Configures the client, defaulting base url to localhost if unspecified.
   * @param config The provider configuration.
   */
  async configure(config: AIProviderConfig): Promise<void> {
    this.config = {
      ...config,
      baseUrl: config.baseUrl ?? 'http://localhost:11434',
      model: config.model || 'llama3.1',
    };
  }

  /**
   * Sends a completion request to local Ollama generate API.
   * @param prompt The string prompt.
   * @returns The generated response string.
   */
  async getCompletion(prompt: string): Promise<string> {
    let url = this.config.baseUrl!;
    if (!url.endsWith('/api/generate')) {
      url = url.replace(/\/$/, '') + '/api/generate';
    }

    const body = {
      model: this.config.model,
      prompt,
      stream: false,
      options: {
        temperature: this.config.temperature ?? 0.7,
        top_p: this.config.topP ?? 1,
        top_k: this.config.topK ?? 50,
        num_predict: this.config.maxTokens ?? 2048,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.customHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama API call failed with status ${res.status}: ${res.statusText}`);
    }

    const data: any = await res.json();
    return data.response;
  }
}
