import fs from 'node:fs';
import path from 'node:path';

/**
 * Placeholder sentinel string replacing redacted sensitive values.
 */
export const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Regular expression matching sensitive keys per Phase 19 specification:
 * (?i)(password|secret|key|token|auth|bearer)
 */
export const SENSITIVE_KEY_PATTERN = /(?:password|secret|key|token|auth|bearer)/i;

/**
 * Patterns matching sensitive secrets embedded inside text strings.
 */
const PRIVATE_KEY_PATTERN = /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/gi;
const AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const KV_SECRET_PATTERN = /\b((?:password|secret|token|api_key|apiKey|bearer)\s*[:=]\s*)([^\s,"'&]+)/gi;

/**
 * Target workload descriptor for incident post-mortem analysis.
 */
export interface IncidentTarget {
  kind: string;
  name: string;
  namespace?: string;
  [key: string]: unknown;
}

/**
 * Individual tool invocation record captured during incident triaging.
 */
export interface IncidentToolCall {
  tool: string;
  durationMs?: number;
  status?: 'success' | 'failure' | 'error' | string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Diagnosis consensus structure synthesized by specialist agents or diagnostic rules.
 */
export interface IncidentConsensus {
  rootCause?: string;
  confidence?: string;
  findings?: unknown[];
  bestSolution?: unknown;
  evidenceCitations?: string[];
  [key: string]: unknown;
}

/**
 * Structured incident audit trail schema for enterprise post-mortems and compliance.
 */
export interface IncidentAuditSession {
  sessionId: string;
  cliVersion: string;
  target: IncidentTarget;
  evidence: unknown;
  toolCalls: IncidentToolCall[];
  consensus?: IncidentConsensus;
  timestamp?: string;
  specialistReports?: unknown[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Configuration options for incident export.
 */
export interface ExportAuditOptions {
  filePath: string;
  session: IncidentAuditSession;
  pretty?: boolean;
}

/**
 * Parameters for building an incident audit session bundle.
 */
export interface CreateAuditSessionParams {
  sessionId?: string;
  cliVersion?: string;
  target: IncidentTarget;
  evidence?: unknown;
  toolCalls?: IncidentToolCall[];
  consensus?: IncidentConsensus;
  timestamp?: string;
  specialistReports?: unknown[];
  metadata?: Record<string, unknown>;
}

/**
 * Checks whether an object key matches sensitive credential naming heuristics.
 *
 * @param key The key to inspect.
 * @returns True if the key indicates sensitive authentication or credential data.
 */
export function isSensitiveKey(key: string): boolean {
  if (typeof key !== 'string') return false;
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Type guard for plain dictionary objects.
 */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Tests whether a key-value pair represents a sensitive Kubernetes env entry.
 */
function isSensitiveEnvEntry(key: string, value: unknown): boolean {
  const lower = key.toLowerCase();
  return (lower === 'name' || lower === 'key') && typeof value === 'string' && isSensitiveKey(value);
}

/**
 * Checks if a Kubernetes-style env/secret object contains a sensitive `name` or `key` sibling.
 */
function hasSensitiveEnvSibling(obj: Record<string, unknown>): boolean {
  return Object.entries(obj).some(([k, v]) => isSensitiveEnvEntry(k, v));
}

/**
 * Determines whether a dictionary property value should be replaced with REDACTED.
 */
function shouldRedactProperty(key: string, hasEnvSibling: boolean): boolean {
  return isSensitiveKey(key) || (hasEnvSibling && key.toLowerCase() === 'value');
}

/**
 * Scrubs embedded bearer tokens, private keys, and inline credentials from strings.
 */
function sanitizeString(val: string): string {
  return val
    .replace(PRIVATE_KEY_PATTERN, REDACTED_PLACEHOLDER)
    .replace(AUTH_HEADER_PATTERN, `$1 ${REDACTED_PLACEHOLDER}`)
    .replace(KV_SECRET_PATTERN, `$1${REDACTED_PLACEHOLDER}`);
}

/**
 * Sanitizes array elements recursively with cycle protection.
 */
function sanitizeArray(arr: unknown[], seen: WeakSet<object>): unknown[] {
  return arr.map((item) => sanitizeValue(item, seen));
}

/**
 * Sanitizes dictionary properties recursively, replacing sensitive keys and env values.
 */
function sanitizeObject(obj: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  const dest: Record<string, unknown> = {};
  const hasEnvSibling = hasSensitiveEnvSibling(obj);

  for (const [key, val] of Object.entries(obj)) {
    dest[key] = shouldRedactProperty(key, hasEnvSibling)
      ? REDACTED_PLACEHOLDER
      : sanitizeValue(val, seen);
  }

  return dest;
}

/**
 * Sanitizes complex compound container types (Arrays and Objects) with cycle detection.
 */
function sanitizeContainer(val: object, seen: WeakSet<object>): unknown {
  if (seen.has(val)) return '[CIRCULAR]';
  seen.add(val);

  if (Array.isArray(val)) {
    return sanitizeArray(val, seen);
  }
  if (isPlainObject(val)) {
    return sanitizeObject(val, seen);
  }
  return val;
}

/**
 * Core recursive value sanitizer supporting primitives, arrays, and objects.
 */
function sanitizeValue(val: unknown, seen: WeakSet<object>): unknown {
  if (typeof val === 'string') return sanitizeString(val);
  if (!val || typeof val !== 'object') return val;
  return sanitizeContainer(val, seen);
}

/**
 * Recursively sanitizes any data structure, replacing keys matching sensitive patterns
 * with `[REDACTED]` and scrubbing secret tokens from string values.
 *
 * Safe against circular references and deeply nested objects.
 *
 * @param data The data structure to sanitize.
 * @returns A new sanitized copy with sensitive data scrubbed.
 */
export function sanitizeAuditData<T>(data: T): T {
  const seen = new WeakSet<object>();
  return sanitizeValue(data, seen) as T;
}

/**
 * Alias for `sanitizeAuditData` for parity with Python sanitizer utilities.
 */
export const redactSensitiveData = sanitizeAuditData;

/**
 * Collects optional audit session fields when provided.
 */
function resolveOptionalAuditFields(params: CreateAuditSessionParams): Partial<IncidentAuditSession> {
  const extra: Partial<IncidentAuditSession> = {};
  if (params.consensus) extra.consensus = params.consensus;
  if (params.specialistReports) extra.specialistReports = params.specialistReports;
  if (params.metadata) extra.metadata = params.metadata;
  return extra;
}

/**
 * Assembles and normalizes an incident audit session bundle.
 *
 * @param params Audit session construction properties.
 * @returns Fully populated IncidentAuditSession object.
 */
export function createIncidentAuditSession(params: CreateAuditSessionParams): IncidentAuditSession {
  const baseSession: IncidentAuditSession = {
    sessionId: params.sessionId ?? `an-${Date.now()}`,
    cliVersion: params.cliVersion ?? '4.0.0',
    target: params.target,
    evidence: params.evidence ?? {},
    toolCalls: params.toolCalls ?? [],
    timestamp: params.timestamp ?? new Date().toISOString(),
  };

  return Object.assign(baseSession, resolveOptionalAuditFields(params));
}

/**
 * Formats sanitized audit session into a human-readable JSON string.
 */
function formatAuditJson(session: IncidentAuditSession): string {
  return JSON.stringify(session, null, 2) + '\n';
}

/**
 * Writes audit content to the target file path, creating directories as needed.
 */
async function writeAuditFile(filePath: string, content: string): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const targetDir = path.dirname(resolvedPath);
  await fs.promises.mkdir(targetDir, { recursive: true });
  await fs.promises.writeFile(resolvedPath, content, 'utf8');
}

/**
 * Validates file path argument ensuring it is a non-empty string.
 */
function validateFilePath(filePath: unknown): string {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Target file path must be a non-empty string');
  }
  return filePath;
}

/**
 * Validates session data argument ensuring it is an object.
 */
function validateSession(session: unknown): IncidentAuditSession {
  if (!session || typeof session !== 'object') {
    throw new Error('Incident audit session data must be provided');
  }
  return session as IncidentAuditSession;
}

/**
 * Resolves input arguments whether passed as separate (filePath, session) or an options object.
 */
function resolveExportParams(
  targetOrPath: string | ExportAuditOptions,
  sessionData?: IncidentAuditSession
): { filePath: string; session: IncidentAuditSession } {
  if (typeof targetOrPath === 'string') {
    return {
      filePath: validateFilePath(targetOrPath),
      session: validateSession(sessionData),
    };
  }

  if (!targetOrPath || typeof targetOrPath !== 'object') {
    throw new Error('Invalid export arguments: file path or options object expected');
  }

  return {
    filePath: validateFilePath(targetOrPath.filePath),
    session: validateSession(targetOrPath.session),
  };
}

/**
 * Exports a sanitized incident audit session to a formatted JSON file.
 *
 * Bundles the complete session timeline: target workload, raw evidence collected,
 * tool execution history with durations, specialist agent reports, and consensus diagnosis.
 *
 * Strips all passwords, auth tokens, bearer headers, and private keys.
 *
 * @param targetOrPath Target file path string or ExportAuditOptions object.
 * @param sessionData The incident audit session (when targetOrPath is a string).
 * @returns The sanitized incident audit session object written to disk.
 */
export async function exportIncidentAudit(
  targetOrPath: string | ExportAuditOptions,
  sessionData?: IncidentAuditSession
): Promise<IncidentAuditSession> {
  const { filePath, session } = resolveExportParams(targetOrPath, sessionData);
  const normalized = createIncidentAuditSession(session);
  const sanitized = sanitizeAuditData(normalized);
  const formattedJson = formatAuditJson(sanitized);

  await writeAuditFile(filePath, formattedJson);
  return sanitized;
}
