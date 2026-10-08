"""
Base Rule & RuleMatch — KDM v4.0.0
===================================
Defines the base interface for deterministic diagnostic rules and the
canonical :class:`RuleMatch` result object.

Deterministic rules evaluate observable facts in an :class:`EvidenceBundle`
in < 5ms before invoking any LLM turns.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
import os
import sys
from typing import Any, Dict, List, Optional

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import EvidenceBundle
except ImportError:
    from core.evidence import EvidenceBundle  # type: ignore[no-redef]


@dataclass
class RuleMatch:
    """Represents a conclusive diagnostic match produced by a deterministic rule.

    Attributes:
        rule_id: Stable identifier for the triggering rule (e.g. ``"rule.kubernetes.oom_killed"``).
        title: Human-readable diagnostic title.
        root_cause: Clear, fact-based root cause explanation.
        confidence: Certainty score between 0.0 and 1.0 (deterministic rules produce 1.0).
        evidence_ids: List of canonical evidence IDs backing this diagnosis.
    """

    rule_id: str
    title: str
    root_cause: str
    confidence: float
    evidence_ids: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        """Validate confidence bounds."""
        if not (0.0 <= float(self.confidence) <= 1.0):
            raise ValueError(
                f"confidence must be between 0.0 and 1.0, got {self.confidence}"
            )

    def to_dict(self) -> Dict[str, Any]:
        """Convert the rule match to a plain dictionary for JSON serialisation."""
        return {
            "rule_id": self.rule_id,
            "title": self.title,
            "root_cause": self.root_cause,
            "confidence": self.confidence,
            "evidence_ids": list(self.evidence_ids),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> RuleMatch:
        """Reconstruct a RuleMatch from its plain dictionary representation."""
        return cls(
            rule_id=data["rule_id"],
            title=data["title"],
            root_cause=data["root_cause"],
            confidence=float(data["confidence"]),
            evidence_ids=list(data.get("evidence_ids", [])),
        )


class BaseRule(ABC):
    """Abstract base class for deterministic diagnostic rules.

    All rules evaluate facts in an :class:`EvidenceBundle` synchronously
    without making network requests or invoking LLMs.
    """

    rule_id: str = ""
    title: str = ""

    def __repr__(self) -> str:
        """Return developer-friendly string representation of the rule."""
        return f"<{self.__class__.__name__} rule_id={self.rule_id!r}>"

    @abstractmethod
    def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
        """Evaluate observable facts in *bundle* against this rule's signature.

        Args:
            bundle: The canonical EvidenceBundle containing collected facts.

        Returns:
            A :class:`RuleMatch` if the signature is matched with certainty,
            otherwise ``None``.
        """
        pass
