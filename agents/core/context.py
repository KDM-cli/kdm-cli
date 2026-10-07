"""
Analysis Context for KDM v4.0.0
=================================
Wraps an :class:`~core.evidence.EvidenceBundle` together with session-level
metadata so that specialist agents always have a consistent, self-describing
handle to the current analysis run.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from .evidence import EvidenceBundle, Target


@dataclass
class AnalysisMetadata:
    """Static metadata about the KDM session that produced the evidence.

    This information is surfaced in agent prompts and in serialised output so
    that diagnostics can always be tied back to the exact tool version and
    model that performed the analysis.
    """

    cli_version: str
    """Semver string of the KDM CLI that ran this analysis (e.g. ``"4.0.0"``)."""

    backend: str
    """LLM backend in use (e.g. ``"ollama"``, ``"openai"``)."""

    model: str
    """Model identifier used for specialist agents (e.g. ``"llama3.1"``)."""

    started_at: str
    """ISO 8601 UTC timestamp of when the analysis session started."""

    def to_dict(self) -> Dict[str, Any]:
        """Return a plain-dict representation suitable for JSON serialisation."""
        return {
            "cli_version": self.cli_version,
            "backend": self.backend,
            "model": self.model,
            "started_at": self.started_at,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AnalysisMetadata":
        """Reconstruct :class:`AnalysisMetadata` from its plain-dict representation."""
        return cls(
            cli_version=data["cli_version"],
            backend=data["backend"],
            model=data["model"],
            started_at=data["started_at"],
        )

    @classmethod
    def create(
        cls,
        cli_version: str,
        backend: str,
        model: str,
        started_at: Optional[str] = None,
    ) -> "AnalysisMetadata":
        """Convenience factory that auto-fills *started_at* when omitted."""
        ts = started_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return cls(cli_version=cli_version, backend=backend, model=model, started_at=ts)


@dataclass
class AnalysisContext:
    """Top-level handle for a KDM analysis run.

    An :class:`AnalysisContext` is the single object passed to every
    specialist agent and deterministic rule.  It combines:

    * A unique run identifier (UUID) for correlation in logs.
    * The :class:`~core.evidence.Target` workload descriptor.
    * The fully populated :class:`~core.evidence.EvidenceBundle`.
    * Session :class:`AnalysisMetadata` (CLI version, model, etc.).
    """

    analysis_id: str
    """UUID identifying this unique analysis run."""

    target: Target
    """The workload under investigation — mirrors ``evidence.target``."""

    evidence: EvidenceBundle
    """All collected facts about the target workload."""

    metadata: AnalysisMetadata
    """Session-level metadata about the tool and model in use."""

    def __post_init__(self) -> None:
        """Validate that target matches evidence.target."""
        if self.target != self.evidence.target:
            raise ValueError("AnalysisContext.target must match evidence.target")

    @classmethod
    def create(
        cls,
        target: Target,
        evidence: EvidenceBundle,
        metadata: AnalysisMetadata,
        analysis_id: Optional[str] = None,
    ) -> "AnalysisContext":
        """Convenience factory that generates a UUID when *analysis_id* is omitted.

        Args:
            target: The workload under investigation.
            evidence: Pre-populated :class:`EvidenceBundle`.
            metadata: :class:`AnalysisMetadata` for the current session.
            analysis_id: Optional explicit UUID string; auto-generated if absent.

        Returns:
            A ready-to-use :class:`AnalysisContext`.
        """
        run_id = analysis_id or str(uuid.uuid4())
        return cls(
            analysis_id=run_id,
            target=target,
            evidence=evidence,
            metadata=metadata,
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialise the context to a plain dictionary.

        Returns:
            A JSON-safe dictionary representing the full analysis context.
        """
        return {
            "analysis_id": self.analysis_id,
            "target": self.target.to_dict(),
            "evidence": self.evidence.to_dict(),
            "metadata": self.metadata.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AnalysisContext":
        """Reconstruct an :class:`AnalysisContext` from its plain-dict representation.

        Args:
            data: A dictionary previously produced by :meth:`to_dict`.

        Returns:
            A fully populated :class:`AnalysisContext`.
        """
        evidence = EvidenceBundle.from_dict(data["evidence"])
        return cls(
            analysis_id=data["analysis_id"],
            target=Target.from_dict(data["target"]),
            evidence=evidence,
            metadata=AnalysisMetadata.from_dict(data["metadata"]),
        )
