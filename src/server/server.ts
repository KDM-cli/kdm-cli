import { runAnalysis } from '../analysis/analysis';
import { registry } from '../analyzers';
import { getConfig } from '../config/store';
import type { AnalysisOptions } from '../analysis/types';

/** Options for starting the HTTP server. */
export interface ServerOptions {
  port: number;
  metricsPort?: number;
  backend?: string;
  filter?: string[];
}

/** Simplified request body for the /analyze endpoint. */
interface AnalyzeRequestBody {
  filters?: string[];
  namespace?: string;
  explain?: boolean;
  backend?: string;
  output?: 'text' | 'json';
}

/**
 * Creates a minimal HTTP server that reuses the CLI analysis engine.
 * Exposes GET /health, POST /analyze, GET /filters, GET /config.
 * @param options Server configuration options.
 * @returns An object with a close() method to shut down the server.
 */
/**
 * Reads the full request body as a UTF-8 string.
 * @param req The incoming HTTP request.
 * @returns Parsed body string.
 */
export const readBody = (req: any): Promise<string> =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });

/**
 * Sends a JSON response with the given status code.
 * @param res The HTTP response object.
 * @param status HTTP status code.
 * @param data Response payload.
 */
export const sendJson = (res: any, status: number, data: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

/**
 * Handles the GET /health endpoint.
 * @param res The HTTP response object.
 */
export const handleHealth = (res: any): void => {
  sendJson(res, 200, { status: 'ok' });
};

/**
 * Handles the POST /analyze endpoint by running the analysis engine.
 * @param req The incoming HTTP request.
 * @param res The HTTP response object.
 * @param options Server configuration options.
 */
export const handleAnalyze = async (req: any, res: any, options: ServerOptions): Promise<void> => {
  try {
    const raw = await readBody(req);
    const body: AnalyzeRequestBody = raw ? JSON.parse(raw) : {};
    const analysisOpts: AnalysisOptions = {
      filters: body.filters ?? options.filter,
      namespace: body.namespace,
      explain: body.explain,
      backend: body.backend ?? options.backend,
      output: 'json',
    };
    const result = await runAnalysis(analysisOpts);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: (error as Error).message });
  }
};

/**
 * Handles the GET /filters endpoint returning available analyzers.
 * @param res The HTTP response object.
 */
export const handleFilters = (res: any): void => {
  const filters = registry.list().map((a) => a.name);
  sendJson(res, 200, { filters });
};

/**
 * Handles the GET /config endpoint returning sanitized configuration.
 * @param res The HTTP response object.
 */
export const handleConfig = (res: any): void => {
  try {
    const config = getConfig();
    const sanitized = {
      ...config,
      ai: config.ai ? {
        ...config.ai,
        providers: config.ai.providers.map((p) => ({ ...p, password: '****' })),
      } : undefined,
    };
    sendJson(res, 200, sanitized);
  } catch (error) {
    sendJson(res, 500, { error: (error as Error).message });
  }
};

/**
 * Route incoming requests to their respective handlers.
 * @param req The incoming HTTP request.
 * @param res The HTTP response object.
 * @param options Server configuration options.
 */
export const routeRequest = (req: any, res: any, options: ServerOptions): void => {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';

  const getHandlers: Record<string, (res: any) => void> = {
    '/health': handleHealth,
    '/filters': handleFilters,
    '/config': handleConfig,
  };

  if (method === 'GET' && url in getHandlers) {
    getHandlers[url](res);
    return;
  }

  if (method === 'POST' && url === '/analyze') {
    handleAnalyze(req, res, options);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
};

/**
 * Creates a minimal HTTP server that reuses the CLI analysis engine.
 * Exposes GET /health, POST /analyze, GET /filters, GET /config.
 * @param options Server configuration options.
 * @returns An object with a close() method and the allocated port.
 */
export async function createServer(options: ServerOptions): Promise<{ close: () => void; port: number }> {
  const { createServer: createHttpServer } = await import('node:http');

  const server = createHttpServer((req, res) => {
    routeRequest(req, res, options);
  });

  return new Promise((resolve) => {
    server.listen(options.port, () => {
      const address = server.address();
      const port = typeof address === 'string' ? 0 : (address?.port ?? 0);
      resolve({
        close: () => server.close(),
        port,
      });
    });
  });
}
