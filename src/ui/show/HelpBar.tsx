import React from 'react';
import { Box, Text } from 'ink';

export const HelpBar: React.FC = () => (
  <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
    <Text dimColor>
      <Text bold>Tab</Text>
      {' ← → '}
      <Text bold>/</Text>Search{' '}
      <Text bold>↑↓</Text>Navigate{' '}
      <Text bold>Enter</Text>Details{' '}
      <Text bold>Esc</Text>Close{' '}
      <Text bold>Q</Text>Quit
    </Text>
  </Box>
);
