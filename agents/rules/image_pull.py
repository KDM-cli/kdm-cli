"""
ImagePull Rule — KDM v4.0.0
============================
Deterministic diagnostic rule detecting container image pull failures
(ErrImagePull and ImagePullBackOff).
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


_IMAGE_PULL_REASONS = {"ErrImagePull", "ImagePullBackOff"}


class ImagePullRule(BaseRule):
    """Diagnoses container startup stalls caused by failed container image pulls.

    Triggers when a container's waiting state reports reason ``"ErrImagePull"``
    or ``"ImagePullBackOff"``.
    """

    rule_id: str = "rule.kubernetes.image_pull"
    title: str = "Container Image Pull Failure (ImagePullBackOff)"

    def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
        """Inspect ``ev.pod.container.status`` for image pull failure signatures."""
        data = self._get_status_data(bundle)
        if not data:
            return None

        target_name = bundle.target.container_name if bundle.target else None
        match_info = self._detect_image_pull_failure(data, target_name)
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
        match_info: Tuple[Optional[str], str, Optional[str]],
        target_name: Optional[str],
    ) -> RuleMatch:
        """Construct the RuleMatch object from extracted image pull failure facts."""
        container_name, reason, message = match_info
        c_label = container_name or target_name or "container"

        if message:
            root_cause = (
                f"Container '{c_label}' failed to pull image ({reason}): {message}. "
                "Verify image name, tag, and registry credentials."
            )
        else:
            root_cause = (
                f"Container '{c_label}' failed to pull image with reason '{reason}'. "
                "Verify image name, tag, and registry credentials."
            )

        return RuleMatch(
            rule_id=self.rule_id,
            title=self.title,
            root_cause=root_cause,
            confidence=1.0,
            evidence_ids=["ev.pod.container.status"],
        )

    def _detect_image_pull_failure(
        self, data: Any, target_container: Optional[str]
    ) -> Optional[Tuple[Optional[str], str, Optional[str]]]:
        """Extract image pull failure facts safely respecting target container identity."""
        containers = self._extract_container_list(data)
        if target_container:
            return self._detect_for_target(containers, target_container)
        return self._scan_containers(containers)

    def _detect_for_target(
        self, containers: List[Dict[str, Any]], target_container: str
    ) -> Optional[Tuple[Optional[str], str, Optional[str]]]:
        """Evaluate target container when target is specified."""
        target = self._find_target_container(containers, target_container)
        if target is not None:
            return self._evaluate_container(target)
        if self._has_named_container(containers, target_container):
            return None
        return self._scan_containers(containers)

    def _scan_containers(
        self, containers: List[Dict[str, Any]]
    ) -> Optional[Tuple[Optional[str], str, Optional[str]]]:
        """Scan container list sequentially for image pull failures."""
        for container_dict in containers:
            match = self._evaluate_container(container_dict)
            if match:
                return match
        return None

    def _evaluate_container(
        self, container_dict: Dict[str, Any]
    ) -> Optional[Tuple[Optional[str], str, Optional[str]]]:
        """Evaluate a single container status dictionary for image pull failure."""
        if not isinstance(container_dict, dict):
            return None
        waiting = self._extract_waiting_state(container_dict)
        if not waiting:
            return None
        reason = waiting.get("reason")
        if reason in _IMAGE_PULL_REASONS:
            return (container_dict.get("name"), reason, waiting.get("message"))
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
