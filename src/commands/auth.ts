import { Command } from 'commander';
import chalk from 'chalk';
import { getAIConfig, setAIConfig } from '../config/store';
import { type AIProviderConfig } from '../config/schema';

const VALID_BACKENDS = new Set([
  'openai',
  'ollama',
  'anthropic',
  'noop',
  'customrest',
  'azure-openai',
  'cohere',
  'google-gemini',
  'google-vertex',
  'amazon-bedrock',
  'huggingface',
  'groq',
  'ibm-watsonx',
  'oci-genai',
]);

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-latest',
  ollama: 'llama3.1',
  'azure-openai': 'gpt-4',
  cohere: 'command-r-plus',
  'google-gemini': 'gemini-pro',
  'google-vertex': 'gemini-pro',
  'amazon-bedrock': 'anthropic.claude-v2',
  huggingface: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
  groq: 'llama3-70b-8192',
  'ibm-watsonx': 'ibm/granite-13b-instruct-v2',
  'oci-genai': 'cohere.command-r-plus',
};

interface ProviderContext {
  backend: string;
  idx: number;
}

/**
 * Helper to collect multiple custom header flags from the CLI options into an array.
 * @param value The newly passed header.
 * @param previous Accumulator list of previously collected headers.
 * @returns Array containing all collected headers.
 */
const collectHeaders = (value: string, previous: string[]): string[] => [...previous, value];

/**
 * Parses raw Key=Value header strings into a Record object.
 * @param headers String list of headers.
 * @returns Formatted headers record.
 */
const parseCustomHeaders = (headers: string[]): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const h of headers) {
    const parts = h.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      result[key] = val;
    }
  }
  return result;
};

/**
 * Returns a non-sensitive credential status for display.
 * @param provider The AI provider configuration.
 * @returns '(set)' when a password exists, otherwise '(not set)'.
 */
const getMaskedSecret = (provider: AIProviderConfig): string => {
  return provider.password ? '(set)' : '(not set)';
};

/**
 * Resolves the backend name and its configuration index in the provider list.
 * Exits with error status if the backend is not configured or unsupported.
 * @param params Object containing target name and the providers list.
 * @returns Resolved ProviderContext or null if error occurred.
 */
const resolveProviderContext = (params: {
  name: string;
  providers: AIProviderConfig[];
}): ProviderContext | null => {
  const { name, providers } = params;
  const normalized = name.toLowerCase();
  if (!VALID_BACKENDS.has(normalized)) {
    console.error(
      chalk.red(
        `Error: Unsupported backend "${name}". Supported: ${Array.from(VALID_BACKENDS).join(', ')}`,
      ),
    );
    process.exitCode = 1;
    return null;
  }

  const idx = providers.findIndex((p) => p.name.toLowerCase() === normalized);
  if (idx === -1) {
    console.error(chalk.red(`Error: AI provider "${name}" is not configured.`));
    process.exitCode = 1;
    return null;
  }

  return { backend: normalized, idx };
};

/**
 * Validates and resolves the backend name from CLI options.
 * @param options CLI parsed options.
 * @returns Resolved backend name or null.
 */
const resolveNewBackend = (options: any): string | null => {
  const backend = (options.backend || 'openai').toLowerCase();
  if (!VALID_BACKENDS.has(backend)) {
    console.error(
      chalk.red(
        `Error: Unsupported backend "${options.backend}". Supported: ${Array.from(VALID_BACKENDS).join(', ')}`,
      ),
    );
    process.exitCode = 1;
    return null;
  }
  return backend;
};

/**
 * Ensures provider does not already exist in the list.
 * @param params Object containing target name and providers list.
 * @returns true if not configured.
 */
const ensureProviderNotExists = (params: {
  name: string;
  providers: AIProviderConfig[];
}): boolean => {
  const { name, providers } = params;
  if (providers.some((p) => p.name.toLowerCase() === name)) {
    console.error(
      chalk.red(
        `Error: Provider "${name}" is already configured. Use "kdm auth update ${name}" instead.`,
      ),
    );
    process.exitCode = 1;
    return false;
  }
  return true;
};

/**
 * Updates option header configuration parameters.
 * @param provider Config to update.
 * @param options CLI flags.
 */
const updateHeaders = (provider: AIProviderConfig, options: any): void => {
  const customHeader = options.customHeader;
  if (customHeader && customHeader.length > 0) {
    provider.customHeaders = parseCustomHeaders(customHeader);
  }
};

/**
 * Parses numeric option fields and populates them on the provider configuration.
 * @param provider Configuration object.
 * @param options User specified CLI options.
 */
const parseNumericFields = (provider: AIProviderConfig, options: any): void => {
  if (options.temperature !== undefined) {
    provider.temperature = Number.parseFloat(options.temperature);
  }
  if (options.topp !== undefined) {
    provider.topP = Number.parseFloat(options.topp);
  }
  if (options.topk !== undefined) {
    provider.topK = Number.parseInt(options.topk, 10);
  }
  if (options.maxtokens !== undefined) {
    provider.maxTokens = Number.parseInt(options.maxtokens, 10);
  }
};

/**
 * Assigns non-undefined CLI flags to a provider configuration.
 * @param provider Config to update.
 * @param options CLI flags.
 */
const assignProviderUpdateOptions = (provider: AIProviderConfig, options: any): void => {
  if (options.model) provider.model = options.model;
  if (options.password !== undefined) provider.password = options.password;
  if (options.baseurl !== undefined) provider.baseUrl = options.baseurl;
  parseNumericFields(provider, options);
  updateHeaders(provider, options);
};

/**
 * Parses options header configurations if set.
 * @param customHeader Header flags array.
 * @returns Header record or undefined.
 */
const parseHeadersOption = (customHeader?: string[]): Record<string, string> | undefined => {
  if (customHeader && customHeader.length > 0) {
    return parseCustomHeaders(customHeader);
  }
  return undefined;
};

/**
 * Resolves the configuration model.
 * @param backend Normalized backend name.
 * @param modelOption User specified model name option.
 * @returns Resolved model string.
 */
const resolveModel = (backend: string, modelOption?: string): string => {
  return modelOption || DEFAULT_MODELS[backend] || 'default';
};



/**
 * Builds the complete AIProviderConfig from inputs.
 * @param params Object containing normalized name and options object.
 * @returns Constructed AIProviderConfig.
 */
const buildProviderConfig = (params: {
  backend: string;
  options: any;
}): AIProviderConfig => {
  const { backend, options } = params;
  const provider: AIProviderConfig = {
    name: backend,
    model: resolveModel(backend, options.model),
    password: options.password,
    baseUrl: options.baseurl,
    temperature: 0.7,
    topP: 1,
    topK: 50,
    maxTokens: 2048,
    customHeaders: parseHeadersOption(options.customHeader),
  };
  parseNumericFields(provider, options);
  return provider;
};

/**
 * Helper to update configuration state and print success messaging.
 * @param params Object containing backend name, mutate action and success message structure.
 */
const modifyProviderConfig = (params: {
  backend: string;
  mutate: (config: ReturnType<typeof getAIConfig>, idx: number, name: string) => void;
  message: string;
}): void => {
  const { backend, mutate, message } = params;
  const aiConfig = getAIConfig();
  const ctx = resolveProviderContext({ name: backend, providers: aiConfig.providers });
  if (!ctx) return;

  mutate(aiConfig, ctx.idx, ctx.backend);
  setAIConfig(aiConfig);
  console.log(chalk.green(message.replace('%s', ctx.backend)));
};

/**
 * Adds a new AI provider to the store.
 * @param options CLI parsed option flags.
 */
const handleAuthAdd = (options: any): void => {
  const backend = resolveNewBackend(options);
  if (!backend) return;

  const aiConfig = getAIConfig();
  if (!ensureProviderNotExists({ name: backend, providers: aiConfig.providers })) return;

  aiConfig.providers.push(buildProviderConfig({ backend, options }));
  aiConfig.defaultProvider = aiConfig.defaultProvider || backend;

  setAIConfig(aiConfig);
  console.log(chalk.green(`Successfully added AI provider "${backend}".`));
};

/**
 * Updates an existing AI provider in the store.
 * @param backend Name of the backend to update.
 * @param options CLI parsed option flags.
 */
const handleAuthUpdate = (backend: string, options: any): void => {
  modifyProviderConfig({
    backend,
    mutate: (config, idx) => assignProviderUpdateOptions(config.providers[idx], options),
    message: 'Successfully updated AI provider "%s".',
  });
};

/**
 * Lists the configured AI providers.
 */
const handleAuthList = (): void => {
  const aiConfig = getAIConfig();
  if (aiConfig.providers.length === 0) {
    console.log('No AI providers configured.');
    return;
  }

  console.log(chalk.bold('Configured AI Providers:'));
  aiConfig.providers.forEach((p) => {
    const isDefault = aiConfig.defaultProvider?.toLowerCase() === p.name.toLowerCase();
    const defaultMarker = isDefault ? chalk.green(' (default)') : '';
    console.log(`- ${chalk.blue.bold(p.name)}${defaultMarker}:`);
    console.log(`    Model:       ${p.model}`);
    console.log(`    Password:    ${getMaskedSecret(p)}`);
    console.log(`    Base URL:    ${p.baseUrl || '(default)'}`);
    console.log(`    Temperature: ${p.temperature ?? 0.7}`);
    console.log(`    TopP:        ${p.topP ?? 1}`);
    console.log(`    TopK:        ${p.topK ?? 50}`);
    console.log(`    MaxTokens:   ${p.maxTokens ?? 2048}`);
  });
};

/**
 * Sets the default AI provider.
 * @param backend Name of the backend.
 */
const handleAuthDefault = (backend: string): void => {
  modifyProviderConfig({
    backend,
    mutate: (config, _, name) => {
      config.defaultProvider = name;
    },
    message: 'Successfully set default AI provider to "%s".',
  });
};

/**
 * Removes an AI provider.
 * @param backend Name of the backend.
 */
const handleAuthRemove = (backend: string): void => {
  modifyProviderConfig({
    backend,
    mutate: (config, _, name) => {
      config.providers = config.providers.filter((p) => p.name.toLowerCase() !== name);
      if (config.defaultProvider?.toLowerCase() === name) {
        config.defaultProvider =
          config.providers.length > 0 ? config.providers[0].name : undefined;
      }
    },
    message: 'Successfully removed AI provider "%s".',
  });
};

/**
 * Registers the auth subcommands on the Commander program.
 * @param program Commander program instance.
 */
export const registerAuthCommand = (program: Command): void => {
  const auth = program
    .command('auth')
    .description('Manage AI provider authentication and credentials');

  auth
    .command('add')
    .description('Add authentication details for an AI provider backend')
    .option(
      '-b, --backend <backend>',
      'AI backend provider (openai, ollama, anthropic, noop, customrest)',
      'openai',
    )
    .option(
      '-m, --model <model>',
      'AI model to use (defaults: openai=gpt-4o, anthropic=claude-3-5-sonnet-latest, ollama=llama3.1)',
    )
    .option('-p, --password <password>', 'API Key or password for the provider')
    .option('-u, --baseurl <baseurl>', 'Custom API Base URL')
    .option('-t, --temperature <temperature>', 'Sampling temperature')
    .option('--topp <topp>', 'Top-P value')
    .option('--topk <topk>', 'Top-K value')
    .option('--maxtokens <maxtokens>', 'Maximum tokens to generate')
    .option(
      '--custom-header <header>',
      'Custom request headers in Key=Value format',
      collectHeaders,
      [],
    )
    .action(handleAuthAdd);

  auth
    .command('list')
    .description('List configured AI providers with masked secrets')
    .action(handleAuthList);

  auth
    .command('default <backend>')
    .description('Set the default AI provider backend')
    .action(handleAuthDefault);

  auth
    .command('remove <backend>')
    .description('Remove configuration for an AI provider backend')
    .action(handleAuthRemove);

  auth
    .command('update <backend>')
    .description('Update configuration details for an AI provider backend')
    .option('-m, --model <model>', 'AI model to use')
    .option('-p, --password <password>', 'API Key or password for the provider')
    .option('-u, --baseurl <baseurl>', 'Custom API Base URL')
    .option('-t, --temperature <temperature>', 'Sampling temperature')
    .option('--topp <topp>', 'Top-P value')
    .option('--topk <topk>', 'Top-K value')
    .option('--maxtokens <maxtokens>', 'Maximum tokens to generate')
    .option(
      '--custom-header <header>',
      'Custom request headers in Key=Value format',
      collectHeaders,
      [],
    )
    .action(handleAuthUpdate);
};
