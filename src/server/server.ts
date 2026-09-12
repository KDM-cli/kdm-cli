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
  // Optional callback invoked on each request for logging/metrics
  onRequest?: (info: { timestamp: string; method: string; path: string; status: number; responseTimeMs: number }) => void;
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
  new Promise((resolve, reject) => {
    let body = '';
    // Limit to 1MB to prevent DoS via memory exhaustion
    const MAX_SIZE = 1024 * 1024;
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        reject(new Error('Payload Too Large'));
        // Let the request complete its stream but ignore the rest,
        // so we don't close the socket abruptly resulting in UND_ERR_SOCKET
        req.pause();
        return;
      }
      body += chunk.toString();
    });

    req.on('end', () => resolve(body));
    req.on('error', (err: Error) => reject(err));
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
        providers: config.ai.providers.map((p) => ({
          ...p,
          password: p.password ? '****' : undefined,
          customHeaders: p.customHeaders ? Object.fromEntries(Object.entries(p.customHeaders).map(([k]) => [k, '****'])) : undefined,
        })),
      } : undefined,
      notifications: config.notifications ? {
        ...config.notifications,
        discordWebhook: config.notifications.discordWebhook ? '****' : undefined,
        emailPassword: config.notifications.emailPassword ? '****' : undefined,
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
  const fullUrl = req.url ?? '';
  const method = req.method ?? 'GET';

  // Extract pathname without query parameters
  const pathname = fullUrl.split('?')[0];

  const getHandlers: Record<string, (res: any) => void> = {
    '/health': handleHealth,
    '/filters': handleFilters,
    '/config': handleConfig,
  };

  if (method === 'GET' && pathname in getHandlers) {
    getHandlers[pathname](res);
    return;
  }

  if (method === 'POST' && pathname === '/analyze') {
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
  const os = await import('node:os');

  const server = createHttpServer((req, res) => {
    const startMs = Date.now();
    let recordedStatus = 200;

    // Wrap writeHead to capture status codes set by handlers
    const origWriteHead = res.writeHead?.bind(res);
    if (origWriteHead) {
      // @ts-ignore
      res.writeHead = function writeHead(statusCode: number, ...rest: any[]) {
        recordedStatus = statusCode;
        // @ts-ignore
        return origWriteHead(statusCode, ...rest);
      };
    }

    // Wrap end so we can compute response time once response completes
    const origEnd = res.end?.bind(res);
    if (origEnd) {
      // @ts-ignore
      res.end = function end(...args: any[]) {
        const duration = Date.now() - startMs;
        try {
          options.onRequest?.({
            timestamp: new Date(startMs).toISOString(),
            method: req.method ?? 'GET',
            path: req.url ?? '/',
            status: recordedStatus ?? (res.statusCode ?? 200),
            responseTimeMs: duration,
          });
        } catch (e) {
          // Ignore logging errors
        }
        // @ts-ignore
        return origEnd(...args);
      };
    }

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
