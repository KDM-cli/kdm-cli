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
  lines: string[];
}

interface StatusMsg {
  text: string;
  isError: boolean;
}

// --- Sub-components ---

const PurgeConfirmView: React.FC<{ count: number }> = ({ count }) => (
  <Box flexDirection="column" padding={1}>
    <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={3} paddingY={1} width={50}>
      <Text bold color="red">
        {'Delete all '}
        <Text color="white">{count}</Text>
        {` cached ${count === 1 ? 'entry' : 'entries'}?`}
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

const PreviewView: React.FC<{ preview: PreviewState }> = ({ preview }) => {
  const MAX_LINES = 22;
  const visible = preview.lines.slice(0, MAX_LINES);
  const remaining = preview.lines.length - MAX_LINES;
  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} width={80}>
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
};

const EntryRow: React.FC<{ entry: CacheEntry; index: number; isSelected: boolean }> = ({
  entry,
  index,
  isSelected,
}) => {
  const relTime = entry.createdAt ? formatRelativeTime(entry.createdAt) : '—';
  const size = entry.sizeBytes != null ? formatBytes(entry.sizeBytes) : '—';
  const label = `#${String(index + 1).padStart(3, '0')}`;
  return (
    <Box flexDirection="row">
      <Text color="cyan" bold={isSelected}>{isSelected ? '> ' : '  '}</Text>
      <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>{`${label}  `}</Text>
      <Text color={isSelected ? 'yellow' : 'white'}>{truncateKey(entry.key).padEnd(22)}</Text>
      <Text dimColor>{relTime.padEnd(14)}</Text>
      <Text color="green">{size}</Text>
    </Box>
  );
};

const EntryListView: React.FC<{
  entries: CacheEntry[];
  selectedIndex: number;
  statusMsg: StatusMsg | null;
  loadingPreview: boolean;
}> = ({ entries, selectedIndex, statusMsg, loadingPreview }) => (
  <Box flexDirection="column" padding={1}>
    <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
      <Text bold color="cyan">Cache Browser</Text>
      <Text dimColor>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</Text>
    </Box>

    <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
      {entries.length === 0 ? (
        <Box paddingY={1}>
          <Text dimColor>
            {'No cached entries. Run '}
            <Text color="cyan">kdm analyze --explain</Text>
            {' to generate some.'}
          </Text>
        </Box>
      ) : (
        entries.map((entry, i) => (
          <EntryRow key={entry.key} entry={entry} index={i} isSelected={i === selectedIndex} />
        ))
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

// --- Keyboard hook ---

interface KeyboardHandlers {
  onUp: () => void;
  onDown: () => void;
  onEnter: () => void;
  onDelete: () => void;
  onPurge: () => void;
  onEscape: () => void;
  onQuit: () => void;
  onConfirmYes: () => void;
  onConfirmNo: () => void;
}

function useCacheKeyboard(
  mode: 'list' | 'preview' | 'confirm',
  handlers: KeyboardHandlers,
): void {
  useInput((input, key) => {
    if (mode === 'confirm') {
      if (input === 'y' || input === 'Y') handlers.onConfirmYes();
      else if (input === 'n' || input === 'N' || key.escape) handlers.onConfirmNo();
      return;
    }
    if (mode === 'preview') {
      if (key.escape) handlers.onEscape();
      return;
    }
    if (key.escape) {
      handlers.onEscape();
      return;
    }
    if (key.upArrow) handlers.onUp();
    else if (key.downArrow) handlers.onDown();
    else if (key.return) handlers.onEnter();
    else if (input === 'd' || input === 'D' || key.delete || key.backspace) handlers.onDelete();
    else if (input === 'p' || input === 'P') handlers.onPurge();
    else if (input === 'q' || input === 'Q') handlers.onQuit();
  });
}

// --- Main component ---

export interface CacheDashboardProps {
  onBack?: () => void;
  onExit?: () => void;
}

export const CacheDashboard: React.FC<CacheDashboardProps> = ({ onBack, onExit }) => {
  const { exit } = useApp();
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [statusMsg, setStatusMsg] = useState<StatusMsg | null>(null);

  const mode = showPurgeConfirm ? 'confirm' : preview ? 'preview' : 'list';

  const loadEntries = useCallback(async () => {
    try {
      const cache = getCache();
      const list = await cache.list();
      // Fix: use 0 as sentinel for missing timestamps so sort is always deterministic
      list.sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
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

      setEntries(prev => prev.filter(e => e.key !== entry.key));
      setSelectedIndex(i => {
        const nextLen = Math.max(0, entries.length - 1);
        return nextLen === 0 ? 0 : Math.min(i, nextLen - 1);
      });

      setStatusMsg({ text: `Removed: ${truncateKey(entry.key)}`, isError: false });
    } catch {
      setStatusMsg({ text: 'Failed to remove entry', isError: true });
    }
  }, [entries.length]);

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
      setPreview({ key: entry.key, lines: text.split('\n') });
    } catch {
      setStatusMsg({ text: 'Failed to load entry', isError: true });
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  useCacheKeyboard(mode, {
    onUp: () => setSelectedIndex(i => Math.max(0, i - 1)),
    // Fix: guard entries.length so index never goes to -1 on an empty list
    onDown: () => setSelectedIndex(i => entries.length > 0 ? Math.min(entries.length - 1, i + 1) : 0),
    onEnter: () => { if (entries.length > 0) handlePreview(entries[selectedIndex]); },
    onDelete: () => { if (entries.length > 0) handleRemove(entries[selectedIndex]); },
    onPurge: () => { if (entries.length > 0) setShowPurgeConfirm(true); },
    onEscape: () => {
      if (preview) {
        setPreview(null);
      } else if (onBack) {
        onBack();
      } else {
        onExit?.();
        exit();
      }
    },
    onQuit: () => {
      if (onBack) {
        onBack();
      } else {
        onExit?.();
        exit();
      }
    },
    onConfirmYes: handlePurge,
    onConfirmNo: () => setShowPurgeConfirm(false),
  });

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Loading cache entries...</Text>
      </Box>
    );
  }

  if (showPurgeConfirm) return <PurgeConfirmView count={entries.length} />;
  if (preview) return <PreviewView preview={preview} />;

  return (
    <EntryListView
      entries={entries}
      selectedIndex={selectedIndex}
      statusMsg={statusMsg}
      loadingPreview={loadingPreview}
    />
  );
};
