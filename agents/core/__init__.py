"""
KDM Core Evidence Layer
=======================
Provides the canonical, normalized evidence model that forms the single
source of truth for all specialist agents and deterministic rules.

Core Architectural Rule: KDM collects facts; agents reason over facts.
"""

from .evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target
from .context import AnalysisContext, AnalysisMetadata
from .sanitizer import redact_sensitive_data

__all__ = [
    "CollectionStatus",
    "EvidenceBundle",
    "EvidenceItem",
    "Target",
    "AnalysisContext",
    "AnalysisMetadata",
    "redact_sensitive_data",
]
