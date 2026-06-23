import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { getAIConfig, setAIConfig } from '../config/store';
import { type AIProviderConfig } from '../config/schema';

const VALID_BACKENDS = [
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
];

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

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  ollama: 'Ollama',
  anthropic: 'Anthropic',
  noop: 'Noop',
  customrest: 'Custom REST',
  'azure-openai': 'Azure OpenAI',
  cohere: 'Cohere',
  'google-gemini': 'Gemini',
  'google-vertex': 'Google Vertex',
  'amazon-bedrock': 'Amazon Bedrock',
  huggingface: 'HuggingFace',
  groq: 'Groq',
  'ibm-watsonx': 'IBM WatsonX',
  'oci-genai': 'OCI GenAI',
};

type Mode = 'list' | 'add' | 'edit' | 'remove-confirm';

export const AuthDashboard = () => {
  const [config, setConfig] = useState(() => getAIConfig());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Wizard state
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardValues, setWizardValues] = useState({
    provider: '',
    model: '',
    apiKey: '',
    temp: '0.7',
  });

  const selectedBackend = VALID_BACKENDS[selectedIndex];
  const selectedProviderName = PROVIDER_NAMES[selectedBackend] || selectedBackend;

  const currentProviders = config.providers || [];
  const selectedConfig = currentProviders.find(
    (p) => p.name.toLowerCase() === selectedBackend.toLowerCase()
  );

  const getMaskedSecretDisplay = (provider: AIProviderConfig): string => {
    return provider.password ? '************' : '—';
  };

  const getStatusDisplay = (backend: string) => {
    const isDefault = config.defaultProvider?.toLowerCase() === backend.toLowerCase();
    const isConfigured = currentProviders.some((p) => p.name.toLowerCase() === backend.toLowerCase());

    if (isDefault) {
      return <Text color="green">✔ Default</Text>;
    }
    if (isConfigured) {
      return <Text color="cyan">✔ Configured</Text>;
    }
    return <Text color="gray">✖ Not configured</Text>;
  };

  const clearMessages = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  useInput((input, key) => {
    clearMessages();

    if (mode === 'list') {
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : VALID_BACKENDS.length - 1));
      } else if (key.downArrow) {
        setSelectedIndex((prev) => (prev < VALID_BACKENDS.length - 1 ? prev + 1 : 0));
      } else if (input === 'a' || input === 'A') {
        const defaultModel = DEFAULT_MODELS[selectedBackend] || 'default';
        setWizardValues({
          provider: selectedBackend,
          model: defaultModel,
          apiKey: '',
          temp: '0.7',
        });
        setWizardStep(0);
        setMode('add');
      } else if (input === 'e' || input === 'E') {
        if (!selectedConfig) {
          setErrorMsg(`Provider "${selectedProviderName}" is not configured. Press 'A' to add.`);
          return;
        }
        setWizardValues({
          provider: selectedBackend,
          model: selectedConfig.model || '',
          apiKey: '', // Empty, if empty we keep existing
          temp: selectedConfig.temperature !== undefined ? String(selectedConfig.temperature) : '0.7',
        });
        setWizardStep(0); // Edit step 1: Model
        setMode('edit');
      } else if (input === 'd' || input === 'D') {
        if (!selectedConfig) {
          setErrorMsg(`Cannot set unconfigured provider "${selectedProviderName}" as default.`);
          return;
        }
        const newConfig = { ...config, defaultProvider: selectedBackend };
        setAIConfig(newConfig);
        setConfig(newConfig);
        setSuccessMsg(`Successfully set default AI provider to "${selectedProviderName}".`);
      } else if (input === 'r' || input === 'R') {
        if (!selectedConfig) {
          setErrorMsg(`Provider "${selectedProviderName}" is not configured.`);
          return;
        }
        setMode('remove-confirm');
      } else if (input === 'q' || input === 'Q') {
        process.exit(0);
      }
    } else if (mode === 'add') {
      if (key.escape) {
        setMode('list');
        return;
      }

      const stepsCount = 4;

      if (key.upArrow) {
        setWizardStep((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setWizardStep((prev) => Math.min(stepsCount - 1, prev + 1));
        return;
      }

      if (key.return) {
        if (wizardStep < stepsCount - 1) {
          // Validate provider on step 0
          if (wizardStep === 0) {
            const prov = wizardValues.provider.trim().toLowerCase();
            if (!VALID_BACKENDS.includes(prov)) {
              setErrorMsg(`Unsupported provider "${wizardValues.provider}".`);
              return;
            }
            // Auto update model default if it wasn't customized
            const currentDefaultModel = DEFAULT_MODELS[prov] || 'default';
            setWizardValues((prev) => ({
              ...prev,
              model: DEFAULT_MODELS[prov] || prev.model || 'default',
            }));
          }
          setWizardStep((prev) => prev + 1);
        } else {
          // Submit Add
          const prov = wizardValues.provider.trim().toLowerCase();
          if (!VALID_BACKENDS.includes(prov)) {
            setErrorMsg(`Unsupported provider "${wizardValues.provider}".`);
            return;
          }

          if (currentProviders.some((p) => p.name.toLowerCase() === prov)) {
            setErrorMsg(`Provider "${prov}" is already configured. Use edit (E) instead.`);
            return;
          }

          const tempFloat = parseFloat(wizardValues.temp);
          if (isNaN(tempFloat)) {
            setErrorMsg('Temperature must be a valid number.');
            return;
          }

          const newProvider: AIProviderConfig = {
            name: prov,
            model: wizardValues.model.trim() || DEFAULT_MODELS[prov] || 'default',
            password: wizardValues.apiKey.trim() || undefined,
            temperature: tempFloat,
          };

          const newProviders = [...currentProviders, newProvider];
          const newConfig = {
            providers: newProviders,
            defaultProvider: config.defaultProvider || prov,
          };

          setAIConfig(newConfig);
          setConfig(newConfig);
          setSuccessMsg(`Successfully added AI provider "${PROVIDER_NAMES[prov] || prov}".`);
          setMode('list');
        }
        return;
      }

      // Handle Text input
      const updateValue = (char: string, isDelete = false) => {
        setWizardValues((prev) => {
          let field: keyof typeof prev = 'provider';
          if (wizardStep === 0) field = 'provider';
          else if (wizardStep === 1) field = 'model';
          else if (wizardStep === 2) field = 'apiKey';
          else if (wizardStep === 3) field = 'temp';

          const currentVal = prev[field];
          const nextVal = isDelete ? currentVal.slice(0, -1) : currentVal + char;
          return { ...prev, [field]: nextVal };
        });
      };

      if (key.backspace || key.delete) {
        updateValue('', true);
      } else if (input && input.charCodeAt(0) >= 32) {
        updateValue(input);
      }
    } else if (mode === 'edit') {
      if (key.escape) {
        setMode('list');
        return;
      }

      const stepsCount = 3; // Model, API Key, Temp

      if (key.upArrow) {
        setWizardStep((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setWizardStep((prev) => Math.min(stepsCount - 1, prev + 1));
        return;
      }

      if (key.return) {
        if (wizardStep < stepsCount - 1) {
          setWizardStep((prev) => prev + 1);
        } else {
          // Submit Edit
          const tempFloat = parseFloat(wizardValues.temp);
          if (isNaN(tempFloat)) {
            setErrorMsg('Temperature must be a valid number.');
            return;
          }

          const updatedProviders = currentProviders.map((p) => {
            if (p.name.toLowerCase() === selectedBackend.toLowerCase()) {
              return {
                ...p,
                model: wizardValues.model.trim() || p.model,
                password: wizardValues.apiKey.trim() ? wizardValues.apiKey.trim() : p.password,
                temperature: tempFloat,
              };
            }
            return p;
          });

          const newConfig = {
            ...config,
            providers: updatedProviders,
          };

          setAIConfig(newConfig);
          setConfig(newConfig);
          setSuccessMsg(`Successfully updated AI provider "${selectedProviderName}".`);
          setMode('list');
        }
        return;
      }

      // Handle Text input
      const updateValue = (char: string, isDelete = false) => {
        setWizardValues((prev) => {
          let field: keyof typeof prev = 'model';
          if (wizardStep === 0) field = 'model';
          else if (wizardStep === 1) field = 'apiKey';
          else if (wizardStep === 2) field = 'temp';

          const currentVal = prev[field];
          const nextVal = isDelete ? currentVal.slice(0, -1) : currentVal + char;
          return { ...prev, [field]: nextVal };
        });
      };

      if (key.backspace || key.delete) {
        updateValue('', true);
      } else if (input && input.charCodeAt(0) >= 32) {
        updateValue(input);
      }
    } else if (mode === 'remove-confirm') {
      if (input === 'y' || input === 'Y') {
        const newProviders = currentProviders.filter(
          (p) => p.name.toLowerCase() !== selectedBackend.toLowerCase()
        );
        let newDefault = config.defaultProvider;
        if (config.defaultProvider?.toLowerCase() === selectedBackend.toLowerCase()) {
          newDefault = newProviders.length > 0 ? newProviders[0].name : undefined;
        }

        const newConfig = {
          providers: newProviders,
          defaultProvider: newDefault,
        };

        setAIConfig(newConfig);
        setConfig(newConfig);
        setSuccessMsg(`Successfully removed AI provider "${selectedProviderName}".`);
        setMode('list');
      } else if (input === 'n' || input === 'N' || key.escape) {
        setMode('list');
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1} width={80}>
      <Text bold color="cyan">
        AI Provider Manager
      </Text>
      <Text dimColor>
        ─────────────────────────────────────────────────────────────
      </Text>

      {/* Table Header */}
      <Box flexDirection="row" marginBottom={1}>
        <Box width={20}>
          <Text bold>Provider</Text>
        </Box>
        <Box width={30}>
          <Text bold>Model</Text>
        </Box>
        <Box width={20}>
          <Text bold>Status</Text>
        </Box>
      </Box>

      {/* Table Body */}
      {VALID_BACKENDS.map((backend, index) => {
        const isSelected = index === selectedIndex;
        const provName = PROVIDER_NAMES[backend] || backend;
        const provConfig = currentProviders.find((p) => p.name.toLowerCase() === backend.toLowerCase());
        const modelDisplay = provConfig ? provConfig.model : '—';

        return (
          <Box key={backend} flexDirection="row">
            <Box width={20}>
              <Text color={isSelected ? 'yellow' : undefined} bold={isSelected}>
                {isSelected ? '> ' : '  '}
                {provName}
              </Text>
            </Box>
            <Box width={30}>
              <Text color={isSelected ? 'yellow' : undefined}>{modelDisplay}</Text>
            </Box>
            <Box width={20}>{getStatusDisplay(backend)}</Box>
          </Box>
        );
      })}

      <Text dimColor>
        ─────────────────────────────────────────────────────────────
      </Text>

      {/* Footer / Shortcut Panel */}
      {mode === 'list' && (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold>[A]</Text>
            <Text> Add  </Text>
            <Text bold>[E]</Text>
            <Text> Edit  </Text>
            <Text bold>[D]</Text>
            <Text> Set Default  </Text>
            <Text bold>[R]</Text>
            <Text> Remove  </Text>
            <Text bold>[Q]</Text>
            <Text> Quit</Text>
          </Box>

          {/* Messages */}
          {errorMsg && (
            <Box marginTop={1}>
              <Text color="red" bold>
                Error: {errorMsg}
              </Text>
            </Box>
          )}
          {successMsg && (
            <Box marginTop={1}>
              <Text color="green" bold>
                {successMsg}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Overlays */}
      {mode === 'add' && (
        <Box
          borderStyle="round"
          borderColor="yellow"
          flexDirection="column"
          padding={1}
          marginTop={1}
        >
          <Text bold color="yellow" marginBottom={1}>
            ┌─ Add AI Provider ────────────────────────────────────────┐
          </Text>

          <Box flexDirection="row">
            <Text color={wizardStep === 0 ? 'cyan' : undefined} bold={wizardStep === 0}>
              {wizardStep === 0 ? '> ' : '  '}Step 1/4 — Provider:  
            </Text>
            <Text>{wizardValues.provider}</Text>
          </Box>

          <Box flexDirection="row">
            <Text color={wizardStep === 1 ? 'cyan' : undefined} bold={wizardStep === 1}>
              {wizardStep === 1 ? '> ' : '  '}Step 2/4 — Model:     
            </Text>
            <Text>{wizardValues.model}</Text>
          </Box>

          <Box flexDirection="row">
            <Text color={wizardStep === 2 ? 'cyan' : undefined} bold={wizardStep === 2}>
              {wizardStep === 2 ? '> ' : '  '}Step 3/4 — API Key:   
            </Text>
            <Text>{'*'.repeat(wizardValues.apiKey.length)}</Text>
          </Box>

          <Box flexDirection="row" marginBottom={1}>
            <Text color={wizardStep === 3 ? 'cyan' : undefined} bold={wizardStep === 3}>
              {wizardStep === 3 ? '> ' : '  '}Step 4/4 — Temp:      
            </Text>
            <Text>{wizardValues.temp}</Text>
          </Box>

          {errorMsg && (
            <Text color="red" bold marginBottom={1}>
              {errorMsg}
            </Text>
          )}

          <Text dimColor>
            [ENTER] Next/Submit   [ESC] Cancel   [↑/↓] Change fields
          </Text>
        </Box>
      )}

      {mode === 'edit' && (
        <Box
          borderStyle="round"
          borderColor="yellow"
          flexDirection="column"
          padding={1}
          marginTop={1}
        >
          <Text bold color="yellow" marginBottom={1}>
            ┌─ Edit AI Provider: {selectedProviderName} ────────────────┐
          </Text>

          <Box flexDirection="row">
            <Text color={wizardStep === 0 ? 'cyan' : undefined} bold={wizardStep === 0}>
              {wizardStep === 0 ? '> ' : '  '}Step 1/3 — Model:     
            </Text>
            <Text>{wizardValues.model}</Text>
          </Box>

          <Box flexDirection="row">
            <Text color={wizardStep === 1 ? 'cyan' : undefined} bold={wizardStep === 1}>
              {wizardStep === 1 ? '> ' : '  '}Step 2/3 — API Key:   
            </Text>
            <Text>
              {wizardValues.apiKey
                ? '*'.repeat(wizardValues.apiKey.length)
                : '(leave empty to keep existing)'}
            </Text>
          </Box>

          <Box flexDirection="row" marginBottom={1}>
            <Text color={wizardStep === 2 ? 'cyan' : undefined} bold={wizardStep === 2}>
              {wizardStep === 2 ? '> ' : '  '}Step 3/3 — Temp:      
            </Text>
            <Text>{wizardValues.temp}</Text>
          </Box>

          {errorMsg && (
            <Text color="red" bold marginBottom={1}>
              {errorMsg}
            </Text>
          )}

          <Text dimColor>
            [ENTER] Next/Submit   [ESC] Cancel   [↑/↓] Change fields
          </Text>
        </Box>
      )}

      {mode === 'remove-confirm' && (
        <Box
          borderStyle="round"
          borderColor="red"
          flexDirection="column"
          padding={1}
          marginTop={1}
        >
          <Text bold color="red" marginBottom={1}>
            Are you sure you want to remove "{selectedProviderName}"?
          </Text>
          <Text>
            Press <Text bold color="green">[Y]</Text> to confirm, or{' '}
            <Text bold color="red">[N]</Text> (or Esc) to cancel.
          </Text>
        </Box>
      )}
    </Box>
  );
};
