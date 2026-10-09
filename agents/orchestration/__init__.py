"""
Orchestration Package — KDM v4.0.0
===================================
Provides parallel specialist agent execution, concurrency semaphores,
per-agent timeouts, and failure isolation across multi-agent investigations.
"""

from __future__ import annotations

import os
import sys

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.orchestration.orchestrator import AgentOrchestrator
except ImportError:
    from orchestration.orchestrator import AgentOrchestrator  # type: ignore[no-redef]

__all__ = ["AgentOrchestrator"]
