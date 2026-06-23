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

const parseTemperature = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

// --- Child Components to Reduce Main Component Complexity ---

interface ProviderListProps {
  selectedIndex: number;
  currentProviders: AIProviderConfig[];
  config: ReturnType<typeof getAIConfig>;
  mode: Mode;
  errorMsg: string | null;
  successMsg: string | null;
  getStatusDisplay: (backend: string) => React.ReactNode;
}

const ProviderList = ({
  selectedIndex,
  currentProviders,
  config,
  mode,
  errorMsg,
  successMsg,
  getStatusDisplay,
}: ProviderListProps) => {
  return (
    <Box flexDirection="column">
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
    </Box>
  );
};

interface WizardStep {
  label: string;
  value: string;
}

interface WizardFormProps {
  title: string;
  steps: WizardStep[];
  activeStep: number;
  errorMsg: string | null;
}

const WizardForm = ({ title, steps, activeStep, errorMsg }: WizardFormProps) => {
  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      flexDirection="column"
      padding={1}
      marginTop={1}
    >
      <Box marginBottom={1}>
        <Text bold color="yellow">
          ┌─ {title} ────────────────────────────────────────┐
        </Text>
      </Box>

      {steps.map((step, idx) => {
        const isActive = idx === activeStep;
        return (
          <Box key={idx} flexDirection="row" marginBottom={idx === steps.length - 1 ? 1 : 0}>
            <Text color={isActive ? 'cyan' : undefined} bold={isActive}>
              {isActive ? '> ' : '  '}Step {idx + 1}/{steps.length} — {step.label}
            </Text>
            <Text>{step.value}</Text>
          </Box>
        );
      })}

      {errorMsg && (
        <Box marginBottom={1}>
          <Text color="red" bold>
            {errorMsg}
          </Text>
        </Box>
      )}

      <Text dimColor>
        [ENTER] Next/Submit   [ESC] Cancel   [↑/↓] Change fields
      </Text>
    </Box>
  );
};

interface RemoveConfirmProps {
  selectedProviderName: string;
}

const RemoveConfirm = ({ selectedProviderName }: RemoveConfirmProps) => {
  return (
    <Box
      borderStyle="round"
      borderColor="red"
      flexDirection="column"
      padding={1}
      marginTop={1}
    >
      <Box marginBottom={1}>
        <Text bold color="red">
          Are you sure you want to remove "{selectedProviderName}"?
        </Text>
      </Box>
      <Text>
        Press <Text bold color="green">[Y]</Text> to confirm, or{' '}
        <Text bold color="red">[N]</Text> (or Esc) to cancel.
      </Text>
    </Box>
  );
};

// --- Main AuthDashboard Component ---

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

  const updateWizardField = (
    fields: (keyof typeof wizardValues)[],
    activeStep: number,
    char: string,
    isDelete: boolean
  ) => {
    const field = fields[activeStep];
    setWizardValues((prev) => {
      const currentVal = prev[field];
      const nextVal = isDelete ? currentVal.slice(0, -1) : currentVal + char;
      return { ...prev, [field]: nextVal };
    });
  };

  const handleTyping = ({
    input,
    key,
    fields,
    activeStep,
  }: {
    input: string;
    key: any;
    fields: (keyof typeof wizardValues)[];
    activeStep: number;
  }) => {
    if (key.backspace || key.delete) {
      updateWizardField(fields, activeStep, '', true);
    } else if (input && input.charCodeAt(0) >= 32) {
      updateWizardField(fields, activeStep, input, false);
    }
  };

  const handleAddReturn = () => {
    if (wizardStep < 3) {
      if (wizardStep === 0) {
        const prov = wizardValues.provider.trim().toLowerCase();
        if (!VALID_BACKENDS.includes(prov)) {
          setErrorMsg(`Unsupported provider "${wizardValues.provider}".`);
          return;
        }
        setWizardValues((prev) => ({
          ...prev,
          model: DEFAULT_MODELS[prov] || prev.model || 'default',
        }));
      }
      setWizardStep((prev) => prev + 1);
      return;
    }

    const prov = wizardValues.provider.trim().toLowerCase();
    if (!VALID_BACKENDS.includes(prov)) {
      setErrorMsg(`Unsupported provider "${wizardValues.provider}".`);
      return;
    }

    if (currentProviders.some((p) => p.name.toLowerCase() === prov)) {
      setErrorMsg(`Provider "${prov}" is already configured. Use edit (E) instead.`);
      return;
    }

    const tempFloat = parseTemperature(wizardValues.temp);
    if (tempFloat === null) {
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
  };

  const handleEditReturn = () => {
    if (wizardStep < 2) {
      setWizardStep((prev) => prev + 1);
      return;
    }

    const tempFloat = parseTemperature(wizardValues.temp);
    if (tempFloat === null) {
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
  };

  const selectAddProvider = () => {
    const defaultModel = DEFAULT_MODELS[selectedBackend] || 'default';
    setWizardValues({
      provider: selectedBackend,
      model: defaultModel,
      apiKey: '',
      temp: '0.7',
    });
    setWizardStep(0);
    setMode('add');
  };

  const selectEditProvider = () => {
    if (!selectedConfig) {
      setErrorMsg(`Provider "${selectedProviderName}" is not configured. Press 'A' to add.`);
      return;
    }
    setWizardValues({
      provider: selectedBackend,
      model: selectedConfig.model || '',
      apiKey: '',
      temp: selectedConfig.temperature !== undefined ? String(selectedConfig.temperature) : '0.7',
    });
    setWizardStep(0);
    setMode('edit');
  };

  const selectSetDefaultProvider = () => {
    if (!selectedConfig) {
      setErrorMsg(`Cannot set unconfigured provider "${selectedProviderName}" as default.`);
      return;
    }
    const newConfig = { ...config, defaultProvider: selectedBackend };
    setAIConfig(newConfig);
    setConfig(newConfig);
    setSuccessMsg(`Successfully set default AI provider to "${selectedProviderName}".`);
  };

  const selectRemoveProvider = () => {
    if (!selectedConfig) {
      setErrorMsg(`Provider "${selectedProviderName}" is not configured.`);
      return;
    }
    setMode('remove-confirm');
  };

  const handleListInput = ({ input, key }: { input: string; key: any }) => {
    const lowerInput = input.toLowerCase();
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : VALID_BACKENDS.length - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < VALID_BACKENDS.length - 1 ? prev + 1 : 0));
      return;
    }
    if (lowerInput === 'a') {
      selectAddProvider();
      return;
    }
    if (lowerInput === 'e') {
      selectEditProvider();
      return;
    }
    if (lowerInput === 'd') {
      selectSetDefaultProvider();
      return;
    }
    if (lowerInput === 'r') {
      selectRemoveProvider();
      return;
    }
    if (lowerInput === 'q') {
      process.exit(0);
    }
  };

  const handleAddInput = ({ input, key }: { input: string; key: any }) => {
    if (key.escape) {
      setMode('list');
      return;
    }

    if (key.upArrow) {
      setWizardStep((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setWizardStep((prev) => Math.min(3, prev + 1));
      return;
    }

    if (key.return) {
      handleAddReturn();
      return;
    }

    handleTyping({ input, key, fields: ['provider', 'model', 'apiKey', 'temp'], activeStep: wizardStep });
  };

  const handleEditInput = ({ input, key }: { input: string; key: any }) => {
    if (key.escape) {
      setMode('list');
      return;
    }

    if (key.upArrow) {
      setWizardStep((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setWizardStep((prev) => Math.min(2, prev + 1));
      return;
    }

    if (key.return) {
      handleEditReturn();
      return;
    }

    handleTyping({ input, key, fields: ['model', 'apiKey', 'temp'], activeStep: wizardStep });
  };

  const handleRemoveConfirmInput = ({ input, key }: { input: string; key: any }) => {
    const lowerInput = input.toLowerCase();
    if (lowerInput === 'y') {
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
    } else if (lowerInput === 'n' || key.escape) {
      setMode('list');
    }
  };

  useInput((input, key) => {
    clearMessages();
    const args = { input, key };
    if (mode === 'list') {
      handleListInput(args);
    } else if (mode === 'add') {
      handleAddInput(args);
    } else if (mode === 'edit') {
      handleEditInput(args);
    } else if (mode === 'remove-confirm') {
      handleRemoveConfirmInput(args);
    }
  });

  return (
    <Box flexDirection="column" padding={1} width={80}>
      <ProviderList
        selectedIndex={selectedIndex}
        currentProviders={currentProviders}
        config={config}
        mode={mode}
        errorMsg={errorMsg}
        successMsg={successMsg}
        getStatusDisplay={getStatusDisplay}
      />

      {/* Overlays */}
      {mode === 'add' && (
        <WizardForm
          title="Add AI Provider"
          steps={[
            { label: 'Provider:  ', value: wizardValues.provider },
            { label: 'Model:     ', value: wizardValues.model },
            { label: 'API Key:   ', value: '*'.repeat(wizardValues.apiKey.length) },
            { label: 'Temp:      ', value: wizardValues.temp },
          ]}
          activeStep={wizardStep}
          errorMsg={errorMsg}
        />
      )}

      {mode === 'edit' && (
        <WizardForm
          title={`Edit AI Provider: ${selectedProviderName}`}
          steps={[
            { label: 'Model:     ', value: wizardValues.model },
            {
              label: 'API Key:   ',
              value: wizardValues.apiKey
                ? '*'.repeat(wizardValues.apiKey.length)
                : '(leave empty to keep existing)',
            },
            { label: 'Temp:      ', value: wizardValues.temp },
          ]}
          activeStep={wizardStep}
          errorMsg={errorMsg}
        />
      )}

      {mode === 'remove-confirm' && (
        <RemoveConfirm selectedProviderName={selectedProviderName} />
      )}
    </Box>
  );
};
