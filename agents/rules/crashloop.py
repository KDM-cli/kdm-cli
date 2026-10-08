"""
CrashLoop Rule — KDM v4.0.0
============================
Deterministic diagnostic rule detecting container CrashLoopBackOff failures.
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


class CrashLoopRule(BaseRule):
    """Diagnoses containers repeatedly crashing upon startup.

    Triggers when a container's waiting state is ``"CrashLoopBackOff"``
    and the termination exit code is greater than 0.
    """

    rule_id: str = "rule.kubernetes.crashloop_backoff"
    title: str = "Container CrashLoopBackOff"

    def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
        """Inspect ``ev.pod.container.status`` for CrashLoopBackOff signatures.

        Args:
            bundle: Canonical EvidenceBundle containing collected facts.

        Returns:
            :class:`RuleMatch` with 1.0 confidence if CrashLoop detected with exitCode > 0, else ``None``.
        """
        if not bundle or not hasattr(bundle, "get"):
            return None

        status_item = bundle.get("ev.pod.container.status")
        if not status_item or status_item.status != CollectionStatus.AVAILABLE:
            return None
        if not status_item.data:
            return None

        target_container = bundle.target.container_name if bundle.target else None
        match_info = self._detect_crashloop(status_item.data, target_container)
        if not match_info:
            return None

        container_name, restart_count, exit_code = match_info
        c_label = container_name or target_container or "container"

        if exit_code is not None:
            root_cause = (
                f"Container '{c_label}' is in CrashLoopBackOff "
                f"(restartCount: {restart_count}, exitCode: {exit_code}). "
                "Application process repeatedly crashed on startup."
            )
        else:
            root_cause = (
                f"Container '{c_label}' is in CrashLoopBackOff "
                f"(restartCount: {restart_count}). "
                "Application process repeatedly crashed on startup."
            )

        return RuleMatch(
            rule_id=self.rule_id,
            title=self.title,
            root_cause=root_cause,
            confidence=1.0,
            evidence_ids=["ev.pod.container.status"],
        )

    def _detect_crashloop(
        self, data: Any, target_container: Optional[str]
    ) -> Optional[Tuple[Optional[str], int, Optional[int]]]:
        """Extract CrashLoopBackOff facts from container status data structures."""
        containers = self._extract_container_list(data)
        for container_dict in containers:
            if not isinstance(container_dict, dict):
                continue
            name = container_dict.get("name")
            if target_container and name and name != target_container:
                continue

            match = self._evaluate_container_dict(container_dict)
            if match:
                return match

        # Fallback across all containers if target name did not directly match
        if target_container and containers:
            for container_dict in containers:
                if not isinstance(container_dict, dict):
                    continue
                match = self._evaluate_container_dict(container_dict)
                if match:
                    return match

        return None

    def _evaluate_container_dict(
        self, container_dict: Dict[str, Any]
    ) -> Optional[Tuple[Optional[str], int, Optional[int]]]:
        """Evaluate a single container dictionary for CrashLoopBackOff status."""
        waiting = self._extract_waiting_state(container_dict)
        if not waiting or waiting.get("reason") != "CrashLoopBackOff":
            return None

        restart_count = container_dict.get("restartCount", container_dict.get("restart_count", 0))
        try:
            restart_count = int(restart_count)
        except (ValueError, TypeError):
            restart_count = 0

        exit_code = self._extract_exit_code(container_dict)
        # Per requirement: Matches CrashLoopBackOff with exit codes > 0
        if exit_code is not None and exit_code <= 0:
            return None

        return (container_dict.get("name"), restart_count, exit_code)

    @staticmethod
    def _extract_exit_code(container_dict: Dict[str, Any]) -> Optional[int]:
        """Extract the numeric exit code from terminated state if available."""
        last_state = container_dict.get("lastState")
        if isinstance(last_state, dict):
            terminated = last_state.get("terminated")
            if isinstance(terminated, dict):
                code = terminated.get("exitCode", terminated.get("exit_code"))
                if code is not None:
                    try:
                        return int(code)
                    except (ValueError, TypeError):
                        pass

        state = container_dict.get("state")
        if isinstance(state, dict):
            terminated = state.get("terminated")
            if isinstance(terminated, dict):
                code = terminated.get("exitCode", terminated.get("exit_code"))
                if code is not None:
                    try:
                        return int(code)
                    except (ValueError, TypeError):
                        pass

        top_code = container_dict.get("exitCode", container_dict.get("exit_code"))
        if top_code is not None:
            try:
                return int(top_code)
            except (ValueError, TypeError):
                pass

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
    def _extract_waiting_state(container_dict: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Find the waiting state dictionary from state or top-level."""
        state = container_dict.get("state")
        if isinstance(state, dict) and isinstance(state.get("waiting"), dict):
            return state["waiting"]

        if isinstance(container_dict.get("waiting"), dict):
            return container_dict["waiting"]

        return None
