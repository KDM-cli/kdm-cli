/**
 * NDJSON Streaming Event Protocol — TypeScript Parser / Validator
 * ================================================================
 * Validates incoming NDJSON lines from the Python multi-agent engine
 * against the {@link NDJSONEvent} discriminated union.
 *
 * Design decisions:
 * - Returns `null` for blank lines and unparseable input (fail-safe).
 * - Uses a lookup table of per-event validators to keep cyclomatic
 *   complexity strictly below the project's threshold of 9.
 */

import type { NDJSONEvent } from './types';

/** Guard that checks a value is a non-null object. */
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Guard that checks a value is a string. */
const isString = (v: unknown): v is string => typeof v === 'string';

/** Guard that checks a value is a finite number. */
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Guard that checks a value is a boolean. */
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Guard that checks a value is an array of strings. */
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(isString);

/** Valid agent roles per the four-role contract. */
const VALID_ROLES = new Set(['runtime', 'config', 'resource', 'synthesizer']);

/** Guard that checks a value is a valid agent role. */
const isAgentRole = (v: unknown): boolean =>
  typeof v === 'string' && VALID_ROLES.has(v);

/** Guard that validates the consensus diagnosis structure. */
const isValidConsensus = (c: unknown): boolean => {
  if (!isObject(c)) return false;
  if (!isString(c.rootCause) || !isString(c.confidence)) return false;
  if (!Array.isArray(c.findings)) return false;
  if (!isObject(c.bestSolution)) return false;
  const bs = c.bestSolution;
  return isString(bs.actionTitle) && isStringArray(bs.steps) && isString(bs.riskLevel);
};

// ─── Per-Event Validators ───────────────────────────────────────────────────

/**
 * Validates an `analysis_start` event payload.
 * @param d Parsed JSON object to validate.
 * @returns The typed event or null if invalid.
 */
const validateAnalysisStart = (d: Record<string, unknown>): NDJSONEvent | null =>
  isString(d.analysisId)
    ? d as unknown as NDJSONEvent
    : null;

/**
 * Validates an `evidence_collected` event payload.
 * @param d Parsed JSON object to validate.
 * @returns The typed event or null if invalid.
 */
const validateEvidenceCollected = (d: Record<string, unknown>): NDJSONEvent | null =>
  isNumber(d.count) && isStringArray(d.ids)
    ? d as unknown as NDJSONEvent
    : null;

/**
 * Validates a `rule_matched` event payload.
 * @param d Parsed JSON object to validate.
 * @returns The typed event or null if invalid.
 */
const validateRuleMatched = (d: Record<string, unknown>): NDJSONEvent | null =>
  isString(d.ruleId) && isString(d.title)
    ? d as unknown as NDJSONEvent
    : null;

/**
 * Validates an `agent_start` event payload.
 * @param d Parsed JSON object to validate.
 * @returns The typed event or null if invalid.
 */
const validateAgentStart = (d: Record<string, unknown>): NDJSONEvent | null =>
  isAgentRole(d.role) && isString(d.message)
    ? d as unknown as NDJSONEvent
    : null;

/**
 * Validates an `agent_tool_call` event payload.
 * @param d Parsed JSON object to validate.
 * @returns The typed event or null if invalid.
 */
const validateAgentToolCall = (d: Record<string, unknown>): NDJSONEvent | null =>
  isString(d.role) && isString(d.tool) && isObject(d.args)
    ? d as unknown as NDJSONEvent
    : null;

/**
 * Validates an `agent_tool_result` event payload.
 * @param d Parsed JSON object to validate.
 * @returns The typed event or null if invalid.
 */
const validateAgentToolResult = (d: Record<string, unknown>): NDJSONEvent | null =>
  isString(d.role) && isString(d.tool) && isNumber(d.durationMs)
    ? d as unknown as NDJSONEvent
    : null;

/**
 * Validates an `agent_progress` event payload.
 * @param d Parsed JSON object to validate.
 * @returns The typed event or null if invalid.
 */
const validateAgentProgress = (d: Record<string, unknown>): NDJSONEvent | null =>
  isString(d.role) && isString(d.message)
    ? d as unknown as NDJSONEvent
    : null;

/**
 * Validates an `agent_complete` event payload.
 * @param d Parsed JSON object to validate.
 * @returns The typed event or null if invalid.
 */
const validateAgentComplete = (d: Record<string, unknown>): NDJSONEvent | null =>
  isString(d.role) && isString(d.summary)
    ? d as unknown as NDJSONEvent
    : null;

/**
 * Validates an `agent_failed` event payload.
 * @param d Parsed JSON object to validate.
 * @returns The typed event or null if invalid.
 */
const validateAgentFailed = (d: Record<string, unknown>): NDJSONEvent | null =>
  isString(d.role) && isString(d.error)
    ? d as unknown as NDJSONEvent
    : null;

/**
 * Validates a `diagnosis_ready` event payload.
 * @param d Parsed JSON object to validate.
 * @returns The typed event or null if invalid.
 */
const validateDiagnosisReady = (d: Record<string, unknown>): NDJSONEvent | null =>
  isValidConsensus(d.consensus)
    ? d as unknown as NDJSONEvent
    : null;

/**
 * Validates a protocol-level `error` event payload.
 * @param d Parsed JSON object to validate.
 * @returns The typed event or null if invalid.
 */
const validateError = (d: Record<string, unknown>): NDJSONEvent | null =>
  isString(d.message) && isBool(d.fatal)
    ? d as unknown as NDJSONEvent
    : null;

/** Lookup table mapping event names to their validator functions. */
const validators: Record<string, (d: Record<string, unknown>) => NDJSONEvent | null> = {
  analysis_start: validateAnalysisStart,
  evidence_collected: validateEvidenceCollected,
  rule_matched: validateRuleMatched,
  agent_start: validateAgentStart,
  agent_tool_call: validateAgentToolCall,
  agent_tool_result: validateAgentToolResult,
  agent_progress: validateAgentProgress,
  agent_complete: validateAgentComplete,
  agent_failed: validateAgentFailed,
  diagnosis_ready: validateDiagnosisReady,
  error: validateError,
};

/**
 * Parses a single NDJSON line emitted by the Python multi-agent engine
 * and validates it against the {@link NDJSONEvent} schema.
 *
 * Returns `null` for empty lines, non-JSON content, or payloads that
 * fail structural validation — callers should silently skip such lines.
 *
 * @param line Raw line string (may include trailing newline).
 * @returns A validated {@link NDJSONEvent} or `null`.
 */
export function parseNDJSONLine(line: string): NDJSONEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isObject(data)) return null;

  const eventName = data.event;
  if (!isString(eventName) || !isString(data.timestamp)) return null;

  if (!Object.prototype.hasOwnProperty.call(validators, eventName)) return null;

  const validator = validators[eventName];
  return validator ? validator(data) : null;
}
