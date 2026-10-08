"""
OOMKilled Rule — KDM v4.0.0
============================
Deterministic diagnostic rule detecting Kubernetes Out-Of-Memory (OOMKilled)
container terminations.
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


class OOMKilledRule(BaseRule):
    """Diagnoses container terminations caused by exceeding memory limits.

    Triggers when a container's termination state reports reason ``"OOMKilled"``
    (1.0 confidence) or exit code 137 (0.8 confidence for unconfirmed SIGKILL).
    """

    rule_id: str = "rule.kubernetes.oom_killed"
    title: str = "Container Out-Of-Memory (OOMKilled)"

    def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
        """Inspect ``ev.pod.container.status`` for OOM termination signatures."""
        data = self._get_status_data(bundle)
        if not data:
            return None

        target_name = bundle.target.container_name if bundle.target else None
        match_info = self._detect_oom(data, target_name)
        if not match_info:
            return None

        return self._build_match(match_info, target_name)

    @staticmethod
    def _get_status_data(bundle: Optional[EvidenceBundle]) -> Optional[Any]:
        """Extract valid container status data from the bundle."""
        if not bundle or not hasattr(bundle, "get"):
            return None
        item = bundle.get("ev.pod.container.status")
        if not item or item.status != CollectionStatus.AVAILABLE:
            return None
        return item.data

    def _build_match(
        self,
        match_info: Tuple[Optional[str], Optional[int], Optional[str], float],
        target_name: Optional[str],
    ) -> RuleMatch:
        """Construct the RuleMatch object from extracted OOM facts."""
        container_name, exit_code, reason, confidence = match_info
        c_label = container_name or target_name or "container"

        if confidence >= 1.0:
            root_cause = (
                f"Container '{c_label}' terminated with exit code 137 (OOMKilled). "
                "Memory limit was exceeded."
            )
        else:
            root_cause = (
                f"Container '{c_label}' terminated with exit code {exit_code}. "
                "Probable memory limit exceeded or external SIGKILL."
            )

        return RuleMatch(
            rule_id=self.rule_id,
            title=self.title,
            root_cause=root_cause,
            confidence=confidence,
            evidence_ids=["ev.pod.container.status"],
        )

    def _detect_oom(
        self, data: Any, target_container: Optional[str]
    ) -> Optional[Tuple[Optional[str], Optional[int], Optional[str], float]]:
        """Extract OOM facts safely respecting target container identity."""
        containers = self._extract_container_list(data)

        if target_container:
            target = self._find_target_container(containers, target_container)
            if target is not None:
                return self._evaluate_container(target)
            if any(c.get("name") == target_container for c in containers):
                return None

        for container_dict in containers:
            match = self._evaluate_container(container_dict)
            if match:
                return match

        return None

    def _evaluate_container(
        self, container_dict: Dict[str, Any]
    ) -> Optional[Tuple[Optional[str], Optional[int], Optional[str], float]]:
        """Evaluate a single container status dictionary for OOM signatures."""
        if not isinstance(container_dict, dict):
            return None

        terminated = self._extract_terminated_state(container_dict)
        if not terminated:
            return None

        reason = terminated.get("reason")
        exit_code = terminated.get("exitCode", terminated.get("exit_code"))
        name = container_dict.get("name")

        if reason == "OOMKilled":
            code = 137 if str(exit_code) == "137" else exit_code
            return (name, code, reason, 1.0)

        if exit_code == 137 or str(exit_code) == "137":
            return (name, 137, reason, 0.8)

        return None

    @staticmethod
    def _find_target_container(
        containers: List[Dict[str, Any]], target_name: str
    ) -> Optional[Dict[str, Any]]:
        """Find container dictionary matching the target name."""
        for c in containers:
            if isinstance(c, dict) and c.get("name") == target_name:
                return c
        return None

    @staticmethod
    def _extract_container_list(data: Any) -> List[Dict[str, Any]]:
        """Normalize container status data into a list of container dictionaries."""
        if isinstance(data, list):
            return [c for c in data if isinstance(c, dict)]
        if isinstance(data, dict):
            if "containerStatuses" in data and isinstance(data["containerStatuses"], list):
                return [c for c in data["containerStatuses"] if isinstance(c, dict)]
            return [data]
        return []

    @staticmethod
    def _extract_terminated_state(container_dict: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Find the terminated state dictionary from lastState, state, or top-level."""
        for key in ("lastState", "state"):
            sub = container_dict.get(key)
            if isinstance(sub, dict) and isinstance(sub.get("terminated"), dict):
                return sub["terminated"]

        if isinstance(container_dict.get("terminated"), dict):
            return container_dict["terminated"]

        return None
