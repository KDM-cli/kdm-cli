import React from 'react';
import { Box, Text } from 'ink';

export const HelpBar: React.FC = () => (
  <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
    <Text>
      <Text bold color="yellow">Tab</Text><Text dimColor> Switch  </Text>
      <Text bold color="yellow">←→</Text><Text dimColor> Tab  </Text>
      <Text bold color="yellow">/</Text><Text dimColor> Search  </Text>
      <Text bold color="yellow">↑↓</Text><Text dimColor> Navigate  </Text>
      <Text bold color="yellow">Enter</Text><Text dimColor> Details  </Text>
      <Text bold color="yellow">Esc</Text><Text dimColor> Close  </Text>
      <Text bold color="yellow">Q</Text><Text dimColor> Quit</Text>
    </Text>
  </Box>
);
