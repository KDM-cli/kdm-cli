import { describe, it, expect, vi } from 'vitest';
import { createMCPTools, startMCPServer } from '../server/mcp';
import { getInstalledVersion } from '../utils/version-check';

vi.mock('../config/store', () => ({
  getActiveFilters: vi.fn(() => []),
  getAIConfig: vi.fn(() => ({ providers: [] })),
  getCacheConfig: vi.fn(() => ({ type: 'file', enabled: false })),
  getConfig: vi.fn(() => ({ ai: { providers: [] } })),
}));

vi.mock('../kubernetes/resources', () => ({
  listPods: vi.fn(async () => []),
  listDeployments: vi.fn(async () => []),
  listServices: vi.fn(async () => []),
  listPersistentVolumeClaims: vi.fn(async () => []),
  listNodes: vi.fn(async () => []),
  listReplicaSets: vi.fn(async () => []),
  listStatefulSets: vi.fn(async () => []),
  listDaemonSets: vi.fn(async () => []),
  listJobs: vi.fn(async () => []),
  listCronJobs: vi.fn(async () => []),
  listIngresses: vi.fn(async () => []),
  listConfigMaps: vi.fn(async () => []),
  listHPAs: vi.fn(async () => []),
  listPDBs: vi.fn(async () => []),
  listNetworkPolicies: vi.fn(async () => []),
  listEvents: vi.fn(async () => []),
  listStorageClasses: vi.fn(async () => []),
  listGatewayClasses: vi.fn(async () => []),
  listGateways: vi.fn(async () => []),
  listHTTPRoutes: vi.fn(async () => []),
  readEndpoints: vi.fn(async () => undefined),
  readPodLog: vi.fn(async () => ''),
  labelsToSelector: vi.fn(() => ''),
}));

vi.mock('../cache', () => ({
  createCacheProvider: vi.fn(() => ({
    name: 'file',
    configure: vi.fn(),
    store: vi.fn(),
    load: vi.fn(async () => null),
    list: vi.fn(async () => []),
    remove: vi.fn(),
    exists: vi.fn(async () => false),
    purge: vi.fn(),
  })),
}));

describe('MCP Tools', () => {
  it('registers all expected tools', () => {
    const tools = createMCPTools();
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toContain('analyze_cluster');
    expect(names).toContain('list_filters');
    expect(names).toContain('get_cluster_health');
    expect(names).toContain('get_resource_issues');
  });

  it('list_filters returns available filters', async () => {
    const tools = createMCPTools();
    const listTool = tools.find((t) => t.name === 'list_filters')!;
    const result = await listTool.handler({}) as any;
    expect(result.filters).toBeDefined();
    expect(Array.isArray(result.filters)).toBe(true);
    expect(result.filters.length).toBeGreaterThan(0);
  });

  it('get_cluster_health returns status', async () => {
    const tools = createMCPTools();
    const healthTool = tools.find((t) => t.name === 'get_cluster_health')!;
    const result = await healthTool.handler({}) as any;
    expect(result.status).toBe('OK');
    expect(result.problems).toBe(0);
  });

  it('analyze_cluster runs analysis', async () => {
    const tools = createMCPTools();
    const analyzeTool = tools.find((t) => t.name === 'analyze_cluster')!;
    const result = await analyzeTool.handler({ filters: ['Pod'] }) as any;
    expect(result.status).toBeDefined();
  });

  it('get_resource_issues filters by kind', async () => {
    const tools = createMCPTools();
    const issuesTool = tools.find((t) => t.name === 'get_resource_issues')!;
    const result = await issuesTool.handler({ kind: 'Pod' }) as any;
    expect(result.status).toBe('OK');
  });

  it('startMCPServer listens to stdin and processes JSON-RPC requests', async () => {
    let dataCallback: (chunk: string) => void = () => {};
    const onSpy = vi.spyOn(process.stdin, 'on').mockImplementation((event, callback) => {
      if (event === 'data') {
        dataCallback = callback as any;
      }
      return process.stdin;
    });
    const setEncodingSpy = vi.spyOn(process.stdin, 'setEncoding').mockImplementation(() => process.stdin);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await startMCPServer();

    expect(setEncodingSpy).toHaveBeenCalledWith('utf-8');
    expect(onSpy).toHaveBeenCalledWith('data', expect.any(Function));

    const initializeRequest = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
      id: 100,
    };
    await dataCallback(JSON.stringify(initializeRequest) + '\n');

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const initializeResponse = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(initializeResponse).toEqual({
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'kdm',
          version: getInstalledVersion(),
        },
      },
      id: 100,
    });

    writeSpy.mockClear();

    const initializedNotification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };
    await dataCallback(JSON.stringify(initializedNotification) + '\n');

    expect(writeSpy).not.toHaveBeenCalled();

    // Send a list tools request
    const request = {
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1,
    };
    await dataCallback(JSON.stringify(request) + '\n');

    expect(writeSpy).toHaveBeenCalled();
    const lastWrite = writeSpy.mock.calls[0][0] as string;
    const response = JSON.parse(lastWrite.trim());
    expect(response.id).toBe(1);
    expect(response.result.tools).toBeDefined();

    // Reset spy history
    writeSpy.mockClear();

    // Send a call tool request
    const callRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'list_filters',
        arguments: {},
      },
      id: 2,
    };
    await dataCallback(JSON.stringify(callRequest) + '\n');
    expect(writeSpy).toHaveBeenCalled();
    const lastCallWrite = writeSpy.mock.calls[0][0] as string;
    const callResponse = JSON.parse(lastCallWrite.trim());
    expect(callResponse.id).toBe(2);
    expect(callResponse.result.content[0].type).toBe('text');

    // Test unknown method/tool
    writeSpy.mockClear();
    const badRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'unknown_tool',
      },
      id: 3,
    };
    await dataCallback(JSON.stringify(badRequest) + '\n');
    expect(writeSpy).toHaveBeenCalled();
    const badResponse = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(badResponse.error).toBeDefined();

    // Test parsing error
    writeSpy.mockClear();
    await dataCallback('invalid json\n');
    expect(writeSpy).toHaveBeenCalled();
    const parseErrorResponse = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(parseErrorResponse.error).toBeDefined();

    onSpy.mockRestore();
    setEncodingSpy.mockRestore();
    writeSpy.mockRestore();
  });
});
