"""
Evidence Store and Tool Audit Trail — KDM v4.0.0
=================================================
Provides an in-memory auditable storage layer for tool execution records
and diagnostic findings with millisecond timings and provenance tracking.

Core Architectural Rule: AI explainability is non-negotiable. Every finding
must link directly to concrete evidence IDs and tool call records that
justify the diagnosis.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import threading
import time
from typing import Any, Dict, List, Optional
import uuid

from .sanitizer import redact_sensitive_data


@dataclass
class ToolCallRecord:
    """Audit record capturing execution metadata for a single tool invocation.

    Attributes:
        call_id: Unique audit identifier in ``call-<hex8>`` format.
        agent_role: Specialist agent role initiating the call (e.g. ``"runtime"``).
        tool_name: Registered name of the tool invoked.
        arguments: Arguments passed to the tool, with sensitive keys scrubbed.
        result: Structured output returned by the tool.
        error: Error message string if the execution failed or timed out.
        started_at: Unix epoch timestamp when execution began.
        duration_ms: Wall-clock duration of the call in milliseconds.
        status: Execution outcome: ``"pending"``, ``"success"``, ``"error"``, or ``"timed_out"``.
    """

    call_id: str = field(default_factory=lambda: f"call-{uuid.uuid4().hex[:8]}")
    agent_role: str = ""
    tool_name: str = ""
    arguments: Dict[str, Any] = field(default_factory=dict)
    result: Any = None
    error: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    duration_ms: int = 0
    status: str = "pending"

    def __post_init__(self) -> None:
        """Ensure sensitive arguments are scrubbed upon creation."""
        if self.arguments:
            self.arguments = redact_sensitive_data(self.arguments)

    def to_dict(self) -> Dict[str, Any]:
        """Return a plain dictionary representation suitable for JSON serialisation."""
        return {
            "call_id": self.call_id,
            "agent_role": self.agent_role,
            "tool_name": self.tool_name,
            "arguments": dict(self.arguments),
            "result": self.result,
            "error": self.error,
            "started_at": self.started_at,
            "duration_ms": self.duration_ms,
            "status": self.status,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ToolCallRecord:
        """Reconstruct a :class:`ToolCallRecord` from a dictionary."""
        return cls(
            call_id=data.get("call_id", f"call-{uuid.uuid4().hex[:8]}"),
            agent_role=data.get("agent_role", ""),
            tool_name=data.get("tool_name", ""),
            arguments=data.get("arguments", {}),
            result=data.get("result"),
            error=data.get("error"),
            started_at=data.get("started_at", time.time()),
            duration_ms=data.get("duration_ms", 0),
            status=data.get("status", "pending"),
        )


@dataclass
class FindingRecord:
    """Diagnostic claim produced by an agent linked to supporting evidence.

    Attributes:
        finding_id: Unique finding identifier (e.g. ``"finding-oom-001"``).
        agent_role: Specialist agent role producing the finding.
        claim: Human-readable diagnostic statement.
        confidence: Numerical confidence score between 0.0 and 1.0.
        evidence_refs: Identifiers of supporting evidence items or tool calls.
    """

    finding_id: str
    agent_role: str
    claim: str
    confidence: float
    evidence_refs: List[str]

    def to_dict(self) -> Dict[str, Any]:
        """Return a plain dictionary representation suitable for JSON serialisation."""
        return {
            "finding_id": self.finding_id,
            "agent_role": self.agent_role,
            "claim": self.claim,
            "confidence": self.confidence,
            "evidence_refs": list(self.evidence_refs),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> FindingRecord:
        """Reconstruct a :class:`FindingRecord` from a dictionary."""
        return cls(
            finding_id=data["finding_id"],
            agent_role=data["agent_role"],
            claim=data["claim"],
            confidence=float(data["confidence"]),
            evidence_refs=list(data["evidence_refs"]),
        )


class EvidenceStore:
    """Thread-safe in-memory store for tool audit calls and diagnostic findings.

    Provides provenance tracking linking diagnostic claims to supporting
    tool calls and evidence references.
    """

    def __init__(self) -> None:
        """Initialise an empty in-memory store."""
        self._lock = threading.RLock()
        self._tool_calls: List[ToolCallRecord] = []
        self._findings: Dict[str, FindingRecord] = {}

    def record_tool_call(self, record: ToolCallRecord) -> None:
        """Record a tool call in the audit trail.

        Args:
            record: The :class:`ToolCallRecord` to append.
        """
        with self._lock:
            if record.arguments:
                record.arguments = redact_sensitive_data(record.arguments)
            self._tool_calls.append(record)

    def record_finding(self, finding: FindingRecord) -> None:
        """Record a diagnostic finding in the store.

        Findings cannot be recorded without referencing at least one evidence
        or tool call identifier.

        Args:
            finding: The :class:`FindingRecord` to store.

        Raises:
            ValueError: If ``evidence_refs`` is empty or contains only blank entries.
        """
        if not finding.evidence_refs or not any(
            str(ref).strip() for ref in finding.evidence_refs
        ):
            raise ValueError(
                f"Finding '{finding.finding_id}' cannot be recorded without "
                "referencing at least one evidence ID."
            )

        with self._lock:
            self._findings[finding.finding_id] = finding

    def get_provenance(self, finding_id: str) -> Dict[str, Any]:
        """Retrieve the historical facts and tool calls justifying a finding.

        Args:
            finding_id: Identifier of the finding to resolve.

        Returns:
            A dictionary containing the finding details and a list of
            supporting tool call records matching the finding's evidence refs,
            or an empty dictionary if the finding is not found.
        """
        with self._lock:
            finding = self._findings.get(finding_id)
            if not finding:
                return {}

            return {
                "finding": dict(finding.__dict__),
                "supporting_tool_calls": [
                    dict(c.__dict__)
                    for c in self._tool_calls
                    if c.call_id in finding.evidence_refs
                ],
            }

    def export_audit_log(self) -> List[Dict[str, Any]]:
        """Export all recorded tool calls as plain dictionaries.

        Returns:
            A list of dictionary representations of all tool call records.
        """
        with self._lock:
            return [dict(call.__dict__) for call in self._tool_calls]

    def export_audit_log_json(self, indent: Optional[int] = None) -> str:
        """Serialise the complete audit log to a JSON string.

        Args:
            indent: Optional indentation level for pretty printing.

        Returns:
            A JSON-formatted string of the audit log.
        """
        with self._lock:
            return json.dumps(self.export_audit_log(), indent=indent)

    def get_tool_calls(self) -> List[ToolCallRecord]:
        """Return a snapshot of all recorded tool calls."""
        with self._lock:
            return list(self._tool_calls)

    def get_tool_call(self, call_id: str) -> Optional[ToolCallRecord]:
        """Look up a specific tool call record by audit ID."""
        with self._lock:
            return next((c for c in self._tool_calls if c.call_id == call_id), None)

    def get_findings(self) -> List[FindingRecord]:
        """Return a snapshot of all recorded findings."""
        with self._lock:
            return list(self._findings.values())

    def get_finding(self, finding_id: str) -> Optional[FindingRecord]:
        """Look up a specific finding record by finding ID."""
        with self._lock:
            return self._findings.get(finding_id)

    def clear(self) -> None:
        """Clear all stored tool calls and findings."""
        with self._lock:
            self._tool_calls.clear()
            self._findings.clear()
