import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink';
import { Writable, Readable } from 'node:stream';
import { Console } from 'node:console';
import { FiltersDashboard, DEFAULT_FILTERS } from '../ui/FiltersDashboard';
import { Checkbox } from '../ui/Checkbox';

if (!(console as any).Console) {
  (console as any).Console = Console;
}

const { mockFilters } = vi.hoisted(() => ({
  mockFilters: { active: [] as string[] },
}));

vi.mock('../config/store', () => ({
  getActiveFilters: vi.fn(() => mockFilters.active),
  setActiveFilters: vi.fn((filters: string[]) => {
    mockFilters.active = filters;
  }),
  rawConfigStore: {
    has: vi.fn(() => mockFilters.active.length > 0),
  },
}));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class MockWritable extends Writable {
  frames: string[] = [];
  isTTY = true;
  columns = 80;
  rows = 24;
  _write(chunk: any, encoding: any, callback: (error?: Error | null) => void) {
    this.frames.push(chunk.toString());
    callback();
  }
}

class MockStdin extends Readable {
  _read() {}
  isTTY = true;
  setRawMode = vi.fn();
  setEncoding = vi.fn();
  ref = vi.fn();
  unref = vi.fn();
  write(data: any) {
    this.push(Buffer.from(data));
  }
  sendKey({ name }: { name: string }) {
    const sequences: Record<string, string> = {
      up: '\u001b[A',
      down: '\u001b[B',
      return: '\r',
      enter: '\r',
      escape: '\u001b',
      backspace: '\u007f',
    };
    const seq = sequences[name];
    if (seq) {
      this.write(seq);
    }
  }
  sendChar({ char }: { char: string }) {
    this.write(char);
  }
  sendStr({ str }: { str: string }) {
    this.write(str);
  }
}

const waitForFrameToContain = async ({
  mockStdout,
  substring,
  timeout = 3000,
}: {
  mockStdout: MockWritable;
  substring: string;
  timeout?: number;
}) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const output = mockStdout.frames.join('\n');
    if (output.includes(substring)) {
      return;
    }
    await sleep(20);
  }
  throw new Error(
    `Timed out waiting for "${substring}" to appear in stdout. Output was:\n${mockStdout.frames.join('\n')}`,
  );
};

describe('Checkbox component', () => {
  let mockStdout: MockWritable;

  beforeEach(() => {
    mockStdout = new MockWritable();
  });

  it('renders checked and selected state', () => {
    render(<Checkbox label="Pod" checked={true} isSelected={true} />, {
      stdout: mockStdout as any,
    });
    const output = mockStdout.frames.join('\n');
    expect(output).toContain('> ');
    expect(output).toContain('[x]');
    expect(output).toContain('Pod');
  });

  it('renders unchecked and unselected state', () => {
    render(<Checkbox label="Ingress" checked={false} isSelected={false} />, {
      stdout: mockStdout as any,
    });
    const output = mockStdout.frames.join('\n');
    expect(output).not.toContain('> ');
    expect(output).toContain('[ ]');
    expect(output).toContain('Ingress');
  });
});

describe('FiltersDashboard', () => {
  let mockStdout: MockWritable;
  let mockStdin: MockStdin;

  beforeEach(() => {
    mockStdout = new MockWritable();
    mockStdin = new MockStdin();
    mockFilters.active = [];
    vi.clearAllMocks();
  });

  const sampleAnalyzers = [
    'Pod',
    'Deployment',
    'Service',
    'Ingress',
    'CronJob',
    'StatefulSet',
    'DaemonSet',
    'ReplicaSet',
    'PersistentVolumeClaim',
    'NetworkPolicy',
    'HPA',
    'Node',
  ];

  it('renders initial state with default filters active', async () => {
    render(
      <FiltersDashboard
        availableAnalyzers={sampleAnalyzers}
        initialActiveFilters={DEFAULT_FILTERS}
      />,
      {
        stdout: mockStdout as any,
        stdin: mockStdin as any,
        interactive: true,
      },
    );

    await waitForFrameToContain({ mockStdout, substring: 'Analyzer Filters' });
    await waitForFrameToContain({ mockStdout, substring: 'Active: 5 / 12' });
    await waitForFrameToContain({ mockStdout, substring: 'SPACE:Toggle ↑↓:Navigate Q:Quit (changes auto-saved)' });

    const output = mockStdout.frames.join('\n');
    expect(output).toContain('> ');
    expect(output).toContain('[x] Pod');
    expect(output).toContain('[x] Deployment');
    expect(output).toContain('[x] Service');
    expect(output).toContain('[ ] Ingress');
    expect(output).toContain('[x] PersistentVolumeClaim');
    expect(output).toContain('[x] Node');
  });

  it('navigates list with arrow keys', async () => {
    render(
      <FiltersDashboard
        availableAnalyzers={sampleAnalyzers}
        initialActiveFilters={['Pod', 'Deployment']}
      />,
      {
        stdout: mockStdout as any,
        stdin: mockStdin as any,
        interactive: true,
      },
    );

    await waitForFrameToContain({ mockStdout, substring: 'Analyzer Filters' });

    // Press down arrow to move to Deployment
    mockStdin.sendKey({ name: 'down' });
    await sleep(50);

    // Press down arrow again to move to Service
    mockStdin.sendKey({ name: 'down' });
    await sleep(50);

    // Press up arrow to move back to Deployment
    mockStdin.sendKey({ name: 'up' });
    await sleep(50);

    const lastRendered = [...mockStdout.frames].reverse().find((f) => f.includes('Analyzer Filters'));
    expect(lastRendered).toContain('Deployment');
  });

  it('toggles an analyzer off with Space and persists immediately', async () => {
    const onSaveSpy = vi.fn();

    render(
      <FiltersDashboard
        availableAnalyzers={sampleAnalyzers}
        initialActiveFilters={['Pod', 'Deployment']}
        onSave={onSaveSpy}
      />,
      {
        stdout: mockStdout as any,
        stdin: mockStdin as any,
        interactive: true,
      },
    );

    await waitForFrameToContain({ mockStdout, substring: 'Active: 2 / 12' });

    // Cursor starts on Pod (index 0, active). Press SPACE to toggle Pod off.
    mockStdin.sendChar({ char: ' ' });
    await waitForFrameToContain({ mockStdout, substring: 'Active: 1 / 12' });
    await waitForFrameToContain({ mockStdout, substring: '[ ] Pod' });

    expect(onSaveSpy).toHaveBeenCalledWith(['Deployment']);
  });

  it('toggles an analyzer on with Space and persists immediately', async () => {
    const onSaveSpy = vi.fn();

    render(
      <FiltersDashboard
        availableAnalyzers={sampleAnalyzers}
        initialActiveFilters={['Pod']}
        onSave={onSaveSpy}
      />,
      {
        stdout: mockStdout as any,
        stdin: mockStdin as any,
        interactive: true,
      },
    );

    await waitForFrameToContain({ mockStdout, substring: 'Active: 1 / 12' });

    // Move cursor down to Deployment (index 1, inactive)
    mockStdin.sendKey({ name: 'down' });
    await sleep(50);

    // Press SPACE to toggle Deployment on
    mockStdin.sendChar({ char: ' ' });
    await waitForFrameToContain({ mockStdout, substring: 'Active: 2 / 12' });
    await waitForFrameToContain({ mockStdout, substring: '[x] Deployment' });

    expect(onSaveSpy).toHaveBeenCalledWith(['Pod', 'Deployment']);
  });

  it('exits cleanly on Q key', async () => {
    const app = render(
      <FiltersDashboard
        availableAnalyzers={sampleAnalyzers}
        initialActiveFilters={DEFAULT_FILTERS}
      />,
      {
        stdout: mockStdout as any,
        stdin: mockStdin as any,
        interactive: true,
      },
    );

    await waitForFrameToContain({ mockStdout, substring: 'Analyzer Filters' });

    let exited = false;
    app.waitUntilExit().then(() => {
      exited = true;
    });

    mockStdin.sendChar({ char: 'q' });
    await sleep(100);

    expect(exited).toBe(true);
  });
});
