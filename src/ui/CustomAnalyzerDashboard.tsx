import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { CustomAnalyzerConfig } from '../analyzers/custom';

type WizardStep = 1 | 2 | 3;
type AnalyzerType = 'command' | 'url';

interface CustomAnalyzerDashboardProps {
  analyzers: CustomAnalyzerConfig[];
  onAdd: (config: CustomAnalyzerConfig) => void;
  onRemove: (name: string) => void;
}

export const isValidUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const CustomAnalyzerDashboard: React.FC<CustomAnalyzerDashboardProps> = ({
  analyzers,
  onAdd,
  onRemove,
}) => {
  const { exit } = useApp();
  const [rules, setRules] = useState(analyzers);
  const [selected, setSelected] = useState(0);
  const [step, setStep] = useState<WizardStep | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<AnalyzerType>('command');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const cancelWizard = () => {
    setStep(null);
    setName('');
    setValue('');
    setType('command');
    setError('');
  };

  const submitStep = (input: string) => {
    const trimmed = input.trim();
    if (step === 1) {
      if (!trimmed) {
        setError('Rule name is required.');
        return;
      }
      if (rules.some((analyzer) => analyzer.name === trimmed)) {
        setError(`Rule "${trimmed}" already exists.`);
        return;
      }
      setName(trimmed);
      setError('');
      setStep(2);
      return;
    }
    if (step === 2) {
      setError('');
      setStep(3);
      return;
    }
    if (!trimmed) {
      setError(`${type === 'command' ? 'Command' : 'Webhook URL'} is required.`);
      return;
    }
    if (type === 'url' && !isValidUrl(trimmed)) {
      setError('Webhook URL must be a valid HTTP or HTTPS URL.');
      return;
    }
    const config = type === 'command' ? { name, command: trimmed } : { name, url: trimmed };
    setRules((current) => [...current, config]);
    onAdd(config);
    cancelWizard();
  };

  useInput((input, key) => {
    if (key.escape) {
      if (step !== null) cancelWizard();
      else exit();
      return;
    }
    if (step !== null) {
      if (step === 2 && (key.upArrow || key.downArrow)) {
        setType((current) => (current === 'command' ? 'url' : 'command'));
      } else if (step === 2 && key.return) {
        setError('');
        setStep(3);
      }
      return;
    }
    if (key.upArrow && rules.length > 0) {
      setSelected((current) => (current - 1 + rules.length) % rules.length);
    } else if (key.downArrow && rules.length > 0) {
      setSelected((current) => (current + 1) % rules.length);
    } else if (input.toLowerCase() === 'a') {
      setStep(1);
      setError('');
    } else if (input.toLowerCase() === 'd' || key.delete) {
      const analyzer = rules[selected];
      if (analyzer) {
        onRemove(analyzer.name);
        setRules((current) => current.filter((rule) => rule.name !== analyzer.name));
        setSelected((current) => Math.min(current, Math.max(0, rules.length - 2)));
      }
    } else if (input.toLowerCase() === 'q') {
      exit();
    }
  });

  if (step !== null) {
    return (
      <Box borderStyle="round" flexDirection="column" padding={1} width={60}>
        <Text bold>Add Custom Analyzer</Text>
        <Text>Step {step}/3</Text>
        {step === 1 ? (
          <>
            <Text>Rule name:</Text>
            <TextInput value={name} onChange={setName} onSubmit={submitStep} />
          </>
        ) : step === 2 ? (
          <>
            <Text>Type (use ↑/↓, then Enter):</Text>
            <Text color={type === 'command' ? 'cyan' : undefined}>
              {type === 'command' ? '> ' : '  '}Command
            </Text>
            <Text color={type === 'url' ? 'cyan' : undefined}>
              {type === 'url' ? '> ' : '  '}Webhook
            </Text>
            <Text dimColor>Enter Next • Esc Cancel</Text>
          </>
        ) : (
          <>
            <Text>{type === 'command' ? 'Command:' : 'Webhook URL:'}</Text>
            <TextInput value={value} onChange={setValue} onSubmit={submitStep} />
          </>
        )}
        {error ? <Text color="red">{error}</Text> : null}
        {step !== 2 ? <Text dimColor>Enter Next • Esc Cancel</Text> : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box justifyContent="space-between">
        <Text bold>Custom Analyzers</Text>
        <Text>{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</Text>
      </Box>
      <Text> </Text>
      <Text>Name                 Type       Command / URL</Text>
      <Text dimColor>{'─'.repeat(58)}</Text>
      {rules.length === 0 ? (
        <Text dimColor>No custom analyzers configured.</Text>
      ) : (
        rules.map((analyzer, index) => {
          const analyzerType = analyzer.command ? 'Command' : 'Webhook';
          const detail = analyzer.command ?? analyzer.url ?? '';
          return (
            <Text key={analyzer.name} color={index === selected ? 'cyan' : undefined}>
              {index === selected ? '> ' : '  '}
              {analyzer.name.padEnd(20).slice(0, 20)} {analyzerType.padEnd(10)} {detail}
            </Text>
          );
        })
      )}
      <Text dimColor>{'─'.repeat(58)}</Text>
      <Text>[A] Add Rule  [DELETE/D] Remove  [Q] Quit</Text>
    </Box>
  );
};
