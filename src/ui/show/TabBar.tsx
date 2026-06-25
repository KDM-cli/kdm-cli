import React from 'react';
import { Box, Text } from 'ink';
import { TabType, TabConfig } from './types';

interface TabBarProps {
  activeTab: TabType;
  tabs: TabConfig[];
  onTabChange: (tab: TabType) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ activeTab, tabs, onTabChange }) => (
  <Box flexDirection="row" marginBottom={1} borderStyle="single" borderColor="cyan" paddingX={1}>
    {tabs.map((tab) => {
      const isActive = tab.key === activeTab;
      const label = `${tab.label}${tab.disconnected ? ' (Disconnected)' : ` (${tab.count})`}`;
      return (
        <Box key={tab.key} marginRight={1}>
          {isActive ? (
            <Text backgroundColor="blue" white bold>{` ${label} `}</Text>
          ) : (
            <Text dimColor>{` ${label} `}</Text>
          )}
        </Box>
      );
    })}
  </Box>
);
