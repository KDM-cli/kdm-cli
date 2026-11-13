"""
Unit Tests — Evidence Store & Tool Audit Trail (agents/core/store.py)
======================================================================
Tests cover:
  - ToolCallRecord default UUID generation, field defaults, and argument scrubbing.
  - ToolCallRecord to_dict and from_dict round-trips.
  - FindingRecord creation, validation, and to_dict/from_dict round-trips.
  - EvidenceStore tool call and finding recording.
  - Validation that findings cannot be recorded without evidence references.
  - Provenance resolution linking findings to supporting tool calls.
  - Audit log export and JSON serialisation.
  - ToolRegistry automatic duration measurement, audit recording, and error handling.
  - Thread safety under concurrent recording operations.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import time
from typing import Any, Dict
import unittest

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

from core.store import EvidenceStore, FindingRecord, ToolCallRecord  # noqa: E402
from tools.registry import ToolRegistry  # noqa: E402


def _run_async(coro: Any) -> Any:
    """Run an async coroutine safely on a fresh event loop."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestToolCallRecord(unittest.TestCase):
    """Tests for :class:`~core.store.ToolCallRecord`."""

    def test_default_call_id_format(self) -> None:
        """Call ID must match the call-<hex8> format."""
        record = ToolCallRecord()
        self.assertTrue(record.call_id.startswith("call-"))
        self.assertEqual(len(record.call_id), 13)
        self.assertRegex(record.call_id, r"^call-[0-9a-f]{8}$")

    def test_default_values(self) -> None:
        """Default attributes must match expected initial state."""
        now = time.time()
        record = ToolCallRecord()
        self.assertEqual(record.agent_role, "")
        self.assertEqual(record.tool_name, "")
        self.assertEqual(record.arguments, {})
        self.assertIsNone(record.result)
        self.assertIsNone(record.error)
        self.assertAlmostEqual(record.started_at, now, delta=2.0)
        self.assertEqual(record.duration_ms, 0)
        self.assertEqual(record.status, "pending")

    def test_argument_scrubbing_on_init(self) -> None:
        """Sensitive argument keys must be redacted upon construction."""
        args = {
            "token": "secret_token_123",
            "password": "super_secret_pw",
            "db_secret": "raw_secret",
            "namespace": "production",
            "nested": {"api_key": "hidden_key", "timeout": 30},
        }
        record = ToolCallRecord(arguments=args)
        self.assertEqual(record.arguments["token"], "[REDACTED_BY_KDM]")
        self.assertEqual(record.arguments["password"], "[REDACTED_BY_KDM]")
        self.assertEqual(record.arguments["db_secret"], "[REDACTED_BY_KDM]")
        self.assertEqual(record.arguments["namespace"], "production")
        self.assertEqual(record.arguments["nested"]["api_key"], "[REDACTED_BY_KDM]")
        self.assertEqual(record.arguments["nested"]["timeout"], 30)

    def test_to_dict_and_from_dict_roundtrip(self) -> None:
        """Record must faithfully serialize to and deserialize from dict."""
        record = ToolCallRecord(
            call_id="call-1234abcd",
            agent_role="runtime",
            tool_name="get_container_logs",
            arguments={"tail_lines": 50, "token": "mypass"},
            result={"lines": ["log1", "log2"]},
            error=None,
            started_at=1700000000.0,
            duration_ms=142,
            status="success",
        )
        data = record.to_dict()
        self.assertEqual(data["call_id"], "call-1234abcd")
        self.assertEqual(data["arguments"]["token"], "[REDACTED_BY_KDM]")

        reconstructed = ToolCallRecord.from_dict(data)
        self.assertEqual(reconstructed.call_id, record.call_id)
        self.assertEqual(reconstructed.agent_role, record.agent_role)
        self.assertEqual(reconstructed.tool_name, record.tool_name)
        self.assertEqual(reconstructed.result, record.result)
        self.assertEqual(reconstructed.duration_ms, record.duration_ms)
        self.assertEqual(reconstructed.status, record.status)


class TestFindingRecord(unittest.TestCase):
    """Tests for :class:`~core.store.FindingRecord`."""

    def test_creation_and_attributes(self) -> None:
        """Finding record correctly captures claim, confidence, and refs."""
        finding = FindingRecord(
            finding_id="finding-oom-001",
            agent_role="runtime",
            claim="Container was killed by OOMKiller (exit code 137).",
            confidence=0.98,
            evidence_refs=["ev.pod.container.status", "call-4f9e12"],
        )
        self.assertEqual(finding.finding_id, "finding-oom-001")
        self.assertEqual(finding.agent_role, "runtime")
        self.assertEqual(
            finding.claim,
            "Container was killed by OOMKiller (exit code 137).",
        )
        self.assertEqual(finding.confidence, 0.98)
        self.assertEqual(
            finding.evidence_refs,
            ["ev.pod.container.status", "call-4f9e12"],
        )

    def test_to_dict_and_from_dict_roundtrip(self) -> None:
        """Finding record must serialize to and deserialize from dict."""
        finding = FindingRecord(
            finding_id="finding-probe-002",
            agent_role="network",
            claim="Liveness probe failed due to connection timeout.",
            confidence=0.85,
            evidence_refs=["call-a1b2c3d4"],
        )
        data = finding.to_dict()
        self.assertEqual(data["finding_id"], "finding-probe-002")

        reconstructed = FindingRecord.from_dict(data)
        self.assertEqual(reconstructed.finding_id, finding.finding_id)
        self.assertEqual(reconstructed.agent_role, finding.agent_role)
        self.assertEqual(reconstructed.claim, finding.claim)
        self.assertEqual(reconstructed.confidence, finding.confidence)
        self.assertEqual(reconstructed.evidence_refs, finding.evidence_refs)


class TestEvidenceStore(unittest.TestCase):
    """Tests for :class:`~core.store.EvidenceStore`."""

    def setUp(self) -> None:
        """Initialise a fresh EvidenceStore for each test."""
        self.store = EvidenceStore()

    def test_record_successful_tool_call(self) -> None:
        """Record successful tool call and retrieve it."""
        record = ToolCallRecord(
            call_id="call-success-1",
            agent_role="runtime",
            tool_name="get_pod_status",
            result={"phase": "Running"},
            status="success",
        )
        self.store.record_tool_call(record)
        calls = self.store.get_tool_calls()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].call_id, "call-success-1")
        self.assertEqual(calls[0].status, "success")
        self.assertIsNone(calls[0].error)

        fetched = self.store.get_tool_call("call-success-1")
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.call_id, "call-success-1")

    def test_record_failed_tool_call(self) -> None:
        """Record failed tool call with error details."""
        record = ToolCallRecord(
            call_id="call-fail-1",
            agent_role="runtime",
            tool_name="get_container_logs",
            error="Connection refused",
            result={"error": "Connection refused"},
            status="error",
        )
        self.store.record_tool_call(record)
        calls = self.store.get_tool_calls()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].status, "error")
        self.assertEqual(calls[0].error, "Connection refused")

    def test_record_timed_out_tool_call(self) -> None:
        """Record tool call that exceeded execution deadline."""
        record = ToolCallRecord(
            call_id="call-timeout-1",
            agent_role="runtime",
            tool_name="get_pod_events",
            error="Tool execution timed out after 10s",
            status="timed_out",
        )
        self.store.record_tool_call(record)
        calls = self.store.get_tool_calls()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].status, "timed_out")

    def test_record_tool_call_scrubs_arguments(self) -> None:
        """Recording a tool call must scrub sensitive argument keys."""
        record = ToolCallRecord(
            call_id="call-scrub-1",
            tool_name="custom_auth",
            arguments={"password": "raw", "safe": "ok"},
        )
        self.store.record_tool_call(record)
        calls = self.store.get_tool_calls()
        self.assertEqual(calls[0].arguments["password"], "[REDACTED_BY_KDM]")
        self.assertEqual(calls[0].arguments["safe"], "ok")

    def test_record_finding_success(self) -> None:
        """Recording a finding with valid evidence references succeeds."""
        finding = FindingRecord(
            finding_id="finding-oom-001",
            agent_role="runtime",
            claim="OOMKilled detected",
            confidence=0.95,
            evidence_refs=["call-4f9e12"],
        )
        self.store.record_finding(finding)
        self.assertEqual(len(self.store.get_findings()), 1)
        self.assertEqual(
            self.store.get_finding("finding-oom-001").claim,
            "OOMKilled detected",
        )

    def test_record_finding_without_evidence_refs_raises_value_error(self) -> None:
        """Findings cannot be recorded without referencing at least one evidence ID."""
        empty_finding = FindingRecord(
            finding_id="finding-invalid-1",
            agent_role="runtime",
            claim="Empty evidence refs",
            confidence=0.5,
            evidence_refs=[],
        )
        with self.assertRaises(ValueError):
            self.store.record_finding(empty_finding)

        blank_finding = FindingRecord(
            finding_id="finding-invalid-2",
            agent_role="runtime",
            claim="Blank evidence refs",
            confidence=0.5,
            evidence_refs=["   "],
        )
        with self.assertRaises(ValueError):
            self.store.record_finding(blank_finding)

    def test_get_provenance_success(self) -> None:
        """Provenance lookup returns finding and matching supporting tool calls."""
        call1 = ToolCallRecord(
            call_id="call-4f9e12",
            agent_role="runtime",
            tool_name="get_container_logs",
            arguments={"previous": True, "tail_lines": 50},
            duration_ms=142,
            status="success",
        )
        call2 = ToolCallRecord(
            call_id="call-other-88",
            agent_role="network",
            tool_name="get_pod_events",
            duration_ms=50,
            status="success",
        )
        self.store.record_tool_call(call1)
        self.store.record_tool_call(call2)

        finding = FindingRecord(
            finding_id="finding-oom-001",
            agent_role="runtime",
            claim="Container was killed by OOMKiller (exit code 137).",
            confidence=0.98,
            evidence_refs=["ev.pod.container.status", "call-4f9e12"],
        )
        self.store.record_finding(finding)

        provenance = self.store.get_provenance("finding-oom-001")
        self.assertIn("finding", provenance)
        self.assertEqual(provenance["finding"]["finding_id"], "finding-oom-001")
        self.assertEqual(provenance["finding"]["confidence"], 0.98)

        supporting = provenance["supporting_tool_calls"]
        self.assertEqual(len(supporting), 1)
        self.assertEqual(supporting[0]["call_id"], "call-4f9e12")
        self.assertEqual(supporting[0]["tool_name"], "get_container_logs")
        self.assertEqual(supporting[0]["status"], "success")

    def test_get_provenance_unknown_finding_returns_empty_dict(self) -> None:
        """Querying provenance for a non-existent finding returns empty dict."""
        self.assertEqual(self.store.get_provenance("non-existent-id"), {})

    def test_get_provenance_unreferenced_finding_returns_empty_list(self) -> None:
        """Finding referencing only non-tool evidence IDs returns empty supporting list."""
        finding = FindingRecord(
            finding_id="finding-static-001",
            agent_role="config",
            claim="Config map missing key",
            confidence=0.9,
            evidence_refs=["ev.configmap.status"],
        )
        self.store.record_finding(finding)

        provenance = self.store.get_provenance("finding-static-001")
        self.assertEqual(provenance["finding"]["finding_id"], "finding-static-001")
        self.assertEqual(provenance["supporting_tool_calls"], [])

    def test_export_audit_log_and_json(self) -> None:
        """Audit log exports all calls and is JSON-serializable."""
        call1 = ToolCallRecord(call_id="call-1", tool_name="tool_a", status="success")
        call2 = ToolCallRecord(call_id="call-2", tool_name="tool_b", status="error")
        self.store.record_tool_call(call1)
        self.store.record_tool_call(call2)

        log = self.store.export_audit_log()
        self.assertEqual(len(log), 2)
        self.assertEqual(log[0]["call_id"], "call-1")
        self.assertEqual(log[1]["call_id"], "call-2")

        # Serialisation to JSON must succeed
        json_str = self.store.export_audit_log_json(indent=2)
        parsed = json.loads(json_str)
        self.assertEqual(len(parsed), 2)

    def test_clear_resets_store(self) -> None:
        """clear() removes all tool calls and findings."""
        self.store.record_tool_call(ToolCallRecord(call_id="call-1"))
        self.store.record_finding(
            FindingRecord("f-1", "role", "claim", 1.0, ["call-1"])
        )
        self.store.clear()
        self.assertEqual(len(self.store.get_tool_calls()), 0)
        self.assertEqual(len(self.store.get_findings()), 0)

    def test_thread_safety(self) -> None:
        """Concurrent threads recording tool calls and findings do not race."""

        def worker(idx: int) -> None:
            call_id = f"call-thread-{idx}"
            self.store.record_tool_call(
                ToolCallRecord(
                    call_id=call_id, tool_name=f"tool_{idx}", status="success"
                )
            )
            self.store.record_finding(
                FindingRecord(
                    finding_id=f"finding-thread-{idx}",
                    agent_role="worker",
                    claim=f"Claim {idx}",
                    confidence=0.9,
                    evidence_refs=[call_id],
                )
            )

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(25)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(self.store.get_tool_calls()), 25)
        self.assertEqual(len(self.store.get_findings()), 25)


class TestToolRegistryIntegration(unittest.TestCase):
    """Tests for :class:`~tools.registry.ToolRegistry` execution and audit instrumentation."""

    def setUp(self) -> None:
        """Initialise a registry with an isolated EvidenceStore."""
        self.store = EvidenceStore()
        self.registry = ToolRegistry(store=self.store)

    def test_execute_records_tool_call_with_audit_id(self) -> None:
        """ToolRegistry.execute records invocation with generated call ID."""

        @self.registry.register("ping", "Health check")
        async def ping() -> Dict[str, Any]:
            return {"status": "pong"}

        result = _run_async(self.registry.execute("ping", agent_role="runtime"))
        self.assertEqual(result, {"status": "pong"})

        calls = self.store.get_tool_calls()
        self.assertEqual(len(calls), 1)
        record = calls[0]
        self.assertTrue(record.call_id.startswith("call-"))
        self.assertEqual(record.agent_role, "runtime")
        self.assertEqual(record.tool_name, "ping")
        self.assertEqual(record.status, "success")
        self.assertEqual(record.result, {"status": "pong"})
        self.assertIsNone(record.error)

    def test_execute_measures_wall_clock_duration(self) -> None:
        """Execution duration is measured in milliseconds."""

        @self.registry.register("sleep_tool", "Simulates network latency")
        async def sleep_tool() -> Dict[str, Any]:
            await asyncio.sleep(0.04)
            return {"done": True}

        _run_async(self.registry.execute("sleep_tool"))
        calls = self.store.get_tool_calls()
        self.assertEqual(len(calls), 1)
        self.assertGreaterEqual(calls[0].duration_ms, 30)

    def test_execute_scrubs_sensitive_arguments(self) -> None:
        """Arguments with password/token are scrubbed in the audit record."""
        received_args: Dict[str, Any] = {}

        @self.registry.register("auth_tool", "Authenticate with credentials")
        async def auth_tool(token: str, user: str) -> Dict[str, Any]:
            received_args["token"] = token
            received_args["user"] = user
            return {"authenticated": True}

        _run_async(
            self.registry.execute(
                "auth_tool",
                token="super_secret_token",
                user="admin",
            )
        )

        # Tool implementation must receive original credentials
        self.assertEqual(received_args["token"], "super_secret_token")
        self.assertEqual(received_args["user"], "admin")

        # Audit record must have token scrubbed
        calls = self.store.get_tool_calls()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].arguments["token"], "[REDACTED_BY_KDM]")
        self.assertEqual(calls[0].arguments["user"], "admin")

    def test_execute_catches_unhandled_tool_exception(self) -> None:
        """Unhandled tool exception sets status=error and returns clean error dict."""

        @self.registry.register("faulty_tool", "Always raises an error")
        async def faulty_tool() -> Dict[str, Any]:
            raise RuntimeError("Database connection dropped")

        result = _run_async(self.registry.execute("faulty_tool"))
        self.assertIn("error", result)
        self.assertEqual(result["error"], "Database connection dropped")

        calls = self.store.get_tool_calls()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].status, "error")
        self.assertEqual(calls[0].error, "Database connection dropped")

    def test_execute_re_raise_option(self) -> None:
        """When re_raise=True, unhandled exceptions are re-raised after recording."""

        @self.registry.register("crash_tool", "Crashes immediately")
        async def crash_tool() -> Dict[str, Any]:
            raise ValueError("Invalid configuration parameter")

        with self.assertRaises(ValueError):
            _run_async(self.registry.execute("crash_tool", re_raise=True))

        calls = self.store.get_tool_calls()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].status, "error")
        self.assertEqual(calls[0].error, "Invalid configuration parameter")

    def test_execute_custom_store_override(self) -> None:
        """Passing store to execute() records call to the specified store."""
        override_store = EvidenceStore()

        @self.registry.register("custom_ping", "Check ping")
        async def custom_ping() -> Dict[str, Any]:
            return {"ping": "ack"}

        _run_async(self.registry.execute("custom_ping", store=override_store))

        self.assertEqual(len(self.store.get_tool_calls()), 0)
        self.assertEqual(len(override_store.get_tool_calls()), 1)


if __name__ == "__main__":
    unittest.main()
