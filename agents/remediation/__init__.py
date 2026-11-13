"""
Automated Remediation Package — KDM v4.0.0
==========================================
Provides structured remediation planning that transforms verified multi-agent
consensus diagnoses into discrete, auditable remediation patches with
exact kubectl rollback instructions.
"""

from __future__ import annotations

import os
import sys

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.remediation.planner import (
        PlanContext,
        RemediationPlanner,
        WorkloadTargetInfo,
        calculate_memory_bump,
        extract_workload_info,
        generate_rollback_command,
    )
    from agents.remediation.policy import (
        ALLOWED_COMMAND_PREFIXES,
        BLOCKED_PATTERNS,
        PolicyEngine,
    )
    from agents.remediation.types import (
        RemediationPlan,
        RemediationStep,
        normalize_risk_level,
    )
    from agents.remediation.verifier import (
        CRASH_REGRESSION_REASONS,
        PodStatusFacts,
        WorkloadVerifier,
        format_verification_result,
    )
except ImportError:
    from .planner import (  # type: ignore[no-redef]
        PlanContext,
        RemediationPlanner,
        WorkloadTargetInfo,
        calculate_memory_bump,
        extract_workload_info,
        generate_rollback_command,
    )
    from .policy import (  # type: ignore[no-redef]
        ALLOWED_COMMAND_PREFIXES,
        BLOCKED_PATTERNS,
        PolicyEngine,
    )
    from .types import (  # type: ignore[no-redef]
        RemediationPlan,
        RemediationStep,
        normalize_risk_level,
    )
    from .verifier import (  # type: ignore[no-redef]
        CRASH_REGRESSION_REASONS,
        PodStatusFacts,
        WorkloadVerifier,
        format_verification_result,
    )

__all__ = [
    "ALLOWED_COMMAND_PREFIXES",
    "BLOCKED_PATTERNS",
    "CRASH_REGRESSION_REASONS",
    "PlanContext",
    "PodStatusFacts",
    "PolicyEngine",
    "RemediationPlan",
    "RemediationPlanner",
    "RemediationStep",
    "WorkloadVerifier",
    "WorkloadTargetInfo",
    "calculate_memory_bump",
    "extract_workload_info",
    "format_verification_result",
    "generate_rollback_command",
    "normalize_risk_level",
]

