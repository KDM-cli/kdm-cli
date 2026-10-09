"""
Specialist Agents Package — KDM v4.0.0
=======================================
Structured, domain-specialized SRE agents leveraging Ollama JSON mode:
- BaseSpecialistAgent: Abstract base class enforcing strict JSON schema and recovery.
- RuntimeLogAgent: Senior Linux & container runtime diagnostics specialist.
- ConfigDependencyAgent: Kubernetes declarative configuration specialist.
- ClusterResourceAgent: Cluster capacity & Linux cgroups specialist.
"""

from __future__ import annotations

import os
import sys

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.specialists.base import BaseSpecialistAgent
    from agents.specialists.config import ConfigDependencyAgent
    from agents.specialists.resource import ClusterResourceAgent
    from agents.specialists.runtime import RuntimeLogAgent
except ImportError:
    from specialists.base import BaseSpecialistAgent  # type: ignore[no-redef]
    from specialists.config import ConfigDependencyAgent  # type: ignore[no-redef]
    from specialists.resource import ClusterResourceAgent  # type: ignore[no-redef]
    from specialists.runtime import RuntimeLogAgent  # type: ignore[no-redef]

__all__ = [
    "BaseSpecialistAgent",
    "ClusterResourceAgent",
    "ConfigDependencyAgent",
    "RuntimeLogAgent",
]

# Legacy compatibility helper for council.py until Phase 6
try:
    import importlib.util

    _legacy_path = os.path.join(_AGENTS_DIR, "specialists.py")
    if os.path.isfile(_legacy_path):
        _spec = importlib.util.spec_from_file_location(
            "_legacy_specialists", _legacy_path
        )
        if _spec and _spec.loader:
            _mod = importlib.util.module_from_spec(_spec)
            _spec.loader.exec_module(_mod)
            _synth = getattr(_mod, "SynthesizerAgent", None)
            if _synth is not None:
                globals()["SynthesizerAgent"] = _synth
                __all__.append("SynthesizerAgent")
except Exception:
    pass
