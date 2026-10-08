"""
Scheduling Rule — KDM v4.0.0
=============================
Deterministic diagnostic rule detecting Kubernetes pod scheduling failures
(FailedScheduling).
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


class SchedulingRule(BaseRule):
    """Diagnoses pod scheduling failures where pods remain stuck in Pending.

    Triggers when a pod is in phase ``"Pending"`` (or pending status)
    and events report ``FailedScheduling`` (e.g. insufficient CPU or memory).
    """

    rule_id: str = "rule.kubernetes.failed_scheduling"
    title: str = "Pod Scheduling Failure (FailedScheduling)"

    def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
        """Inspect pod phase Pending and events for FailedScheduling.

        Args:
            bundle: Canonical EvidenceBundle containing collected facts.

        Returns:
            :class:`RuleMatch` with 1.0 confidence if scheduling failure detected, else ``None``.
        """
        if not bundle or not hasattr(bundle, "get"):
            return None

        events_item = bundle.get("ev.pod.events")
        if not events_item or events_item.status != CollectionStatus.AVAILABLE:
            return None
        if not events_item.data:
            return None

        scheduling_event = self._find_scheduling_event(events_item.data)
        if not scheduling_event:
            return None

        # Inspect pod phase across potential evidence items
        phase, phase_evidence_id = self._inspect_pod_phase(bundle)
        # If pod phase is definitively not Pending (e.g. Running, Succeeded), do not match
        if phase is not None and phase != "Pending":
            return None

        evidence_ids = ["ev.pod.events"]
        if phase_evidence_id and phase_evidence_id not in evidence_ids:
            evidence_ids.insert(0, phase_evidence_id)

        workload = (
            (bundle.target.workload_name if bundle.target else None)
            or (bundle.target.container_name if bundle.target else None)
            or "pod"
        )
        root_cause = (
            f"Pod '{workload}' cannot be scheduled (FailedScheduling): {scheduling_event}"
        )

        return RuleMatch(
            rule_id=self.rule_id,
            title=self.title,
            root_cause=root_cause,
            confidence=1.0,
            evidence_ids=evidence_ids,
        )

    def _find_scheduling_event(self, data: Any) -> Optional[str]:
        """Find the message of a FailedScheduling event if present."""
        events = self._extract_event_list(data)
        for event in events:
            if not isinstance(event, dict):
                continue
            reason = str(event.get("reason", ""))
            message = str(event.get("message", ""))
            if reason == "FailedScheduling":
                return message or reason
            if "failedscheduling" in reason.lower() or "failedscheduling" in message.lower():
                return message or reason
            if "0/" in message and ("nodes are available" in message or "node(s) available" in message):
                return message
        return None

    @staticmethod
    def _inspect_pod_phase(bundle: EvidenceBundle) -> Tuple[Optional[str], Optional[str]]:
        """Look for pod phase in known evidence sources (e.g. ev.pod.status, ev.pod.container.status)."""
        for eid in ("ev.pod.status", "ev.pod.phase", "ev.pod.container.status"):
            item = bundle.get(eid)
            if item and item.status == CollectionStatus.AVAILABLE and item.data:
                if isinstance(item.data, dict) and "phase" in item.data:
                    return (str(item.data["phase"]), eid)
                if isinstance(item.data, str) and item.data in (
                    "Pending",
                    "Running",
                    "Failed",
                    "Succeeded",
                    "Unknown",
                ):
                    return (item.data, eid)
        return (None, None)

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
