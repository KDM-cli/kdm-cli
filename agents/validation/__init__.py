"""
Multi-Agent Validation Package — KDM v4.0.0
===========================================
Provides the Cross-Agent Validator and Disagreement Resolution engine
for detecting hallucinations, false positives, and factual contradictions
between proposed hypotheses and collected evidence.
"""

from __future__ import annotations

import os
import sys

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.validation.validator import CrossAgentValidator, ValidationResult
except ImportError:
    from validation.validator import CrossAgentValidator, ValidationResult  # type: ignore[no-redef]

__all__ = ["CrossAgentValidator", "ValidationResult"]
