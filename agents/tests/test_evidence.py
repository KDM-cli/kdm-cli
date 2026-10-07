"""
Unit Tests — Canonical Evidence Model (agents/core/evidence.py)
=================================================================
Tests cover:
  - CollectionStatus enum integrity and string serialization.
  - Target frozen dataclass immutability and dictionary round-trips.
  - EvidenceItem default timestamp factory, serialization, and status preservation.
  - EvidenceBundle addition, retrieval, filtering, and JSON round-trips.
"""

from __future__ import annotations

import json

import pytest

from core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target


# ===========================================================================
# Fixtures
# ===========================================================================


@pytest.fixture()
def sample_target() -> Target:
    """Provide a standard sample Target instance for tests."""
    return Target(
        workload_kind="Deployment",
        workload_name="checkout-api",
        namespace="production",
        container_name="checkout",
    )


@pytest.fixture()
def empty_bundle(sample_target: Target) -> EvidenceBundle:
    """Provide an empty EvidenceBundle targeting sample_target."""
    return EvidenceBundle(target=sample_target, collected_at="2026-09-11T12:00:00Z")


@pytest.fixture()
def populated_bundle(empty_bundle: EvidenceBundle) -> EvidenceBundle:
    """Provide an EvidenceBundle pre-loaded with status and event items."""
    empty_bundle.add(
        EvidenceItem(
            id="ev.pod.container.status",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data={
                "restartCount": 4,
                "lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}},
            },
            timestamp="2026-09-11T12:00:00Z",
        )
    )
    empty_bundle.add(
        EvidenceItem(
            id="ev.pod.events",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data=[
                {
                    "type": "Warning",
                    "reason": "BackOff",
                    "message": "Back-off restarting failed container",
                }
            ],
            timestamp="2026-09-11T12:00:00Z",
        )
    )
    return empty_bundle


# ===========================================================================
# CollectionStatus Tests
# ===========================================================================


class TestCollectionStatus:
    """Test suite for the CollectionStatus enumeration."""

    def test_values_are_strings(self) -> None:
        """Verify CollectionStatus members inherit from str for JSON serialisation."""
        assert isinstance(CollectionStatus.AVAILABLE, str)
        assert CollectionStatus.AVAILABLE == "available"

    def test_all_statuses_exist(self) -> None:
        """Verify all mandatory collection status codes exist."""
        expected = {"available", "unavailable", "permission_denied", "timeout", "not_found"}
        actual = {s.value for s in CollectionStatus}
        assert actual == expected

    def test_reconstruct_from_string(self) -> None:
        """Verify CollectionStatus can be instantiated from its raw string value."""
        assert CollectionStatus("permission_denied") is CollectionStatus.PERMISSION_DENIED


# ===========================================================================
# Target Tests
# ===========================================================================


class TestTarget:
    """Test suite for the Target dataclass."""

    def test_round_trip(self, sample_target: Target) -> None:
        """Verify Target dictionary serialization and deserialization round-trip."""
        assert Target.from_dict(sample_target.to_dict()) == sample_target

    def test_optional_fields_omitted(self) -> None:
        """Verify optional container_name and cluster_context are omitted when None."""
        t = Target(workload_kind="Job", workload_name="batch-job", namespace="default")
        d = t.to_dict()
        assert "container_name" not in d
        assert "cluster_context" not in d

    def test_optional_fields_present(self) -> None:
        """Verify optional container_name and cluster_context are included when set."""
        t = Target(
            workload_kind="StatefulSet",
            workload_name="db",
            namespace="data",
            container_name="postgres",
            cluster_context="prod-east",
        )
        d = t.to_dict()
        assert d["container_name"] == "postgres"
        assert d["cluster_context"] == "prod-east"

    def test_frozen(self, sample_target: Target) -> None:
        """Verify Target fields cannot be mutated after construction."""
        with pytest.raises((AttributeError, TypeError)):
            sample_target.workload_name = "mutated"  # type: ignore[misc]


# ===========================================================================
# EvidenceItem Tests
# ===========================================================================


class TestEvidenceItem:
    """Test suite for the EvidenceItem dataclass."""

    def test_default_factory_fills_timestamp(self) -> None:
        """Verify EvidenceItem automatically generates an ISO UTC timestamp by default."""
        item = EvidenceItem(
            id="ev.pod.container.status",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data={"restartCount": 1},
        )
        assert "T" in item.timestamp and "Z" in item.timestamp

    def test_explicit_timestamp_preserved(self) -> None:
        """Verify passing an explicit timestamp overrides the default factory."""
        ts = "2026-01-01T00:00:00Z"
        item = EvidenceItem(
            id="ev.pod.events",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            timestamp=ts,
        )
        assert item.timestamp == ts

    def test_round_trip_available(self) -> None:
        """Verify EvidenceItem with AVAILABLE status serializes and deserializes cleanly."""
        item = EvidenceItem(
            id="ev.node.pressure",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data={"memoryPressure": False},
            timestamp="2026-09-11T12:00:00Z",
        )
        reconstructed = EvidenceItem.from_dict(item.to_dict())
        assert reconstructed.id == item.id
        assert reconstructed.source == item.source
        assert reconstructed.status == item.status
        assert reconstructed.data == item.data
        assert reconstructed.timestamp == item.timestamp

    def test_round_trip_permission_denied(self) -> None:
        """Verify EvidenceItem with PERMISSION_DENIED serializes error_message."""
        item = EvidenceItem(
            id="ev.secret.env",
            source="kubernetes_api",
            status=CollectionStatus.PERMISSION_DENIED,
            error_message="secrets is forbidden: User cannot get resource",
            timestamp="2026-09-11T12:00:00Z",
        )
        d = item.to_dict()
        assert d["status"] == "permission_denied"
        assert d["error_message"] == "secrets is forbidden: User cannot get resource"
        assert "data" not in d

        r = EvidenceItem.from_dict(d)
        assert r.status == CollectionStatus.PERMISSION_DENIED
        assert r.data is None
        assert r.error_message == item.error_message

    def test_round_trip_timeout(self) -> None:
        """Verify EvidenceItem with TIMEOUT status preserves error_message."""
        item = EvidenceItem(
            id="ev.pod.logs",
            source="kubernetes_api",
            status=CollectionStatus.TIMEOUT,
            error_message="timed out after 5s",
            timestamp="2026-09-11T12:00:00Z",
        )
        r = EvidenceItem.from_dict(item.to_dict())
        assert r.status == CollectionStatus.TIMEOUT
        assert r.error_message == "timed out after 5s"

    def test_to_dict_excludes_none_error_message(self) -> None:
        """Verify to_dict does not serialize error_message when it is None."""
        item = EvidenceItem(
            id="ev.pod.container.status",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data={},
            timestamp="2026-09-11T12:00:00Z",
        )
        assert "error_message" not in item.to_dict()


# ===========================================================================
# EvidenceBundle Tests
# ===========================================================================


class TestEvidenceBundle:
    """Test suite for the EvidenceBundle collection dataclass."""

    def test_add_and_get(self, empty_bundle: EvidenceBundle) -> None:
        """Verify adding an EvidenceItem allows retrieval by its id."""
        item = EvidenceItem(
            id="ev.pod.container.status",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data={"restartCount": 2},
            timestamp="2026-09-11T12:00:00Z",
        )
        empty_bundle.add(item)
        retrieved = empty_bundle.get("ev.pod.container.status")
        assert retrieved is not None
        assert retrieved.id == "ev.pod.container.status"
        assert retrieved.data["restartCount"] == 2

    def test_get_returns_none_for_missing(self, empty_bundle: EvidenceBundle) -> None:
        """Verify get returns None when an evidence ID is not found."""
        assert empty_bundle.get("ev.does.not.exist") is None

    def test_has(self, empty_bundle: EvidenceBundle) -> None:
        """Verify has returns True only when an evidence ID exists."""
        assert not empty_bundle.has("ev.pod.container.status")
        empty_bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                timestamp="2026-09-11T12:00:00Z",
            )
        )
        assert empty_bundle.has("ev.pod.container.status")

    def test_overwrite_on_duplicate_id(self, empty_bundle: EvidenceBundle) -> None:
        """Verify adding an item with an existing ID overwrites the previous item."""
        item_v1 = EvidenceItem(
            id="ev.pod.container.status",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data={"restartCount": 1},
            timestamp="2026-09-11T12:00:00Z",
        )
        item_v2 = EvidenceItem(
            id="ev.pod.container.status",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data={"restartCount": 5},
            timestamp="2026-09-11T12:00:01Z",
        )
        empty_bundle.add(item_v1)
        empty_bundle.add(item_v2)
        retrieved = empty_bundle.get("ev.pod.container.status")
        assert retrieved is not None
        assert retrieved.data["restartCount"] == 5

    def test_available_ids(self, populated_bundle: EvidenceBundle) -> None:
        """Verify available_ids filters for items with AVAILABLE status."""
        populated_bundle.add(
            EvidenceItem(
                id="ev.pod.logs",
                source="kubernetes_api",
                status=CollectionStatus.UNAVAILABLE,
                timestamp="2026-09-11T12:00:00Z",
            )
        )
        available = populated_bundle.available_ids()
        assert "ev.pod.container.status" in available
        assert "ev.pod.events" in available
        assert "ev.pod.logs" not in available

    def test_failed_ids(self, empty_bundle: EvidenceBundle) -> None:
        """Verify failed_ids returns items whose status is not AVAILABLE."""
        empty_bundle.add(
            EvidenceItem(
                id="ev.secret.env",
                source="kubernetes_api",
                status=CollectionStatus.PERMISSION_DENIED,
                timestamp="2026-09-11T12:00:00Z",
            )
        )
        empty_bundle.add(
            EvidenceItem(
                id="ev.pod.logs",
                source="kubernetes_api",
                status=CollectionStatus.TIMEOUT,
                timestamp="2026-09-11T12:00:00Z",
            )
        )
        failed = empty_bundle.failed_ids()
        assert "ev.secret.env" in failed
        assert "ev.pod.logs" in failed

    def test_to_dict_is_json_serialisable(self, populated_bundle: EvidenceBundle) -> None:
        """Verify EvidenceBundle.to_dict() output is valid JSON."""
        d = populated_bundle.to_dict()
        serialised = json.dumps(d)
        assert isinstance(serialised, str)

    def test_round_trip_preserves_all_items(self, populated_bundle: EvidenceBundle) -> None:
        """Verify round-trip from_dict preserves all nested evidence items."""
        original_dict = populated_bundle.to_dict()
        restored = EvidenceBundle.from_dict(original_dict)

        assert restored.target == populated_bundle.target
        assert restored.collected_at == populated_bundle.collected_at

        for item_id, original_item in populated_bundle.items.items():
            restored_item = restored.get(item_id)
            assert restored_item is not None, f"Missing item: {item_id}"
            assert restored_item.id == original_item.id
            assert restored_item.status == original_item.status
            assert restored_item.data == original_item.data

    def test_round_trip_with_failed_status(self, empty_bundle: EvidenceBundle) -> None:
        """Verify round-trip properly restores items with non-available statuses."""
        empty_bundle.add(
            EvidenceItem(
                id="ev.secret.env",
                source="kubernetes_api",
                status=CollectionStatus.PERMISSION_DENIED,
                error_message="forbidden",
                timestamp="2026-09-11T12:00:00Z",
            )
        )
        restored = EvidenceBundle.from_dict(empty_bundle.to_dict())
        item = restored.get("ev.secret.env")
        assert item is not None
        assert item.status == CollectionStatus.PERMISSION_DENIED
        assert item.error_message == "forbidden"
        assert item.data is None

    def test_to_dict_structure(self, populated_bundle: EvidenceBundle) -> None:
        """Verify the canonical top-level dict schema of EvidenceBundle."""
        d = populated_bundle.to_dict()
        assert "target" in d
        assert "collected_at" in d
        assert "items" in d
        assert "ev.pod.container.status" in d["items"]
        assert "ev.pod.events" in d["items"]

    def test_from_dict_missing_collected_at_raises_key_error(self, sample_target: Target) -> None:
        """Verify EvidenceBundle.from_dict raises KeyError when collected_at is absent."""
        invalid_data = {
            "target": sample_target.to_dict(),
            "items": {},
        }
        with pytest.raises(KeyError):
            EvidenceBundle.from_dict(invalid_data)
