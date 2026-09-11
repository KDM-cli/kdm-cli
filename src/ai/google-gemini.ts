import { AIClient } from './types';
import { AIProviderConfig } from '../config/schema';

/**
 * AI client implementation for Google Gemini API.
 */
export class GoogleGeminiAIClient implements AIClient {
  readonly name = 'google-gemini';
  private baseUrl = 'https://generativelanguage.googleapis.com';
  private apiKey = '';
  private model = '';
  private temperature = 0.7;
  private customHeaders?: Record<string, string>;

  /**
   * Configures the Google Gemini client with API credentials.
   * @param config The provider configuration.
   */
  async configure(config: AIProviderConfig): Promise<void> {
    if (!config.password) {
      throw new Error('API key (password) is required for google-gemini provider');
    }
    this.baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://generativelanguage.googleapis.com';
    this.apiKey = config.password;
    this.model = config.model ?? 'gemini-pro';
    this.temperature = config.temperature ?? 0.7;
    this.customHeaders = config.customHeaders;
  }

  /**
   * Sends a content generation request to Google Gemini.
   * @param prompt The string prompt.
   * @returns AI-generated response text.
   */
  async getCompletion(prompt: string): Promise<string> {
    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
        ...this.customHeaders,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: this.temperature },
      }),
    });
    if (!response.ok) {
      throw new Error(`Google Gemini API call failed with status ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }
}
