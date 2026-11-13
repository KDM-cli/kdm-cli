"""
KDM Multi-Agent Collaborative Analysis System — v4.0.0
======================================================
"""

from __future__ import annotations

import os
import sys

_AGENTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

from council import AgentCouncil, resolve_model, run_council  # noqa: E402

__all__ = [
    "AgentCouncil",
    "resolve_model",
    "run_council",
]
