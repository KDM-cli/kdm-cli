import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

export const SearchInput: React.FC<SearchInputProps> = ({ value, onChange }) => (
  <Box marginBottom={1} borderStyle="round" borderColor="yellow" paddingX={1}>
    <Text bold color="cyan"> Search: </Text>
    <TextInput
      value={value}
      onChange={onChange}
      placeholder="type to filter..."
    />
  </Box>
);
