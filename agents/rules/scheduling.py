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

    Triggers when a pod is in phase ``"Pending"`` (or unassigned phase)
    and events report ``FailedScheduling`` (e.g. insufficient CPU or memory).
    """

    rule_id: str = "rule.kubernetes.failed_scheduling"
    title: str = "Pod Scheduling Failure (FailedScheduling)"

    def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
        """Inspect pod phase Pending and events for FailedScheduling."""
        events_data = self._get_events_data(bundle)
        if not events_data:
            return None

        scheduling_event = self._find_scheduling_event(events_data)
        if not scheduling_event:
            return None

        phase, phase_eid = self._inspect_pod_phase(bundle)
        if phase is not None and phase != "Pending":
            return None

        return self._build_match(scheduling_event, phase_eid, bundle)

    @staticmethod
    def _get_events_data(bundle: Optional[EvidenceBundle]) -> Optional[Any]:
        """Extract valid events data from the bundle."""
        if bundle is None or not hasattr(bundle, "get"):
            return None
        events_item = bundle.get("ev.pod.events")
        if events_item is None or events_item.status != CollectionStatus.AVAILABLE:
            return None
        return events_item.data

    def _build_match(
        self,
        scheduling_event: str,
        phase_evidence_id: Optional[str],
        bundle: EvidenceBundle,
    ) -> RuleMatch:
        """Construct the RuleMatch object for a verified scheduling failure."""
        evidence_ids = ["ev.pod.events"]
        if phase_evidence_id and phase_evidence_id not in evidence_ids:
            evidence_ids.insert(0, phase_evidence_id)

        workload = (
            (bundle.target.workload_name if bundle.target else None)
            or (bundle.target.container_name if bundle.target else None)
            or "pod"
        )
        return RuleMatch(
            rule_id=self.rule_id,
            title=self.title,
            root_cause=f"Pod '{workload}' cannot be scheduled (FailedScheduling): {scheduling_event}",
            confidence=1.0,
            evidence_ids=evidence_ids,
        )

    def _find_scheduling_event(self, data: Any) -> Optional[str]:
        """Find the message of a FailedScheduling event if present."""
        for event in self._extract_event_list(data):
            if isinstance(event, dict):
                match = self._is_scheduling_event(event)
                if match:
                    return match
        return None

    @classmethod
    def _is_scheduling_event(cls, event: Dict[str, Any]) -> Optional[str]:
        """Check if a single event represents a FailedScheduling failure."""
        reason = str(event.get("reason", ""))
        message = str(event.get("message", ""))
        if cls._reason_matches(reason):
            return message or reason
        if cls._message_matches(message):
            return message
        return None

    @staticmethod
    def _reason_matches(reason: str) -> bool:
        """Check if event reason indicates scheduling failure."""
        if reason == "FailedScheduling":
            return True
        return "failedscheduling" in reason.lower()

    @staticmethod
    def _message_matches(message: str) -> bool:
        """Check if event message indicates scheduling failure."""
        if "failedscheduling" in message.lower():
            return True
        if "0/" in message:
            if "nodes are available" in message:
                return True
            if "node(s) available" in message:
                return True
        return False

    @classmethod
    def _inspect_pod_phase(cls, bundle: Optional[EvidenceBundle]) -> Tuple[Optional[str], Optional[str]]:
        """Look for pod phase strictly in ev.pod.status or ev.pod.phase."""
        if bundle is None or not hasattr(bundle, "get"):
            return (None, None)

        for eid in ("ev.pod.status", "ev.pod.phase"):
            phase = cls._get_phase_from_id(bundle, eid)
            if phase is not None:
                return (phase, eid)

        return (None, None)

    @classmethod
    def _get_phase_from_id(cls, bundle: EvidenceBundle, eid: str) -> Optional[str]:
        """Retrieve the pod phase string from a specific evidence id."""
        item = bundle.get(eid)
        if item is None or item.status != CollectionStatus.AVAILABLE:
            return None
        return cls._extract_phase_string(item.data)

    @staticmethod
    def _extract_phase_string(data: Any) -> Optional[str]:
        """Extract phase string from data payload."""
        if isinstance(data, dict):
            phase = data.get("phase")
            if phase:
                return str(phase)
        if isinstance(data, str):
            return data
        return None

    @staticmethod
    def _extract_event_list(data: Any) -> List[Dict[str, Any]]:
        """Normalize events data into a list of event dictionaries."""
        if isinstance(data, list):
            return [e for e in data if isinstance(e, dict)]
        if isinstance(data, dict):
            items = data.get("items")
            if isinstance(items, list):
                return [e for e in items if isinstance(e, dict)]
            return [data]
        return []
