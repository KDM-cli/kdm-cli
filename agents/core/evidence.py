"""
Canonical Evidence Model for KDM v4.0.0
========================================
Defines the normalized, immutable data structures that represent all observable
facts collected from Kubernetes and Docker APIs before any agent reasoning occurs.

Core Architectural Rule: KDM collects facts; agents reason over facts.
Agents must never guess container exit codes, restart counts, or probe
configurations — all such data lives here as explicit EvidenceItems.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


class CollectionStatus(str, Enum):
    """Explicit status of an evidence collection attempt.

    Using ``str`` as a mixin makes the value JSON-serializable without a
    custom encoder, while still being a proper Enum for type safety.
    """

    AVAILABLE = "available"
    """The data was successfully collected."""

    UNAVAILABLE = "unavailable"
    """The data source was reachable but returned no data (e.g. empty logs)."""

    PERMISSION_DENIED = "permission_denied"
    """The caller lacked RBAC permissions to read the resource."""

    TIMEOUT = "timeout"
    """The collection attempt exceeded the allowed time budget."""

    NOT_FOUND = "not_found"
    """The target resource does not exist in the cluster."""


@dataclass(frozen=True)
class Target:
    """Identifies the workload that is the focus of an analysis run.

    All fields are immutable after construction so that a ``Target`` can be
    safely shared across threads and cached in higher-level contexts.
    """

    workload_kind: str
    """Kubernetes resource kind, e.g. ``"Deployment"``, ``"StatefulSet"``."""

    workload_name: str
    """Name of the workload resource."""

    namespace: str
    """Kubernetes namespace that the workload lives in."""

    container_name: Optional[str] = None
    """Optional specific container within a multi-container pod."""

    cluster_context: Optional[str] = None
    """Optional kubectl context name for multi-cluster environments."""

    def to_dict(self) -> Dict[str, Any]:
        """Return a plain-dict representation suitable for JSON serialisation."""
        result: Dict[str, Any] = {
            "workload_kind": self.workload_kind,
            "workload_name": self.workload_name,
            "namespace": self.namespace,
        }
        if self.container_name is not None:
            result["container_name"] = self.container_name
        if self.cluster_context is not None:
            result["cluster_context"] = self.cluster_context
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Target":
        """Reconstruct a :class:`Target` from its plain-dict representation."""
        return cls(
            workload_kind=data["workload_kind"],
            workload_name=data["workload_name"],
            namespace=data["namespace"],
            container_name=data.get("container_name"),
            cluster_context=data.get("cluster_context"),
        )


@dataclass
class EvidenceItem:
    """A single, normalised piece of evidence collected from an external source.

    Each item carries a stable hierarchical identifier
    (e.g. ``"ev.pod.container.status"``), its provenance, an explicit
    collection status, and the raw payload.  When collection fails the
    ``data`` field is ``None`` and ``error_message`` describes the failure.
    """

    id: str
    """Stable, hierarchical identifier in the form ``ev.<category>.<field>``."""

    source: str
    """Identifier of the data source (e.g. ``"kubernetes_api"``, ``"docker_daemon"``)."""

    status: CollectionStatus
    """Outcome of the collection attempt."""

    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    )
    """ISO 8601 UTC timestamp of when the evidence was collected."""

    data: Any = None
    """The collected payload.  ``None`` when collection was unsuccessful."""

    error_message: Optional[str] = None
    """Human-readable description of the failure, populated when ``status != AVAILABLE``."""

    def to_dict(self) -> Dict[str, Any]:
        """Return a plain-dict representation suitable for JSON serialisation."""
        result: Dict[str, Any] = {
            "id": self.id,
            "source": self.source,
            "status": self.status.value,
            "timestamp": self.timestamp,
        }
        if self.data is not None:
            result["data"] = self.data
        if self.error_message is not None:
            result["error_message"] = self.error_message
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EvidenceItem":
        """Reconstruct an :class:`EvidenceItem` from its plain-dict representation."""
        return cls(
            id=data["id"],
            source=data["source"],
            status=CollectionStatus(data["status"]),
            timestamp=data["timestamp"],
            data=data.get("data"),
            error_message=data.get("error_message"),
        )


@dataclass
class EvidenceBundle:
    """Immutable collection of all facts gathered about a target workload.

    This is the single source of truth passed to every specialist agent and
    every deterministic rule engine.  Items are stored by their stable ``id``
    so retrieval is O(1) and deterministic.
    """

    target: Target
    """The workload under investigation."""

    collected_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    )
    """ISO 8601 UTC timestamp recorded when the bundle was assembled."""

    _items: Dict[str, EvidenceItem] = field(default_factory=dict, repr=False, compare=False)

    # ------------------------------------------------------------------
    # Mutation helpers
    # ------------------------------------------------------------------

    def add(self, item: EvidenceItem) -> None:
        """Add or replace an :class:`EvidenceItem` in the bundle.

        Args:
            item: The evidence item to store.  If an item with the same
                  ``id`` already exists it will be overwritten.
        """
        self._items[item.id] = item

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def get(self, evidence_id: str) -> Optional[EvidenceItem]:
        """Retrieve an item by its stable identifier.

        Args:
            evidence_id: The hierarchical identifier, e.g. ``"ev.pod.events"``.

        Returns:
            The :class:`EvidenceItem` if present, otherwise ``None``.
        """
        return self._items.get(evidence_id)

    def has(self, evidence_id: str) -> bool:
        """Return ``True`` if the bundle contains an item for *evidence_id*.

        Args:
            evidence_id: The hierarchical identifier to check.
        """
        return evidence_id in self._items

    @property
    def items(self) -> Dict[str, EvidenceItem]:
        """Read-only view of all evidence items keyed by their id."""
        return dict(self._items)

    def available_ids(self) -> List[str]:
        """Return identifiers for all items whose status is AVAILABLE."""
        return [
            item_id
            for item_id, item in self._items.items()
            if item.status == CollectionStatus.AVAILABLE
        ]

    def failed_ids(self) -> List[str]:
        """Return identifiers for all items that could not be collected."""
        return [
            item_id
            for item_id, item in self._items.items()
            if item.status != CollectionStatus.AVAILABLE
        ]

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        """Serialise the entire bundle to a plain dictionary.

        The output is JSON-safe (no custom types) and round-trips through
        :meth:`from_dict` without loss of information.

        Returns:
            A dictionary matching the canonical ``EvidenceBundle`` schema.
        """
        return {
            "target": self.target.to_dict(),
            "collected_at": self.collected_at,
            "items": {k: v.to_dict() for k, v in self._items.items()},
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EvidenceBundle":
        """Reconstruct an :class:`EvidenceBundle` from its plain-dict representation.

        Args:
            data: A dictionary previously produced by :meth:`to_dict`.

        Returns:
            A fully populated :class:`EvidenceBundle`.
        """
        bundle = cls(
            target=Target.from_dict(data["target"]),
            collected_at=data["collected_at"],
        )
        for item_data in data.get("items", {}).values():
            bundle.add(EvidenceItem.from_dict(item_data))
        return bundle
