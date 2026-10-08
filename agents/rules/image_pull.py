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
        """Inspect ``ev.pod.container.status`` for image pull failure signatures.

        Args:
            bundle: Canonical EvidenceBundle containing collected facts.

        Returns:
            :class:`RuleMatch` with 1.0 confidence if image pull failure detected, else ``None``.
        """
        if not bundle or not hasattr(bundle, "get"):
            return None

        status_item = bundle.get("ev.pod.container.status")
        if not status_item or status_item.status != CollectionStatus.AVAILABLE:
            return None
        if not status_item.data:
            return None

        target_container = bundle.target.container_name if bundle.target else None
        match_info = self._detect_image_pull_failure(status_item.data, target_container)
        if not match_info:
            return None

        container_name, reason, message = match_info
        c_label = container_name or target_container or "container"

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
        """Extract image pull failure facts from container status data structures."""
        containers = self._extract_container_list(data)
        for container_dict in containers:
            if not isinstance(container_dict, dict):
                continue
            name = container_dict.get("name")
            if target_container and name and name != target_container:
                continue

            waiting = self._extract_waiting_state(container_dict)
            if waiting:
                reason = waiting.get("reason")
                if reason in _IMAGE_PULL_REASONS:
                    return (name, reason, waiting.get("message"))

        # Fallback across all containers if target name did not directly match
        if target_container and containers:
            for container_dict in containers:
                if not isinstance(container_dict, dict):
                    continue
                name = container_dict.get("name")
                waiting = self._extract_waiting_state(container_dict)
                if waiting:
                    reason = waiting.get("reason")
                    if reason in _IMAGE_PULL_REASONS:
                        return (name, reason, waiting.get("message"))

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
