"""
KDM Core Evidence Layer
=======================
Provides the canonical, normalized evidence model that forms the single
source of truth for all specialist agents and deterministic rules.

Core Architectural Rule: KDM collects facts; agents reason over facts.
"""

from .context import AnalysisContext, AnalysisMetadata
from .evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target
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
    "Target",
    "ToolCallRecord",
    "redact_sensitive_data",
]
