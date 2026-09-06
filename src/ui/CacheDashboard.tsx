import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { getCacheConfig } from '../config/store';
import { createCacheProvider } from '../cache';
import type { CacheEntry } from '../cache/types';

const getCache = () => createCacheProvider(getCacheConfig());

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateKey(key: string): string {
  return key.length > 16 ? `${key.slice(0, 16)}...` : key;
}

interface PreviewState {
  key: string;
  content: string;
  lines: string[];
}

export const CacheDashboard: React.FC = () => {
  const { exit } = useApp();
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const loadEntries = useCallback(async () => {
    try {
      const cache = getCache();
      const list = await cache.list();
      list.sort((a, b) => {
        if (!a.createdAt || !b.createdAt) return 0;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setEntries(list);
    } catch {
      setStatusMsg({ text: 'Failed to load cache entries', isError: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleRemove = useCallback(async (entry: CacheEntry) => {
    try {
      const cache = getCache();
      await cache.remove(entry.key);
      setEntries(prev => {
        const next = prev.filter(e => e.key !== entry.key);
        setSelectedIndex(i => Math.min(i, Math.max(0, next.length - 1)));
        return next;
      });
      setStatusMsg({ text: `Removed: ${truncateKey(entry.key)}`, isError: false });
    } catch {
      setStatusMsg({ text: 'Failed to remove entry', isError: true });
    }
  }, []);

  const handlePurge = useCallback(async () => {
    setShowPurgeConfirm(false);
    try {
      const cache = getCache();
      await cache.purge();
      setEntries([]);
      setSelectedIndex(0);
      setStatusMsg({ text: 'All cache entries purged', isError: false });
    } catch {
      setStatusMsg({ text: 'Failed to purge cache', isError: true });
    }
  }, []);

  const handlePreview = useCallback(async (entry: CacheEntry) => {
    setLoadingPreview(true);
    try {
      const cache = getCache();
      const content = await cache.load(entry.key);
      const text = content ?? '(empty entry)';
      setPreview({ key: entry.key, content: text, lines: text.split('\n') });
    } catch {
      setStatusMsg({ text: 'Failed to load entry', isError: true });
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  useInput((input, key) => {
    if (showPurgeConfirm) {
      if (input === 'y' || input === 'Y') handlePurge();
      else if (input === 'n' || input === 'N' || key.escape) setShowPurgeConfirm(false);
      return;
    }

    if (preview) {
      if (key.escape) setPreview(null);
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(entries.length - 1, i + 1));
    } else if (key.return && entries.length > 0) {
      handlePreview(entries[selectedIndex]);
    } else if ((input === 'd' || input === 'D' || key.delete || key.backspace) && entries.length > 0) {
      handleRemove(entries[selectedIndex]);
    } else if ((input === 'p' || input === 'P') && entries.length > 0) {
      setShowPurgeConfirm(true);
    } else if (input === 'q' || input === 'Q') {
      exit();
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Loading cache entries...</Text>
      </Box>
    );
  }

  // Purge confirmation overlay
  if (showPurgeConfirm) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="red"
          paddingX={3}
          paddingY={1}
          width={50}
        >
          <Text bold color="red">
            {'Delete all '}
            <Text color="white">{entries.length}</Text>
            {` cached ${entries.length === 1 ? 'entry' : 'entries'}?`}
          </Text>
          <Text> </Text>
          <Box flexDirection="row">
            <Text bold color="green">[Y] Yes</Text>
            <Text>{'        '}</Text>
            <Text bold color="white">[N] No</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // Preview overlay
  if (preview) {
    const MAX_LINES = 22;
    const visible = preview.lines.slice(0, MAX_LINES);
    const remaining = preview.lines.length - MAX_LINES;
    return (
      <Box flexDirection="column" padding={1}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={2}
          paddingY={1}
          width={80}
        >
          <Text bold color="cyan">{truncateKey(preview.key)}</Text>
          <Text> </Text>
          {visible.map((line, i) => (
            <Text key={i} wrap="wrap">{line.length > 0 ? line : ' '}</Text>
          ))}
          {remaining > 0 && (
            <Text dimColor>{`... (${remaining} more line${remaining === 1 ? '' : 's'})`}</Text>
          )}
          <Text> </Text>
          <Text dimColor>[ESC] Close</Text>
        </Box>
      </Box>
    );
  }

  // Main list view
  const entryCount = entries.length;
  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">Cache Browser</Text>
        <Text dimColor>
          {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
        </Text>
      </Box>

      <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
        {entryCount === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>
              {'No cached entries. Run '}
              <Text color="cyan">kdm analyze --explain</Text>
              {' to generate some.'}
            </Text>
          </Box>
        ) : (
          entries.map((entry, i) => {
            const isSelected = i === selectedIndex;
            const relTime = entry.createdAt ? formatRelativeTime(entry.createdAt) : '—';
            const size = entry.sizeBytes != null ? formatBytes(entry.sizeBytes) : '—';
            const label = `#${String(i + 1).padStart(3, '0')}`;
            const keyStr = truncateKey(entry.key);

            return (
              <Box key={entry.key} flexDirection="row">
                <Text color="cyan" bold={isSelected}>
                  {isSelected ? '> ' : '  '}
                </Text>
                <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                  {`${label}  `}
                </Text>
                <Text color={isSelected ? 'yellow' : 'white'}>
                  {keyStr.padEnd(22)}
                </Text>
                <Text dimColor>{relTime.padEnd(14)}</Text>
                <Text color="green">{size}</Text>
              </Box>
            );
          })
        )}
      </Box>

      {statusMsg && (
        <Box marginTop={1}>
          <Text color={statusMsg.isError ? 'red' : 'green'}>{statusMsg.text}</Text>
        </Box>
      )}

      {loadingPreview && (
        <Box marginTop={1}>
          <Text color="cyan">Loading preview...</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="row">
        <Text dimColor>{'↑↓ Navigate  '}</Text>
        <Text color="cyan">ENTER</Text>
        <Text dimColor>{' View  '}</Text>
        <Text color="red">D</Text>
        <Text dimColor>{' Delete  '}</Text>
        <Text color="yellow">P</Text>
        <Text dimColor>{' Purge All  '}</Text>
        <Text color="white">Q</Text>
        <Text dimColor>{' Quit'}</Text>
      </Box>
    </Box>
  );
};
