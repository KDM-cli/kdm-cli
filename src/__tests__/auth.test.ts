import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerAuthCommand } from '../commands/auth';
import { getAIConfig, setAIConfig } from '../config/store';
import { createAIClient } from '../ai/factory';
import { OllamaAIClient } from '../ai/ollama';
import { OpenAIAIClient } from '../ai/openai';
import { AnthropicAIClient } from '../ai/anthropic';
import { CustomRestAIClient } from '../ai/custom-rest';
import { AzureOpenAIClient } from '../ai/azure-openai';
import { CohereAIClient } from '../ai/cohere';
import { GoogleGeminiAIClient } from '../ai/google-gemini';
import { GoogleVertexAIClient } from '../ai/google-vertex';
import { AmazonBedrockAIClient } from '../ai/amazon-bedrock';
import { HuggingFaceAIClient } from '../ai/huggingface';
import { GroqAIClient } from '../ai/groq';
import { IBMWatsonxAIClient } from '../ai/ibm-watsonx';
import { OCIGenAIClient } from '../ai/oci-genai';

const { mockStore, mockRender } = vi.hoisted(() => ({
  mockStore: { providers: [] as any[], defaultProvider: undefined as string | undefined },
  mockRender: vi.fn(() => ({ unmount: () => {} })),
}));

vi.mock('ink', () => ({
  render: mockRender,
}));

vi.mock('../config/store', () => ({
  getAIConfig: vi.fn(() => mockStore),
  setAIConfig: vi.fn((config) => {
    mockStore.providers = config.providers;
    mockStore.defaultProvider = config.defaultProvider;
  }),
}));

describe('auth command & AI clients', () => {
  let program: Command;
  let logSpy: any;
  let errorSpy: any;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    setAIConfig({ providers: [], defaultProvider: undefined });

    program = new Command();
    registerAuthCommand(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  const runAIClientTest = async (params: {
    backend: string;
    addArgs: string[];
    mockJson: any;
    expectedUrl: string;
    bodyExpectations: (body: any) => void;
    headersExpectations: (headers: any) => void;
  }) => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => params.mockJson,
    } as Response);

    await program.parseAsync(['node', 'test', 'auth', 'add', '-b', params.backend, ...params.addArgs]);
    const client = await createAIClient(params.backend);
    await client.getCompletion('test-prompt');

    expect(fetchSpy).toHaveBeenCalled();
    const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe(params.expectedUrl);
    expect(calledOptions.method).toBe('POST');
    params.bodyExpectations(JSON.parse(calledOptions.body));
    params.headersExpectations(calledOptions.headers);
  };

  it('adds a provider with defaults', async () => {
    await program.parseAsync(['node', 'test', 'auth', 'add', '-b', 'openai', '-p', 'mykey']);
    const config = getAIConfig();
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]).toEqual(
      expect.objectContaining({
        name: 'openai',
        model: 'gpt-4o',
        password: 'mykey',
        temperature: 0.7,
      }),
    );
    expect(config.defaultProvider).toBe('openai');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Successfully added AI provider "openai"'),
    );
  });

  it('rejects duplicate providers on add', async () => {
    await program.parseAsync(['node', 'test', 'auth', 'add', '-b', 'openai', '-p', 'key1']);
    await program.parseAsync(['node', 'test', 'auth', 'add', '-b', 'openai', '-p', 'key2']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already configured'));
    expect(process.exitCode).toBe(1);
  });

  it('updates an existing provider', async () => {
    await program.parseAsync(['node', 'test', 'auth', 'add', '-b', 'openai', '-p', 'key1']);
    await program.parseAsync([
      'node',
      'test',
      'auth',
      'update',
      'openai',
      '-m',
      'gpt-4-turbo',
      '-p',
      'newkey',
      '--temperature',
      '0.9',
      '--topp',
      '0.85',
      '--topk',
      '20',
      '--maxtokens',
      '500',
      '--custom-header',
      'X-Test=HeaderVal',
    ]);
    const config = getAIConfig();
    expect(config.providers[0].model).toBe('gpt-4-turbo');
    expect(config.providers[0].password).toBe('newkey');
    expect(config.providers[0].temperature).toBe(0.9);
    expect(config.providers[0].topP).toBe(0.85);
    expect(config.providers[0].topK).toBe(20);
    expect(config.providers[0].maxTokens).toBe(500);
    expect(config.providers[0].customHeaders).toEqual({ 'X-Test': 'HeaderVal' });
  });

  it('lists providers and masks secrets', async () => {
    await program.parseAsync([
      'node',
      'test',
      'auth',
      'add',
      '--backend',
      'openai',
      '--password',
      'supersecretapikey',
    ]);
    await program.parseAsync(['node', 'test', 'auth', 'list']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('openai'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('(set)'));
  });

  it('shows empty list message', async () => {
    await program.parseAsync(['node', 'test', 'auth', 'list']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No AI providers configured.'));
  });

  it('sets a default provider', async () => {
    await program.parseAsync(['node', 'test', 'auth', 'add', '-b', 'openai', '-p', 'key1']);
    await program.parseAsync(['node', 'test', 'auth', 'add', '-b', 'anthropic', '-p', 'key2']);
    await program.parseAsync(['node', 'test', 'auth', 'default', 'anthropic']);
    const config = getAIConfig();
    expect(config.defaultProvider).toBe('anthropic');
  });

  it('removes a provider', async () => {
    await program.parseAsync(['node', 'test', 'auth', 'add', '-b', 'openai', '-p', 'key1']);
    await program.parseAsync(['node', 'test', 'auth', 'remove', 'openai']);
    const config = getAIConfig();
    expect(config.providers).toHaveLength(0);
    expect(config.defaultProvider).toBeUndefined();
  });

  it('creates Noop client and returns deterministic text', async () => {
    await program.parseAsync(['node', 'test', 'auth', 'add', '-b', 'noop']);
    const client = await createAIClient('noop');
    expect(client.name).toBe('noop');
    const result = await client.getCompletion('test prompt');
    expect(result).toBe('noop completion explanation');
  });

  // Parameterized tests for various client endpoints and options to avoid CodeScene duplication
  it.each([
    {
      backend: 'customrest',
      addArgs: ['-u', 'http://custom-endpoint.com/api', '--custom-header', 'X-Key=Value', '-p', 'customkey'],
      mockJson: { response: 'custom response text' },
      expectedUrl: 'http://custom-endpoint.com/api',
      bodyExpectations: (body: any) => {
        expect(body.prompt).toBe('test-prompt');
        expect(body.temperature).toBe(0.7);
      },
      headersExpectations: (headers: any) => {
        expect(headers['X-Key']).toBe('Value');
        expect(headers['Authorization']).toBe('Bearer customkey');
      },
    },
    {
      backend: 'ollama',
      addArgs: ['-u', 'http://localhost:11434/'],
      mockJson: { response: 'ollama response' },
      expectedUrl: 'http://localhost:11434/api/generate',
      bodyExpectations: (body: any) => expect(body.prompt).toBe('test-prompt'),
      headersExpectations: () => {},
    },
    {
      backend: 'openai',
      addArgs: ['-p', 'opensecretkey', '-u', 'https://api.openai.com/v1/'],
      mockJson: { choices: [{ message: { content: 'openai reply' } }] },
      expectedUrl: 'https://api.openai.com/v1/chat/completions',
      bodyExpectations: (body: any) => expect(body.messages[0].content).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['Authorization']).toBe('Bearer opensecretkey'),
    },
    {
      backend: 'openai',
      addArgs: ['-p', 'opensecretkey', '-u', 'https://api.openai.com/v1'],
      mockJson: { choices: [{ message: { content: 'openai reply v1' } }] },
      expectedUrl: 'https://api.openai.com/v1/chat/completions',
      bodyExpectations: (body: any) => expect(body.messages[0].content).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['Authorization']).toBe('Bearer opensecretkey'),
    },
    {
      backend: 'openai',
      addArgs: ['-p', 'opensecretkey', '-u', 'https://api.openai.com/chat/completions'],
      mockJson: { choices: [{ message: { content: 'openai reply exact' } }] },
      expectedUrl: 'https://api.openai.com/chat/completions',
      bodyExpectations: (body: any) => expect(body.messages[0].content).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['Authorization']).toBe('Bearer opensecretkey'),
    },
    {
      backend: 'openai',
      addArgs: ['-p', 'opensecretkey', '-u', 'https://my-custom-endpoint.com'],
      mockJson: { choices: [{ message: { content: 'openai reply generic' } }] },
      expectedUrl: 'https://my-custom-endpoint.com/chat/completions',
      bodyExpectations: (body: any) => expect(body.messages[0].content).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['Authorization']).toBe('Bearer opensecretkey'),
    },
    {
      backend: 'anthropic',
      addArgs: ['-p', 'anthropicsecretkey', '-u', 'https://api.anthropic.com/v1/'],
      mockJson: { content: [{ text: 'claude response' }] },
      expectedUrl: 'https://api.anthropic.com/v1/messages',
      bodyExpectations: (body: any) => expect(body.messages[0].content).toBe('test-prompt'),
      headersExpectations: (headers: any) => {
        expect(headers['x-api-key']).toBe('anthropicsecretkey');
        expect(headers['anthropic-version']).toBe('2023-06-01');
      },
    },
    {
      backend: 'anthropic',
      addArgs: ['-p', 'anthropicsecretkey', '-u', 'https://api.anthropic.com/v1'],
      mockJson: { content: [{ text: 'claude response v1' }] },
      expectedUrl: 'https://api.anthropic.com/v1/messages',
      bodyExpectations: (body: any) => expect(body.messages[0].content).toBe('test-prompt'),
      headersExpectations: (headers: any) => {
        expect(headers['x-api-key']).toBe('anthropicsecretkey');
        expect(headers['anthropic-version']).toBe('2023-06-01');
      },
    },
    {
      backend: 'anthropic',
      addArgs: ['-p', 'anthropicsecretkey', '-u', 'https://api.anthropic.com/messages'],
      mockJson: { content: [{ text: 'claude response exact' }] },
      expectedUrl: 'https://api.anthropic.com/messages',
      bodyExpectations: (body: any) => expect(body.messages[0].content).toBe('test-prompt'),
      headersExpectations: (headers: any) => {
        expect(headers['x-api-key']).toBe('anthropicsecretkey');
      },
    },
    {
      backend: 'anthropic',
      addArgs: ['-p', 'anthropicsecretkey', '-u', 'https://my-custom-endpoint.com'],
      mockJson: { content: [{ text: 'claude response generic' }] },
      expectedUrl: 'https://my-custom-endpoint.com/messages',
      bodyExpectations: (body: any) => expect(body.messages[0].content).toBe('test-prompt'),
      headersExpectations: (headers: any) => {
        expect(headers['x-api-key']).toBe('anthropicsecretkey');
      },
    },
    {
      backend: 'azure-openai',
      addArgs: ['-p', 'azurekey', '-u', 'https://endpoint.openai.azure.com'],
      mockJson: { choices: [{ message: { content: 'azure response' } }] },
      expectedUrl: 'https://endpoint.openai.azure.com/openai/deployments/gpt-4/chat/completions?api-version=2024-02-01',
      bodyExpectations: (body: any) => expect(body.messages[0].content).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['api-key']).toBe('azurekey'),
    },
    {
      backend: 'cohere',
      addArgs: ['-p', 'coherekey'],
      mockJson: { text: 'cohere response' },
      expectedUrl: 'https://api.cohere.ai/v1/chat',
      bodyExpectations: (body: any) => expect(body.message).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['Authorization']).toBe('Bearer coherekey'),
    },
    {
      backend: 'google-gemini',
      addArgs: ['-p', 'geminikey'],
      mockJson: { candidates: [{ content: { parts: [{ text: 'gemini response' }] } }] },
      expectedUrl: 'https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=geminikey',
      bodyExpectations: (body: any) => expect(body.contents[0].parts[0].text).toBe('test-prompt'),
      headersExpectations: () => {},
    },
    {
      backend: 'google-vertex',
      addArgs: ['-p', 'vertexkey', '-u', 'https://us-central1-aiplatform.googleapis.com'],
      mockJson: { candidates: [{ content: { parts: [{ text: 'vertex response' }] } }] },
      expectedUrl: 'https://us-central1-aiplatform.googleapis.com/v1/projects/-/locations/-/publishers/google/models/gemini-pro:generateContent',
      bodyExpectations: (body: any) => expect(body.contents[0].parts[0].text).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['Authorization']).toBe('Bearer vertexkey'),
    },
    {
      backend: 'amazon-bedrock',
      addArgs: ['-p', 'bedrockkey', '-u', 'https://bedrock.us-east-1.amazonaws.com'],
      mockJson: { results: [{ outputText: 'bedrock response' }] },
      expectedUrl: 'https://bedrock.us-east-1.amazonaws.com/model/anthropic.claude-v2/invoke',
      bodyExpectations: (body: any) => expect(body.inputText).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['Authorization']).toBe('Bearer bedrockkey'),
    },
    {
      backend: 'huggingface',
      addArgs: ['-p', 'hfkey'],
      mockJson: [{ generated_text: 'hf response' }],
      expectedUrl: 'https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1',
      bodyExpectations: (body: any) => expect(body.inputs).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['Authorization']).toBe('Bearer hfkey'),
    },
    {
      backend: 'groq',
      addArgs: ['-p', 'groqkey'],
      mockJson: { choices: [{ message: { content: 'groq response' } }] },
      expectedUrl: 'https://api.groq.com/openai/v1/chat/completions',
      bodyExpectations: (body: any) => expect(body.messages[0].content).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['Authorization']).toBe('Bearer groqkey'),
    },
    {
      backend: 'ibm-watsonx',
      addArgs: ['-p', 'watsonkey', '-u', 'https://us-south.ml.cloud.ibm.com', '--custom-header', 'X-Project-Id=watsonproj'],
      mockJson: { results: [{ generated_text: 'watson response' }] },
      expectedUrl: 'https://us-south.ml.cloud.ibm.com/ml/v1/text/generation?version=2024-03-14',
      bodyExpectations: (body: any) => expect(body.input).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['Authorization']).toBe('Bearer watsonkey'),
    },
    {
      backend: 'oci-genai',
      addArgs: ['-p', 'ocikey', '-u', 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com', '--custom-header', 'X-Compartment-Id=ocicompartment'],
      mockJson: { inferenceResponse: { generatedTexts: [{ text: 'oci response' }] } },
      expectedUrl: 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/20231130/actions/generateText',
      bodyExpectations: (body: any) => expect(body.inferenceRequest.prompt).toBe('test-prompt'),
      headersExpectations: (headers: any) => expect(headers['Authorization']).toBe('Bearer ocikey'),
    },
  ])(
    'queries $backend provider client completion with url options: $addArgs',
    async ({ backend, addArgs, mockJson, expectedUrl, bodyExpectations, headersExpectations }) => {
      await runAIClientTest({
        backend,
        addArgs,
        mockJson,
        expectedUrl,
        bodyExpectations,
        headersExpectations,
      });
    },
  );

  // Testing client configure default/fallback branches
  it('covers fallback default configurations', async () => {
    const ollama = new OllamaAIClient();
    await ollama.configure({ name: 'ollama' });
    // Verify default options
    expect((ollama as any).config.baseUrl).toBe('http://localhost:11434');
    expect((ollama as any).config.model).toBe('llama3.1');

    const openai = new OpenAIAIClient();
    await openai.configure({ name: 'openai', password: 'key' });
    expect((openai as any).config.baseUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect((openai as any).config.model).toBe('gpt-4o');

    const anthropic = new AnthropicAIClient();
    await anthropic.configure({ name: 'anthropic', password: 'key' });
    expect((anthropic as any).config.baseUrl).toBe('https://api.anthropic.com/v1/messages');
    expect((anthropic as any).config.model).toBe('claude-3-5-sonnet-latest');

    const azure = new AzureOpenAIClient();
    await azure.configure({ name: 'azure-openai', password: 'key', baseUrl: 'http://azure' });
    expect((azure as any).model).toBe('gpt-4');

    const cohere = new CohereAIClient();
    await cohere.configure({ name: 'cohere' });
    expect((cohere as any).model).toBe('command-r-plus');

    const gemini = new GoogleGeminiAIClient();
    await gemini.configure({ name: 'google-gemini' });
    expect((gemini as any).model).toBe('gemini-pro');

    const vertex = new GoogleVertexAIClient();
    await vertex.configure({ name: 'google-vertex' });
    expect((vertex as any).model).toBe('gemini-pro');

    const bedrock = new AmazonBedrockAIClient();
    await bedrock.configure({ name: 'amazon-bedrock' });
    expect((bedrock as any).model).toBe('anthropic.claude-v2');

    const hf = new HuggingFaceAIClient();
    await hf.configure({ name: 'huggingface' });
    expect((hf as any).model).toBe('mistralai/Mixtral-8x7B-Instruct-v0.1');

    const groq = new GroqAIClient();
    await groq.configure({ name: 'groq' });
    expect((groq as any).model).toBe('llama3-70b-8192');

    const watson = new IBMWatsonxAIClient();
    await watson.configure({ name: 'ibm-watsonx' });
    expect((watson as any).baseUrl).toBe('https://us-south.ml.cloud.ibm.com');
    expect((watson as any).model).toBe('ibm/granite-13b-instruct-v2');

    const oci = new OCIGenAIClient();
    await oci.configure({ name: 'oci-genai' });
    expect((oci as any).baseUrl).toBe('https://inference.generativeai.us-chicago-1.oci.oraclecloud.com');
    expect((oci as any).model).toBe('cohere.command-r-plus');
  });

  // Testing failed completion scenarios
  it.each([
    { ClientClass: OpenAIAIClient, name: 'openai', config: { name: 'openai', password: 'key' } },
    { ClientClass: AnthropicAIClient, name: 'anthropic', config: { name: 'anthropic', password: 'key' } },
    { ClientClass: OllamaAIClient, name: 'ollama', config: { name: 'ollama' } },
    { ClientClass: CustomRestAIClient, name: 'customrest', config: { name: 'customrest', baseUrl: 'http://test' } },
    { ClientClass: AzureOpenAIClient, name: 'azure-openai', config: { name: 'azure-openai', password: 'key', baseUrl: 'http://test' } },
    { ClientClass: CohereAIClient, name: 'cohere', config: { name: 'cohere', password: 'key' } },
    { ClientClass: GoogleGeminiAIClient, name: 'google-gemini', config: { name: 'google-gemini', password: 'key' } },
    { ClientClass: GoogleVertexAIClient, name: 'google-vertex', config: { name: 'google-vertex', password: 'key', baseUrl: 'http://test' } },
    { ClientClass: AmazonBedrockAIClient, name: 'amazon-bedrock', config: { name: 'amazon-bedrock', password: 'key', baseUrl: 'http://test' } },
    { ClientClass: HuggingFaceAIClient, name: 'huggingface', config: { name: 'huggingface', password: 'key' } },
    { ClientClass: GroqAIClient, name: 'groq', config: { name: 'groq', password: 'key' } },
    { ClientClass: IBMWatsonxAIClient, name: 'ibm-watsonx', config: { name: 'ibm-watsonx', password: 'key', baseUrl: 'http://test' } },
    { ClientClass: OCIGenAIClient, name: 'oci-genai', config: { name: 'oci-genai', password: 'key', baseUrl: 'http://test' } },
  ])('fails getCompletion on non-ok HTTP responses for $name', async ({ ClientClass, config }) => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    const client = new ClientClass();
    await client.configure(config);
    await expect(client.getCompletion('fail')).rejects.toThrow('failed with status 500');
  });

  // Client validation checks
  it('validates required configuration inputs', async () => {
    const openai = new OpenAIAIClient();
    await expect(openai.configure({ name: 'openai' })).rejects.toThrow(
      'API key (password) is required for openai',
    );

    const anthropic = new AnthropicAIClient();
    await expect(anthropic.configure({ name: 'anthropic' })).rejects.toThrow(
      'API key (password) is required for anthropic',
    );

    const customrest = new CustomRestAIClient();
    await expect(customrest.configure({ name: 'customrest' })).rejects.toThrow(
      'baseUrl is required for customrest',
    );
  });

  it('handles client validation errors', async () => {
    await expect(createAIClient('unsupported')).rejects.toThrow('Unsupported AI provider');
  });

  it('handles auth operations on missing providers', async () => {
    await program.parseAsync(['node', 'test', 'auth', 'update', 'openai', '-m', 'some-model']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('is not configured'));
    expect(process.exitCode).toBe(1);

    errorSpy.mockClear();
    process.exitCode = undefined;
    await program.parseAsync(['node', 'test', 'auth', 'default', 'openai']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('is not configured'));
    expect(process.exitCode).toBe(1);

    errorSpy.mockClear();
    process.exitCode = undefined;
    await program.parseAsync(['node', 'test', 'auth', 'remove', 'openai']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('is not configured'));
    expect(process.exitCode).toBe(1);
  });

  it('validates invalid backend parameter on add, update, default, remove', async () => {
    // resolveNewBackend validation
    await program.parseAsync(['node', 'test', 'auth', 'add', '-b', 'invalid-backend']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported backend'));
    expect(process.exitCode).toBe(1);

    // resolveProviderContext validation
    errorSpy.mockClear();
    process.exitCode = undefined;
    await program.parseAsync(['node', 'test', 'auth', 'update', 'invalid-backend']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported backend'));
    expect(process.exitCode).toBe(1);

    errorSpy.mockClear();
    process.exitCode = undefined;
    await program.parseAsync(['node', 'test', 'auth', 'default', 'invalid-backend']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported backend'));
    expect(process.exitCode).toBe(1);

    errorSpy.mockClear();
    process.exitCode = undefined;
    await program.parseAsync(['node', 'test', 'auth', 'remove', 'invalid-backend']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported backend'));
    expect(process.exitCode).toBe(1);
  });

  it('creates AI client without configuration (using default/fallback config)', async () => {
    const client = await createAIClient('noop');
    expect(client.name).toBe('noop');
  });

  it('runs interactive auth dashboard command action handler', async () => {
    const originalStdoutTTY = process.stdout.isTTY;
    const originalStdinTTY = process.stdin.isTTY;
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      // 1. Non-TTY scenario
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      await program.parseAsync(['node', 'test', 'auth']);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('requires a TTY terminal'));
      expect(process.exitCode).toBe(1);

      errorSpy.mockClear();
      process.exitCode = undefined;

      // 2. TTY scenario
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

      mockRender.mockClear();
      await program.parseAsync(['node', 'test', 'auth']);
      expect(writeSpy).toHaveBeenCalledWith('\x1Bc');
      expect(mockRender).toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinTTY, configurable: true });
      writeSpy.mockRestore();
    }
  });
});
