import { AIClient } from './types';
import { AIProviderConfig } from '../config/schema';

/**
 * AI client implementation for Azure OpenAI Service.
 * Sends prompts to the Azure OpenAI chat completions endpoint.
 */
export class AzureOpenAIClient implements AIClient {
  readonly name = 'azure-openai';
  private baseUrl = '';
  private apiKey = '';
  private model = '';
  private temperature = 0.7;
  private customHeaders: Record<string, string> = {};

  /**
   * Configures the Azure OpenAI client with deployment endpoint and credentials.
   * @param config The provider configuration.
   */
  async configure(config: AIProviderConfig): Promise<void> {
    if (!config.baseUrl || !config.password) {
      throw new Error('Azure OpenAI baseUrl and password (api-key) are required.');
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.password;
    this.model = config.model ?? 'gpt-4';
    this.temperature = config.temperature ?? 0.7;
    this.customHeaders = config.customHeaders ?? {};
  }

  /**
   * Sends a chat completion request to Azure OpenAI.
   * @param prompt The string prompt.
   * @returns AI-generated response text.
   */
  async getCompletion(prompt: string): Promise<string> {
    const url = `${this.baseUrl}/openai/deployments/${this.model}/chat/completions?api-version=2024-02-01`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
        ...this.customHeaders
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        temperature: this.temperature,
      }),
    });
    if (!response.ok) {
      throw new Error(`Azure OpenAI API call failed with status ${response.status}: ${response.statusText}`);
    }
    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content ?? '';
  }
}
