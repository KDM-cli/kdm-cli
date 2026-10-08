"""
Rule Engine Dispatcher — KDM v4.0.0
====================================
Evaluates deterministic failure rules against an :class:`EvidenceBundle`
in < 5ms before invoking any LLM turns.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import List, Optional

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import EvidenceBundle
    from agents.rules.base import BaseRule, RuleMatch
    from agents.rules.crashloop import CrashLoopRule
    from agents.rules.image_pull import ImagePullRule
    from agents.rules.oom import OOMKilledRule
    from agents.rules.probes import ProbeFailureRule
    from agents.rules.scheduling import SchedulingRule
except ImportError:
    from core.evidence import EvidenceBundle  # type: ignore[no-redef]
    from rules.base import BaseRule, RuleMatch  # type: ignore[no-redef]
    from rules.crashloop import CrashLoopRule  # type: ignore[no-redef]
    from rules.image_pull import ImagePullRule  # type: ignore[no-redef]
    from rules.oom import OOMKilledRule  # type: ignore[no-redef]
    from rules.probes import ProbeFailureRule  # type: ignore[no-redef]
    from rules.scheduling import SchedulingRule  # type: ignore[no-redef]

logger = logging.getLogger(__name__)


class RuleEngine:
    """Dispatcher engine that evaluates deterministic failure rules against an EvidenceBundle.

    Executes in < 5ms before invoking any LLM. When a rule matches with
    confidence >= 0.99, the diagnosis is conclusive and LLM reasoning can be bypassed.
    """

    def __init__(self, rules: Optional[List[BaseRule]] = None) -> None:
        """Initialize RuleEngine with an optional list of rules.

        If *rules* is None, defaults to the canonical Kubernetes failure rules:
        - :class:`OOMKilledRule`
        - :class:`ImagePullRule`
        - :class:`CrashLoopRule`
        - :class:`ProbeFailureRule`
        - :class:`SchedulingRule`
        """
        if rules is None:
            self._rules: List[BaseRule] = [
                OOMKilledRule(),
                ImagePullRule(),
                CrashLoopRule(),
                ProbeFailureRule(),
                SchedulingRule(),
            ]
        else:
            self._rules = list(rules)

    @property
    def rules(self) -> List[BaseRule]:
        """Return a copy of registered active rules."""
        return list(self._rules)

    def register(self, rule: BaseRule) -> None:
        """Register an additional rule with the engine.

        Args:
            rule: A :class:`BaseRule` instance.
        """
        self._rules.append(rule)

    def evaluate_all(self, bundle: EvidenceBundle) -> List[RuleMatch]:
        """Evaluate all active rules against the provided evidence bundle.

        Args:
            bundle: Canonical EvidenceBundle containing collected facts.

        Returns:
            List of :class:`RuleMatch` objects sorted by confidence descending.
            Returns an empty list if no rules match or if the bundle is invalid.
        """
        if bundle is None:
            return []

        matches: List[RuleMatch] = []
        for rule in self._rules:
            try:
                match = rule.evaluate(bundle)
                if match is not None:
                    matches.append(match)
            except Exception:
                logger.exception(
                    "Rule '%s' raised an unexpected exception during evaluation",
                    getattr(rule, "rule_id", "unknown"),
                )
                continue

        # Prioritize highest certainty matches first
        matches.sort(key=lambda m: m.confidence, reverse=True)
        return matches

    def get_primary_match(
        self, bundle: EvidenceBundle, min_confidence: float = 0.0
    ) -> Optional[RuleMatch]:
        """Return the highest confidence rule match, or None if no rule matches.

        Args:
            bundle: The EvidenceBundle to evaluate.
            min_confidence: Minimum confidence threshold required (default 0.0).

        Returns:
            The highest-confidence :class:`RuleMatch` if confidence >= min_confidence,
            otherwise ``None``.
        """
        matches = self.evaluate_all(bundle)
        if matches and matches[0].confidence >= min_confidence:
            return matches[0]
        return None

    def should_bypass_llm(self, match: Optional[RuleMatch]) -> bool:
        """Determine if a rule match has sufficient confidence to bypass LLM turns.

        Args:
            match: The optional candidate RuleMatch.

        Returns:
            ``True`` if *match* is present and has confidence >= 0.99, else ``False``.
        """
        return match is not None and match.confidence >= 0.99
