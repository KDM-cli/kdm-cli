"""
Unit tests for ``agents.core.events`` — NDJSON event emission layer.
"""

from __future__ import annotations

import io
import json
import os
import sys
import unittest
from unittest.mock import patch

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

from core.events import (
    emit_agent_complete,
    emit_agent_failed,
    emit_agent_progress,
    emit_agent_start,
    emit_agent_tool_call,
    emit_agent_tool_result,
    emit_analysis_start,
    emit_diagnosis_ready,
    emit_error,
    emit_event,
    emit_evidence_collected,
    emit_rule_matched,
)


class TestEmitEvent(unittest.TestCase):
    """Verify ``emit_event`` writes a single flushed NDJSON line."""

    def _capture(self, fn, *args, **kwargs):
        """Run *fn* and return the captured stdout as a string."""
        buf = io.StringIO()
        with patch.object(sys, "stdout", buf):
            fn(*args, **kwargs)
        return buf.getvalue()

    def _parse_line(self, raw: str) -> dict:
        """Parse a single NDJSON line and assert it ends with newline."""
        self.assertTrue(raw.endswith("\n"), "Output must end with newline")
        lines = raw.strip().split("\n")
        self.assertEqual(len(lines), 1, "Must emit exactly one line")
        return json.loads(lines[0])

    def test_generic_emit_event(self):
        """emit_event includes event name, timestamp, and extra kwargs."""
        raw = self._capture(emit_event, "test_event", foo="bar", count=42)
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "test_event")
        self.assertIn("timestamp", data)
        self.assertEqual(data["foo"], "bar")
        self.assertEqual(data["count"], 42)

    def test_analysis_start(self):
        """emit_analysis_start emits correct shape."""
        raw = self._capture(emit_analysis_start, "an-001")
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "analysis_start")
        self.assertEqual(data["analysisId"], "an-001")

    def test_evidence_collected(self):
        """emit_evidence_collected emits count and ids."""
        raw = self._capture(
            emit_evidence_collected, 3, ["ev.pod", "ev.logs", "ev.config"]
        )
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "evidence_collected")
        self.assertEqual(data["count"], 3)
        self.assertEqual(len(data["ids"]), 3)

    def test_agent_start(self):
        """emit_agent_start emits role and message."""
        raw = self._capture(emit_agent_start, "runtime", "Starting...")
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "agent_start")
        self.assertEqual(data["role"], "runtime")
        self.assertEqual(data["message"], "Starting...")

    def test_agent_tool_call(self):
        """emit_agent_tool_call emits role, tool, and args."""
        raw = self._capture(
            emit_agent_tool_call, "config", "get_env", {"key": "PATH"}
        )
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "agent_tool_call")
        self.assertEqual(data["tool"], "get_env")
        self.assertIsInstance(data["args"], dict)

    def test_agent_tool_result(self):
        """emit_agent_tool_result emits durationMs."""
        raw = self._capture(emit_agent_tool_result, "runtime", "get_logs", 250)
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "agent_tool_result")
        self.assertEqual(data["durationMs"], 250)

    def test_agent_progress(self):
        """emit_agent_progress emits role and message."""
        raw = self._capture(emit_agent_progress, "config", "50% done")
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "agent_progress")
        self.assertEqual(data["message"], "50% done")

    def test_agent_complete(self):
        """emit_agent_complete emits role and summary."""
        raw = self._capture(emit_agent_complete, "runtime", "OOMKilled")
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "agent_complete")
        self.assertEqual(data["summary"], "OOMKilled")

    def test_agent_failed(self):
        """emit_agent_failed emits role and error."""
        raw = self._capture(emit_agent_failed, "resource", "Timeout")
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "agent_failed")
        self.assertEqual(data["error"], "Timeout")

    def test_diagnosis_ready(self):
        """emit_diagnosis_ready emits the consensus object."""
        consensus = {"rootCause": "OOM", "confidence": "high"}
        raw = self._capture(emit_diagnosis_ready, consensus)
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "diagnosis_ready")
        self.assertEqual(data["consensus"]["rootCause"], "OOM")

    def test_diagnosis_ready_with_to_dict(self):
        """emit_diagnosis_ready handles objects with to_dict() method."""
        class MockConsensus:
            def to_dict(self):
                return {"rootCause": "CrashLoopBackOff", "confidence": "high"}

        raw = self._capture(emit_diagnosis_ready, MockConsensus())
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "diagnosis_ready")
        self.assertEqual(data["consensus"]["rootCause"], "CrashLoopBackOff")

    def test_error_event(self):
        """emit_error emits message and fatal flag."""
        raw = self._capture(emit_error, "Connection lost", fatal=True)
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "error")
        self.assertEqual(data["message"], "Connection lost")
        self.assertTrue(data["fatal"])

    def test_error_default_not_fatal(self):
        """emit_error defaults fatal to False."""
        raw = self._capture(emit_error, "Minor issue")
        data = self._parse_line(raw)
        self.assertFalse(data["fatal"])

    def test_rule_matched(self):
        """emit_rule_matched emits ruleId and title."""
        raw = self._capture(emit_rule_matched, "r-001", "CrashLoop")
        data = self._parse_line(raw)
        self.assertEqual(data["event"], "rule_matched")
        self.assertEqual(data["ruleId"], "r-001")
        self.assertEqual(data["title"], "CrashLoop")


if __name__ == "__main__":
    unittest.main()
