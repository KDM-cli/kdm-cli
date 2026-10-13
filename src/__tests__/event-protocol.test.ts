import { describe, it, expect } from 'vitest';
import { parseNDJSONLine } from '../agent/event-schema';
import type { NDJSONEvent } from '../agent/types';

/**
 * Cross-language event protocol tests for Phase 11.
 * These sample lines mirror the exact NDJSON that the Python
 * `agents/core/events.py` module emits via `emit_event()`.
 */

// ─── Valid Event Fixtures ────────────────────────────────────────────────────

/** Sample NDJSON lines representing each valid event variant. */
const validEvents: { name: string; line: string; expected: Partial<NDJSONEvent> }[] = [
  {
    name: 'analysis_start',
    line: '{"event":"analysis_start","analysisId":"an-123","timestamp":"2026-09-11T12:00:00Z"}',
    expected: { event: 'analysis_start', analysisId: 'an-123', timestamp: '2026-09-11T12:00:00Z' },
  },
  {
    name: 'evidence_collected',
    line: '{"event":"evidence_collected","count":12,"ids":["ev.pod.status","ev.logs"],"timestamp":"2026-09-11T12:00:01Z"}',
    expected: { event: 'evidence_collected', count: 12, ids: ['ev.pod.status', 'ev.logs'] },
  },
  {
    name: 'rule_matched',
    line: '{"event":"rule_matched","ruleId":"r-oom-001","title":"OOM Kill Detected","timestamp":"2026-09-11T12:00:02Z"}',
    expected: { event: 'rule_matched', ruleId: 'r-oom-001', title: 'OOM Kill Detected' },
  },
  {
    name: 'agent_start',
    line: '{"event":"agent_start","role":"runtime","message":"Inspecting container exit code and logs...","timestamp":"2026-09-11T12:00:03Z"}',
    expected: { event: 'agent_start', role: 'runtime', message: 'Inspecting container exit code and logs...' },
  },
  {
    name: 'agent_tool_call',
    line: '{"event":"agent_tool_call","role":"runtime","tool":"get_container_logs","args":{"previous":true},"timestamp":"2026-09-11T12:00:04Z"}',
    expected: { event: 'agent_tool_call', role: 'runtime', tool: 'get_container_logs' },
  },
  {
    name: 'agent_tool_result',
    line: '{"event":"agent_tool_result","role":"runtime","tool":"get_container_logs","durationMs":120,"timestamp":"2026-09-11T12:00:05Z"}',
    expected: { event: 'agent_tool_result', role: 'runtime', tool: 'get_container_logs', durationMs: 120 },
  },
  {
    name: 'agent_progress',
    line: '{"event":"agent_progress","role":"config","message":"Checking resource limits...","timestamp":"2026-09-11T12:00:06Z"}',
    expected: { event: 'agent_progress', role: 'config', message: 'Checking resource limits...' },
  },
  {
    name: 'agent_complete',
    line: '{"event":"agent_complete","role":"runtime","summary":"OOMKilled detected","timestamp":"2026-09-11T12:00:07Z"}',
    expected: { event: 'agent_complete', role: 'runtime', summary: 'OOMKilled detected' },
  },
  {
    name: 'agent_failed',
    line: '{"event":"agent_failed","role":"resource","error":"Timeout querying node metrics","timestamp":"2026-09-11T12:00:08Z"}',
    expected: { event: 'agent_failed', role: 'resource', error: 'Timeout querying node metrics' },
  },
  {
    name: 'diagnosis_ready',
    line: '{"event":"diagnosis_ready","consensus":{"rootCause":"OOM","confidence":"high","findings":[],"bestSolution":{"actionTitle":"Increase memory","steps":["Set limits"],"riskLevel":"low"}},"timestamp":"2026-09-11T12:00:09Z"}',
    expected: { event: 'diagnosis_ready' },
  },
  {
    name: 'error',
    line: '{"event":"error","message":"Python agent crashed","fatal":true,"timestamp":"2026-09-11T12:00:10Z"}',
    expected: { event: 'error', message: 'Python agent crashed', fatal: true },
  },
];

// ─── Invalid Input Fixtures ──────────────────────────────────────────────────

/** Inputs that must return null from the parser. */
const invalidInputs: { label: string; line: string }[] = [
  { label: 'empty string', line: '' },
  { label: 'whitespace only', line: '   ' },
  { label: 'non-JSON text', line: 'WARNING: something happened' },
  { label: 'JSON array', line: '[1,2,3]' },
  { label: 'JSON without event key', line: '{"type":"progress","role":"runtime"}' },
  { label: 'missing required field (analysisId)', line: '{"event":"analysis_start","timestamp":"2026-09-11T12:00:00Z"}' },
  { label: 'wrong type for count', line: '{"event":"evidence_collected","count":"twelve","ids":[]}' },
  { label: 'wrong type for fatal', line: '{"event":"error","message":"fail","fatal":"yes"}' },
  { label: 'unknown event name', line: '{"event":"unknown_event","data":123}' },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('NDJSON Event Protocol Parser', () => {
  describe('valid events', () => {
    it.each(validEvents)('parses $name event correctly', ({ line, expected }) => {
      const result = parseNDJSONLine(line);
      expect(result).not.toBeNull();
      expect(result).toMatchObject(expected);
    });
  });

  describe('invalid inputs', () => {
    it.each(invalidInputs)('returns null for $label', ({ line }) => {
      const result = parseNDJSONLine(line);
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles trailing newline characters', () => {
      const line = '{"event":"analysis_start","analysisId":"an-456","timestamp":"2026-09-11T12:00:00Z"}\n';
      const result = parseNDJSONLine(line);
      expect(result).not.toBeNull();
      expect(result!.event).toBe('analysis_start');
    });

    it('handles lines with leading/trailing whitespace', () => {
      const line = '  {"event":"agent_complete","role":"config","summary":"All good"}  ';
      const result = parseNDJSONLine(line);
      expect(result).not.toBeNull();
      expect(result!.event).toBe('agent_complete');
    });

    it('validates agent_tool_call args must be an object', () => {
      const line = '{"event":"agent_tool_call","role":"runtime","tool":"t","args":"not-object"}';
      expect(parseNDJSONLine(line)).toBeNull();
    });

    it('validates diagnosis_ready consensus must be an object', () => {
      const line = '{"event":"diagnosis_ready","consensus":"not-an-object"}';
      expect(parseNDJSONLine(line)).toBeNull();
    });

    it('rejects arrays as top-level value', () => {
      expect(parseNDJSONLine('["event","test"]')).toBeNull();
    });
  });
});
