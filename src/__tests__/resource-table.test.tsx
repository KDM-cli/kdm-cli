import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink';
import { Readable, Writable } from 'node:stream';
import { ResourceTable } from '../ui/show/ResourceTable';
import { TabType, type Column, type PodRow } from '../ui/show/types';

class TestStdout extends Writable {
  output = '';
  isTTY = true;
  columns = 80;
  rows = 24;
  _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void) {
    this.output += chunk.toString();
    callback();
  }
}

class TestStdin extends Readable {
  isTTY = true;
  setRawMode = vi.fn();
  setEncoding = vi.fn();
  ref = vi.fn();
  unref = vi.fn();
  _read() {}
}

describe('ResourceTable', () => {
  it('shows a sliding window that keeps the selected row visible', async () => {
    const stdout = new TestStdout();
    const stdin = new TestStdin();
    const rows: PodRow[] = Array.from({ length: 20 }, (_, index) => ({
      type: TabType.Pods,
      name: `pod-${index}`,
      namespace: 'default',
      status: 'Running',
      restarts: 0,
      node: 'node-1',
    }));
    const columns: Column[] = [
      { header: 'Name', minWidth: 12 },
      { header: 'Namespace', minWidth: 10 },
      { header: 'Status', minWidth: 10 },
      { header: 'Restarts', minWidth: 8 },
      { header: 'Node', minWidth: 12 },
    ];
    const app = render(
      <ResourceTable columns={columns} rows={rows} selectedIndex={18} onSelect={vi.fn()} />,
      { stdin, stdout, debug: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(stdout.output).toContain('pod-4');
    expect(stdout.output).toContain('pod-18');
    expect(stdout.output).not.toContain('pod-0');
    expect(stdout.output).toContain('Showing 5-19 of 20');
    app.unmount();
    stdin.push(null);
  });
});
