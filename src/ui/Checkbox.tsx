import React, { useState } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

export interface CheckboxProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  isSelected?: boolean;
  onChange?: (checked: boolean) => void;
}

/**
 * Custom Ink Checkbox component rendering [x] / [ ] with cursor indicator and chalk colors.
 */
export const Checkbox: React.FC<CheckboxProps> = ({
  label,
  checked,
  defaultChecked = false,
  isSelected = false,
  onChange,
}) => {
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const isChecked = checked !== undefined ? checked : internalChecked;

  const cursor = isSelected ? chalk.cyan('> ') : '  ';
  const box = isChecked ? chalk.green('[x]') : chalk.gray('[ ]');
  const text = isSelected ? chalk.bold.cyan(label) : label;

  return (
    <Box flexDirection="row">
      <Text>
        {cursor}
        {box} {text}
      </Text>
    </Box>
  );
};
