"""
Deterministic Diagnostic Rule Engine — KDM v4.0.0
===================================================
Provides deterministic rules for diagnosing well-known Kubernetes and Docker
failure signatures in < 5ms before invoking any LLM turns.

Part of Milestone v4.0.0 — Phase 4 of the Multi-Agent SRE Architecture.
"""

from .base import BaseRule, RuleMatch
from .crashloop import CrashLoopRule
from .engine import RuleEngine
from .image_pull import ImagePullRule
from .oom import OOMKilledRule
from .probes import ProbeFailureRule
from .scheduling import SchedulingRule

__all__ = [
    "BaseRule",
    "CrashLoopRule",
    "ImagePullRule",
    "OOMKilledRule",
    "ProbeFailureRule",
    "RuleEngine",
    "RuleMatch",
    "SchedulingRule",
]
