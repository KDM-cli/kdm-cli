"""
KDM Core Evidence Layer
=======================
Provides the canonical, normalized evidence model that forms the single
source of truth for all specialist agents and deterministic rules.

Core Architectural Rule: KDM collects facts; agents reason over facts.
"""

from .context import AnalysisContext, AnalysisMetadata
from .evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target
from .events import (
    REQUIRED_CONSENSUS_KEYS,
    VALID_AGENT_ROLES,
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
from .sanitizer import redact_sensitive_data
from .store import EvidenceStore, FindingRecord, ToolCallRecord

__all__ = [
    "AnalysisContext",
    "AnalysisMetadata",
    "CollectionStatus",
    "EvidenceBundle",
    "EvidenceItem",
    "EvidenceStore",
    "FindingRecord",
    "REQUIRED_CONSENSUS_KEYS",
    "Target",
    "ToolCallRecord",
    "VALID_AGENT_ROLES",
    "emit_agent_complete",
    "emit_agent_failed",
    "emit_agent_progress",
    "emit_agent_start",
    "emit_agent_tool_call",
    "emit_agent_tool_result",
    "emit_analysis_start",
    "emit_diagnosis_ready",
    "emit_error",
    "emit_event",
    "emit_evidence_collected",
    "emit_rule_matched",
    "redact_sensitive_data",
]

