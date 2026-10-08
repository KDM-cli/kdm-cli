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

    Triggers when a container's termination state reports exit code 137
    or reason ``"OOMKilled"``.
    """

    rule_id: str = "rule.kubernetes.oom_killed"
    title: str = "Container Out-Of-Memory (OOMKilled)"

    def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
        """Inspect ``ev.pod.container.status`` for OOM termination signatures.

        Args:
            bundle: Canonical EvidenceBundle containing collected facts.

        Returns:
            :class:`RuleMatch` with 1.0 confidence if OOM is detected, else ``None``.
        """
        if not bundle or not hasattr(bundle, "get"):
            return None

        status_item = bundle.get("ev.pod.container.status")
        if not status_item or status_item.status != CollectionStatus.AVAILABLE:
            return None
        if not status_item.data:
            return None

        target_container = bundle.target.container_name if bundle.target else None
        match_info = self._detect_oom(status_item.data, target_container)
        if not match_info:
            return None

        container_name = match_info[0] or target_container or "container"
        return RuleMatch(
            rule_id=self.rule_id,
            title=self.title,
            root_cause=(
                f"Container '{container_name}' terminated with exit code 137 (OOMKilled). "
                "Memory limit was exceeded."
            ),
            confidence=1.0,
            evidence_ids=["ev.pod.container.status"],
        )

    def _detect_oom(
        self, data: Any, target_container: Optional[str]
    ) -> Optional[Tuple[Optional[str], Optional[int], Optional[str]]]:
        """Extract OOM termination facts from container status data structures."""
        containers = self._extract_container_list(data)
        for container_dict in containers:
            if not isinstance(container_dict, dict):
                continue
            name = container_dict.get("name")
            if target_container and name and name != target_container:
                continue

            terminated = self._extract_terminated_state(container_dict)
            if terminated:
                reason = terminated.get("reason")
                exit_code = terminated.get("exitCode")
                if exit_code is None:
                    exit_code = terminated.get("exit_code")

                if reason == "OOMKilled" or exit_code == 137 or str(exit_code) == "137":
                    return (name, 137 if str(exit_code) == "137" else exit_code, reason)

        # If target_container was specified but no match on that name, check all containers
        if target_container and containers:
            for container_dict in containers:
                if not isinstance(container_dict, dict):
                    continue
                name = container_dict.get("name")
                terminated = self._extract_terminated_state(container_dict)
                if terminated:
                    reason = terminated.get("reason")
                    exit_code = terminated.get("exitCode", terminated.get("exit_code"))
                    if reason == "OOMKilled" or exit_code == 137 or str(exit_code) == "137":
                        return (name, 137 if str(exit_code) == "137" else exit_code, reason)

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
        last_state = container_dict.get("lastState")
        if isinstance(last_state, dict) and isinstance(last_state.get("terminated"), dict):
            return last_state["terminated"]

        state = container_dict.get("state")
        if isinstance(state, dict) and isinstance(state.get("terminated"), dict):
            return state["terminated"]

        if isinstance(container_dict.get("terminated"), dict):
            return container_dict["terminated"]

        return None
