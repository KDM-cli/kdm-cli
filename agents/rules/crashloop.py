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
        """Inspect ``ev.pod.container.status`` for CrashLoopBackOff signatures."""
        data = self._get_status_data(bundle)
        if not data:
            return None

        target_name = bundle.target.container_name if bundle.target else None
        match_info = self._detect_crashloop(data, target_name)
        if not match_info:
            return None

        return self._build_match(match_info, target_name)

    @staticmethod
    def _get_status_data(bundle: Optional[EvidenceBundle]) -> Optional[Any]:
        """Extract valid container status data from the bundle."""
        if bundle is None or not hasattr(bundle, "get"):
            return None
        item = bundle.get("ev.pod.container.status")
        if item is None or item.status != CollectionStatus.AVAILABLE:
            return None
        return item.data

    def _build_match(
        self,
        match_info: Tuple[Optional[str], int, int],
        target_name: Optional[str],
    ) -> RuleMatch:
        """Construct the RuleMatch object from extracted CrashLoop facts."""
        container_name, restart_count, exit_code = match_info
        c_label = container_name or target_name or "container"

        root_cause = (
            f"Container '{c_label}' is in CrashLoopBackOff "
            f"(restartCount: {restart_count}, exitCode: {exit_code}). "
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
    ) -> Optional[Tuple[Optional[str], int, int]]:
        """Extract CrashLoopBackOff facts safely respecting target container identity."""
        containers = self._extract_container_list(data)
        if target_container:
            return self._detect_for_target(containers, target_container)
        return self._scan_containers(containers)

    def _detect_for_target(
        self, containers: List[Dict[str, Any]], target_container: str
    ) -> Optional[Tuple[Optional[str], int, int]]:
        """Evaluate target container when target is specified."""
        target = self._find_target_container(containers, target_container)
        if target is not None:
            return self._evaluate_container(target)
        if self._has_named_container(containers, target_container):
            return None
        return self._scan_containers(containers)

    def _scan_containers(
        self, containers: List[Dict[str, Any]]
    ) -> Optional[Tuple[Optional[str], int, int]]:
        """Scan container list sequentially for CrashLoopBackOff status."""
        for container_dict in containers:
            match = self._evaluate_container(container_dict)
            if match:
                return match
        return None

    def _evaluate_container(
        self, container_dict: Dict[str, Any]
    ) -> Optional[Tuple[Optional[str], int, int]]:
        """Evaluate a single container dictionary for CrashLoopBackOff status."""
        if not isinstance(container_dict, dict):
            return None

        waiting = self._extract_waiting_state(container_dict)
        if not waiting or waiting.get("reason") != "CrashLoopBackOff":
            return None

        exit_code = self._extract_exit_code(container_dict)
        if exit_code is None or exit_code <= 0:
            return None

        restart_raw = container_dict.get("restartCount", container_dict.get("restart_count"))
        restart_count = self._parse_int(restart_raw) or 0
        return (container_dict.get("name"), restart_count, exit_code)

    @classmethod
    def _extract_exit_code(cls, container_dict: Dict[str, Any]) -> Optional[int]:
        """Extract the numeric exit code from terminated state if available."""
        for key in ("lastState", "state"):
            term = cls._get_terminated(container_dict.get(key))
            if term is not None:
                code = cls._parse_code(term)
                if code is not None:
                    return code

        return cls._parse_code(container_dict)

    @staticmethod
    def _get_terminated(state_dict: Any) -> Optional[Dict[str, Any]]:
        """Extract terminated dictionary from state."""
        if isinstance(state_dict, dict) and isinstance(state_dict.get("terminated"), dict):
            return state_dict["terminated"]
        return None

    @classmethod
    def _parse_code(cls, d: Dict[str, Any]) -> Optional[int]:
        """Extract and parse exitCode from a dictionary."""
        return cls._parse_int(d.get("exitCode", d.get("exit_code")))

    @staticmethod
    def _parse_int(val: Any) -> Optional[int]:
        """Safely parse an integer value."""
        if val is None:
            return None
        try:
            return int(val)
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _has_named_container(containers: List[Dict[str, Any]], target_name: str) -> bool:
        """Check whether any container in the list matches target_name."""
        for c in containers:
            if isinstance(c, dict) and c.get("name") == target_name:
                return True
        return False

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
            statuses = data.get("containerStatuses")
            if isinstance(statuses, list):
                return [c for c in statuses if isinstance(c, dict)]
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
