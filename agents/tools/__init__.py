"""
KDM Safe Typed Tool Layer — v4.0.0
====================================
Exposes a least-privilege, read-only tool registry and concrete tool
implementations for Kubernetes and Docker inspection.

Agents call :func:`~tools.registry.ToolRegistry.execute` to obtain
structured JSON dictionaries without direct shell access.
"""

from .registry import ToolRegistry, tool_registry

__all__ = [
    "ToolRegistry",
    "tool_registry",
]
