import React, {useEffect, useState, useRef} from 'react';
import {render, Box, Text, useApp, useInput} from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import chalk from 'chalk';
import os from 'node:os';
import {createServer, ServerOptions} from '../server/server';

type LogEntry = {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  responseTimeMs: number;
};

const formatMs = (ms: number) => `${ms}ms`;

const Metrics: React.FC<{uptime: number; cpuPct: number; ramPct: number}> = ({uptime, cpuPct, ramPct}) => (
  <Box flexDirection="column" paddingRight={2}>
    <Text>CPU: {cpuPct.toFixed(1)}%</Text>
    <Text>RAM: {ramPct.toFixed(1)}%</Text>
    <Text>Uptime: {Math.floor(uptime)}s</Text>
  </Box>
);

const RequestRow: React.FC<{entry: LogEntry}> = ({entry}) => (
  <Box>
    <Text color="gray">{new Date(entry.timestamp).toLocaleTimeString()} </Text>
    <Text>{chalk.bold(entry.method)}</Text>
    <Text> {entry.path} </Text>
    <Text>{entry.status}</Text>
    <Text color="gray"> {formatMs(entry.responseTimeMs)}</Text>
  </Box>
);

const Dashboard: React.FC<{initialOptions: ServerOptions}> = ({initialOptions}) => {
  const {exit} = useApp();
  const [running, setRunning] = useState(false);
  const [port, setPort] = useState<number>(initialOptions.port ?? 8080);
  const [editingPort, setEditingPort] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [cpuPct, setCpuPct] = useState(0);
  const [ramPct, setRamPct] = useState(0);
  const [uptimeSec, setUptimeSec] = useState(0);
  const serverRef = useRef<{ close: () => void; port: number } | null>(null);

  const maxLogs = 200;

  const pushLog = (entry: LogEntry) => {
    setLogs((prev) => {
      const next = [...prev, entry];
      if (next.length > maxLogs) next.splice(0, next.length - maxLogs);
      return next;
    });
  };

  const startServer = async () => {
    try {
      const srv = await createServer({
        port,
        backend: initialOptions.backend,
        filter: initialOptions.filter,
        onRequest: (info) => {
          pushLog(info as LogEntry);
        },
      });
      serverRef.current = srv;
      setRunning(true);
    } catch (e) {
      pushLog({
        timestamp: new Date().toISOString(),
        method: 'ERR',
        path: '/',
        status: 500,
        responseTimeMs: 0,
      });
    }
  };

  const stopServer = async () => {
    try {
      serverRef.current?.close();
    } catch (e) {
      // ignore
    }
    serverRef.current = null;
    setRunning(false);
  };

  const restartServer = async () => {
    await stopServer();
    await startServer();
  };

  useEffect(() => {
    // metrics interval
    const id = setInterval(() => {
      const total = os.totalmem();
      const free = os.freemem();
      const used = total - free;
      const ram = (used / total) * 100;
      setRamPct(ram);

      const loads = os.loadavg();
      const cpus = os.cpus().length || 1;
      const cpu = (loads[0] / cpus) * 100;
      setCpuPct(cpu);

      setUptimeSec(process.uptime());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useInput((input, key) => {
    if (editingPort) return;
    if (input === 's') {
      if (running) stopServer(); else startServer();
    }
    if (input === 'r') {
      restartServer();
    }
    if (input === 'c') {
      setLogs([]);
    }
    if (input === 'p') {
      setEditingPort(true);
    }
    if (input === 'Q') {
      // ensure server closed
      stopServer();
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Box flexDirection="column" marginRight={4}>
          <Text bold>kdm Serve Dashboard</Text>
          <Text>Host: {chalk.green('localhost')}</Text>
          <Text>Port: {chalk.yellow(String(port))} {running ? <Text color="green">(running)</Text> : <Text color="red">(stopped)</Text>}</Text>
          <Text>Mode: HTTP</Text>
        </Box>
        <Metrics uptime={uptimeSec} cpuPct={cpuPct} ramPct={ramPct} />
      </Box>

      <Box marginTop={1}>
        <Box flexDirection="column" width={60}>
          <Text bold>Controls</Text>
          <Text> s: start/stop • r: restart • p: change port • c: clear logs • Q: quit</Text>
        </Box>
      </Box>

      {editingPort ? (
        <Box marginTop={1}>
          <Text>New port: </Text>
          <TextInput
            value={String(port)}
            onChange={(v) => setPort(Number(v) || 0)}
            onSubmit={async (v) => { setEditingPort(false); if (running) { await restartServer(); } }}
          />
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
        <Text bold>Live Requests (latest)</Text>
        <Box flexDirection="column" marginTop={1}>
          {logs.slice(-20).reverse().map((l, i) => (
            <RequestRow key={`${l.timestamp}-${i}`} entry={l} />
          ))}
          {logs.length === 0 && <Text color="gray">No requests yet.</Text>}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">Press Q to quit.</Text>
      </Box>
    </Box>
  );
};

export function runDashboard(initialOptions: ServerOptions) {
  const {waitUntilExit} = render(<Dashboard initialOptions={initialOptions} />);
  return waitUntilExit;
}
