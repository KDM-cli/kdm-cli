"""
ProbeFailure Rule — KDM v4.0.0
===============================
Deterministic diagnostic rule detecting container health probe failures
(liveness and readiness probe failures).
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List, Optional, Tuple

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import CollectionStatus, EvidenceBundle
    from agents.rules.base import BaseRule, RuleMatch
except ImportError:
    from core.evidence import CollectionStatus, EvidenceBundle  # type: ignore[no-redef]
    from rules.base import BaseRule, RuleMatch  # type: ignore[no-redef]


class ProbeFailureRule(BaseRule):
    """Diagnoses container health check failures from Kubernetes events.

    Triggers when warning events report ``"Liveness probe failed"`` or
    ``"Readiness probe failed"``.
    """

    rule_id: str = "rule.kubernetes.probe_failure"
    title: str = "Container Probe Failure"

    def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
        """Inspect ``ev.pod.events`` for probe failure messages."""
        events_data = self._get_events_data(bundle)
        if not events_data:
            return None

        match_info = self._detect_probe_failure(events_data)
        if not match_info:
            return None

        return self._build_match(match_info, bundle)

    @staticmethod
    def _get_events_data(bundle: Optional[EvidenceBundle]) -> Optional[Any]:
        """Extract valid events data from the bundle."""
        if not bundle or not hasattr(bundle, "get"):
            return None
        events_item = bundle.get("ev.pod.events")
        if not events_item or events_item.status != CollectionStatus.AVAILABLE:
            return None
        return events_item.data

    def _build_match(
        self, match_info: Tuple[str, str], bundle: EvidenceBundle
    ) -> RuleMatch:
        """Construct the RuleMatch object from extracted probe failure facts."""
        probe_type, message = match_info
        c_label = (
            (bundle.target.container_name if bundle.target and bundle.target.container_name else None)
            or (bundle.target.workload_name if bundle.target else None)
            or "container"
        )
        return RuleMatch(
            rule_id=self.rule_id,
            title=f"Container {probe_type} Probe Failure",
            root_cause=f"Container '{c_label}' {probe_type.lower()} probe failed: {message}",
            confidence=1.0,
            evidence_ids=["ev.pod.events"],
        )

    def _detect_probe_failure(self, data: Any) -> Optional[Tuple[str, str]]:
        """Extract probe failure facts from events data structure."""
        events = self._extract_event_list(data)
        for event in events:
            if not isinstance(event, dict):
                continue

            match = self._check_event_probe(event)
            if match:
                return match

        return None

    @staticmethod
    def _check_event_probe(event: Dict[str, Any]) -> Optional[Tuple[str, str]]:
        """Inspect a single event dictionary for probe failure signatures."""
        message = str(event.get("message", ""))
        msg_lower = message.lower()

        if "liveness probe failed" in msg_lower:
            return ("Liveness", message)
        if "readiness probe failed" in msg_lower:
            return ("Readiness", message)
        if "startup probe failed" in msg_lower:
            return ("Startup", message)

        return None

    @staticmethod
    def _extract_event_list(data: Any) -> List[Dict[str, Any]]:
        """Normalize events data into a list of event dictionaries."""
        if isinstance(data, list):
            return [e for e in data if isinstance(e, dict)]
        if isinstance(data, dict):
            if "items" in data and isinstance(data["items"], list):
                return [e for e in data["items"] if isinstance(e, dict)]
            return [data]
        return []
