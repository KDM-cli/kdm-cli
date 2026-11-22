/**
 * AppContainer — KDM Copilot Shell v4.0.0
 * Unified interactive workspace container with multi-tab header, responsive layout,
 * and signal handling.
 */

import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface AppContainerProps {
  children?: React.ReactNode;
  activeTab?: number;
  onExit?: () => void;
  bannerError?: string | null;
  registerSignalHandlers?: boolean;
  onSignal?: (signal: string) => void;
  title?: string;
  version?: string;
  onTabChange?: (tab: number) => void;
}

export const AppContainer: React.FC<AppContainerProps> = ({
  children,
  activeTab: initialTab = 1,
  onExit,
  bannerError,
  registerSignalHandlers = false,
  onSignal,
  title = 'KDM Copilot Shell',
  version = 'v4.0.0',
  onTabChange,
}) => {
  const [activeTab, setActiveTab] = useState<number>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useInput(
    (input, key) => {
      // Exit controls
      if (
        (activeTab !== 1 && input.toLowerCase() === 'q') ||
        (key.ctrl && (input === 'c' || input === 'C')) ||
        input === '\u0003'
      ) {
        onExit?.();
        return;
      }

      // Tab switching 1 - 4
      if ((activeTab !== 1 || key.meta) && input >= '1' && input <= '4') {
        const nextTab = parseInt(input, 10);
        setActiveTab(nextTab);
        onTabChange?.(nextTab);
      }
    }
  );

  useEffect(() => {
    if (!registerSignalHandlers) return;
    const handleSigterm = () => {
      onSignal?.('SIGTERM');
      onExit?.();
    };
    process.on('SIGTERM', handleSigterm);
    return () => {
      process.removeListener('SIGTERM', handleSigterm);
    };
  }, [registerSignalHandlers, onExit, onSignal]);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box borderStyle="single" borderColor="cyan" justifyContent="space-between">
        <Text bold color="cyan">
          {' '}
          {title} {version}
        </Text>
        <Box>
          <Text color={activeTab === 1 ? 'green' : 'dim'}>[Alt+1: Monitor] </Text>
          <Text color={activeTab === 2 ? 'green' : 'dim'}>[Alt+2: Agents] </Text>
          <Text color={activeTab === 3 ? 'green' : 'dim'}>[Alt+3: Diffs] </Text>
          <Text color={activeTab === 4 ? 'green' : 'dim'}>[Alt+4: Settings]</Text>
        </Box>
      </Box>

      {bannerError ? (
        <Box borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow">⚠ {bannerError}</Text>
        </Box>
      ) : null}

      <Box flexGrow={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
};

export const AppContainerView = AppContainer;
