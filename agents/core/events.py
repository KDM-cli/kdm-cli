"""
NDJSON Streaming Event Protocol — Python Emission Layer
========================================================
Provides a single ``emit_event`` helper that serialises each event as a
one-line JSON object, writes it to ``sys.stdout`` and **immediately**
flushes to avoid OS-level line-buffering latency.

All non-protocol diagnostics (logs, warnings, tracebacks) MUST go to
``sys.stderr`` exclusively so the Node.js consumer only receives clean
NDJSON on ``stdout``.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any


VALID_AGENT_ROLES: frozenset[str] = frozenset(
    {"runtime", "config", "resource", "synthesizer"}
)

REQUIRED_CONSENSUS_KEYS: frozenset[str] = frozenset(
    {"rootCause", "confidence", "findings", "bestSolution"}
)


def _utc_iso() -> str:
    """Return the current UTC time as an ISO-8601 string with 'Z' suffix."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def emit_event(event_name: str, **kwargs: Any) -> None:
    """Emit a single NDJSON event line to ``sys.stdout`` and flush.

    The output is a single-line JSON object with at minimum an ``event``
    key and a ``timestamp`` key. Additional keyword arguments are merged
    into the payload, but cannot overwrite the protocol fields.

    Args:
        event_name: The event discriminator (e.g. ``"analysis_start"``).
        **kwargs: Arbitrary key/value pairs to include in the payload.
    """
    payload: dict[str, Any] = {
        **kwargs,
        "event": event_name,
        "timestamp": _utc_iso(),
    }
    line = json.dumps(payload, separators=(",", ":"))
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def emit_analysis_start(analysis_id: str) -> None:
    """Emit an ``analysis_start`` event.

    Args:
        analysis_id: Unique identifier for this analysis run.
    """
    emit_event("analysis_start", analysisId=analysis_id)


def emit_evidence_collected(count: int, ids: list[str]) -> None:
    """Emit an ``evidence_collected`` event.

    Args:
        count: Number of evidence items collected.
        ids: List of canonical evidence identifiers.
    """
    emit_event("evidence_collected", count=count, ids=ids)


def emit_agent_start(role: str, message: str) -> None:
    """Emit an ``agent_start`` event.

    Args:
        role: Agent role (must be one of ``"runtime"``, ``"config"``,
            ``"resource"``, or ``"synthesizer"``).
        message: Human-readable startup message.

    Raises:
        ValueError: If *role* is not one of the valid agent roles.
    """
    if role not in VALID_AGENT_ROLES:
        raise ValueError(
            f"Invalid agent role: {role!r}. Must be one of {sorted(VALID_AGENT_ROLES)}"
        )
    emit_event("agent_start", role=role, message=message)


def emit_agent_tool_call(role: str, tool: str, args: dict[str, Any]) -> None:
    """Emit an ``agent_tool_call`` event.

    Args:
        role: Agent role invoking the tool.
        tool: Name of the tool being called.
        args: Arguments passed to the tool.
    """
    emit_event("agent_tool_call", role=role, tool=tool, args=args)


def emit_agent_tool_result(role: str, tool: str, duration_ms: int) -> None:
    """Emit an ``agent_tool_result`` event.

    Args:
        role: Agent role that invoked the tool.
        tool: Name of the tool that completed.
        duration_ms: Elapsed time in milliseconds.
    """
    emit_event("agent_tool_result", role=role, tool=tool, durationMs=duration_ms)


def emit_agent_progress(role: str, message: str) -> None:
    """Emit an ``agent_progress`` event.

    Args:
        role: Agent role providing the progress update.
        message: Human-readable progress message.
    """
    emit_event("agent_progress", role=role, message=message)


def emit_agent_complete(role: str, summary: str) -> None:
    """Emit an ``agent_complete`` event.

    Args:
        role: Agent role that has completed.
        summary: Brief summary of the agent's findings.
    """
    emit_event("agent_complete", role=role, summary=summary)


def emit_agent_failed(role: str, error: str) -> None:
    """Emit an ``agent_failed`` event.

    Args:
        role: Agent role that has failed.
        error: Error message describing the failure.
    """
    emit_event("agent_failed", role=role, error=error)


def emit_diagnosis_ready(consensus: Any) -> None:
    """Emit a ``diagnosis_ready`` event.

    Args:
        consensus: The full consensus diagnosis payload or object with ``to_dict()``.

    Raises:
        TypeError: If *consensus* is not a dict and lacks a ``to_dict()`` method.
        ValueError: If required keys (rootCause, confidence, findings, bestSolution)
            are missing from the consensus payload.
    """
    payload = consensus.to_dict() if hasattr(consensus, "to_dict") else consensus
    if not isinstance(payload, dict):
        raise TypeError(
            f"consensus must be a dict or provide to_dict(), got {type(payload).__name__}"
        )
    missing = REQUIRED_CONSENSUS_KEYS - payload.keys()
    if missing:
        raise ValueError(
            f"consensus payload is missing required keys: {sorted(missing)}"
        )
    emit_event("diagnosis_ready", consensus=payload)


def emit_error(message: str, *, fatal: bool = False) -> None:
    """Emit a protocol-level ``error`` event.

    Args:
        message: Error description.
        fatal: Whether the error is unrecoverable.
    """
    emit_event("error", message=message, fatal=fatal)


def emit_rule_matched(rule_id: str, title: str) -> None:
    """Emit a ``rule_matched`` event.

    Args:
        rule_id: Canonical rule identifier.
        title: Human-readable title of the matched rule.
    """
    emit_event("rule_matched", ruleId=rule_id, title=title)
