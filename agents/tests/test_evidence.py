"""
Unit Tests — KDM v4.0.0 Canonical Evidence Layer
==================================================
Tests cover:
  - EvidenceBundle creation, addition, and retrieval.
  - Deterministic EvidenceItem IDs and status values.
  - Full JSON round-trip serialisation / deserialisation.
  - Secret masking across deeply nested dictionaries and lists.
  - PERMISSION_DENIED and TIMEOUT status handling.
  - AnalysisContext and AnalysisMetadata round-trips.
  - Target consistency invariant between AnalysisContext and EvidenceBundle.
"""

from __future__ import annotations

import json
import re

import pytest

from core.context import AnalysisContext, AnalysisMetadata
from core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target
from core.sanitizer import REDACTED_PLACEHOLDER, redact_sensitive_data


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


@pytest.fixture()
def sample_metadata() -> AnalysisMetadata:
    """Provide a standard AnalysisMetadata fixture."""
    return AnalysisMetadata.create(
        cli_version="4.0.0",
        backend="ollama",
        model="llama3.1",
        started_at="2026-09-11T12:00:00Z",
    )


# ===========================================================================
# CollectionStatus
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
# Target
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
# EvidenceItem
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
# EvidenceBundle
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


# ===========================================================================
# Sanitizer
# ===========================================================================


class TestSanitizer:
    """Test suite for credential redaction sanitizer."""

    def test_password_key_redacted(self) -> None:
        """Verify password key is redacted."""
        assert redact_sensitive_data({"password": "s3cr3t"}) == {"password": REDACTED_PLACEHOLDER}

    def test_token_key_redacted(self) -> None:
        """Verify token key is redacted."""
        assert redact_sensitive_data({"api_token": "abc"}) == {"api_token": REDACTED_PLACEHOLDER}

    def test_auth_key_redacted(self) -> None:
        """Verify authorization key is redacted."""
        assert redact_sensitive_data({"Authorization": "Bearer xyz"}) == {
            "Authorization": REDACTED_PLACEHOLDER
        }

    def test_case_insensitive(self) -> None:
        """Verify sensitive key matching is case-insensitive."""
        cases = {"PASSWORD": "a", "Secret": "b", "API_KEY": "c", "Token": "d"}
        result = redact_sensitive_data(cases)
        for k in cases:
            assert result[k] == REDACTED_PLACEHOLDER

    def test_safe_key_preserved(self) -> None:
        """Verify non-sensitive keys preserve their values intact."""
        assert redact_sensitive_data({"restartCount": 4}) == {"restartCount": 4}

    def test_nested_dict(self) -> None:
        """Verify redaction works correctly in nested dictionaries."""
        data = {"outer": {"DB_PASSWORD": "secret", "safe_field": "ok"}}
        result = redact_sensitive_data(data)
        assert result["outer"]["DB_PASSWORD"] == REDACTED_PLACEHOLDER
        assert result["outer"]["safe_field"] == "ok"

    def test_deeply_nested(self) -> None:
        """Verify redaction works across multiple levels of dictionary nesting."""
        data = {"level1": {"level2": {"level3": {"api_key": "deep_secret"}}}}
        result = redact_sensitive_data(data)
        assert result["level1"]["level2"]["level3"]["api_key"] == REDACTED_PLACEHOLDER

    def test_arbitrarily_deep_nesting_no_recursion_error(self) -> None:
        """Verify stack-based traversal handles deep nesting without RecursionError."""
        depth = 2000
        cur: dict = {"api_key": "secret_leaf"}
        for _ in range(depth):
            cur = {"child": cur}
        result = redact_sensitive_data(cur)
        # Walk down to the leaf to verify redaction
        target_node = result
        for _ in range(depth):
            target_node = target_node["child"]
        assert target_node["api_key"] == REDACTED_PLACEHOLDER

    def test_list_of_dicts(self) -> None:
        """Verify redaction applies inside lists of dictionaries."""
        data = [{"token": "abc"}, {"safe": "value"}]
        result = redact_sensitive_data(data)
        assert result[0]["token"] == REDACTED_PLACEHOLDER
        assert result[1]["safe"] == "value"

    def test_mixed_nested_structure(self) -> None:
        """Verify envVars sibling name matching and credentials redaction."""
        data = {
            "envVars": [
                {"name": "DB_HOST", "value": "localhost"},
                {"name": "DB_PASSWORD", "value": "supersecret"},
            ],
            "credentials": {"cert": "PEM...", "endpoint": "https://example.com"},
        }
        result = redact_sensitive_data(data)
        assert result["envVars"][0]["value"] == "localhost"
        assert result["envVars"][1]["value"] == REDACTED_PLACEHOLDER
        assert result["credentials"] == REDACTED_PLACEHOLDER

    def test_scalar_passthrough(self) -> None:
        """Verify primitive scalar values are returned unmodified."""
        assert redact_sensitive_data("plain string") == "plain string"
        assert redact_sensitive_data(42) == 42
        assert redact_sensitive_data(None) is None

    def test_original_not_mutated(self) -> None:
        """Verify original data structure is not mutated during redaction."""
        original = {"password": "secret", "safe": "data"}
        redact_sensitive_data(original)
        assert original["password"] == "secret"

    def test_cert_key_redacted(self) -> None:
        """Verify certificate keys are recognized as sensitive."""
        assert redact_sensitive_data({"tls_cert": "PEM_DATA"}) == {
            "tls_cert": REDACTED_PLACEHOLDER
        }

    def test_secret_in_evidence_item(self) -> None:
        """Verify integration of redaction before creating an EvidenceItem."""
        raw_env = {"DB_HOST": "db.svc", "DB_PASSWORD": "hunter2"}
        safe_env = redact_sensitive_data(raw_env)
        item = EvidenceItem(
            id="ev.secret.env",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data=safe_env,
            timestamp="2026-09-11T12:00:00Z",
        )
        assert item.data["DB_PASSWORD"] == REDACTED_PLACEHOLDER
        assert item.data["DB_HOST"] == "db.svc"


# ===========================================================================
# AnalysisMetadata
# ===========================================================================


class TestAnalysisMetadata:
    """Test suite for AnalysisMetadata."""

    def test_round_trip(self, sample_metadata: AnalysisMetadata) -> None:
        """Verify AnalysisMetadata dictionary round-trip."""
        restored = AnalysisMetadata.from_dict(sample_metadata.to_dict())
        assert restored.cli_version == sample_metadata.cli_version
        assert restored.backend == sample_metadata.backend
        assert restored.model == sample_metadata.model
        assert restored.started_at == sample_metadata.started_at

    def test_create_fills_timestamp(self) -> None:
        """Verify AnalysisMetadata.create auto-fills started_at timestamp."""
        m = AnalysisMetadata.create(cli_version="4.0.0", backend="ollama", model="llama3.1")
        assert "T" in m.started_at and "Z" in m.started_at


# ===========================================================================
# AnalysisContext
# ===========================================================================


class TestAnalysisContext:
    """Test suite for AnalysisContext."""

    def test_create_generates_uuid(
        self,
        sample_target: Target,
        populated_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify AnalysisContext.create generates a valid UUID for analysis_id."""
        ctx = AnalysisContext.create(
            target=sample_target,
            evidence=populated_bundle,
            metadata=sample_metadata,
        )
        uuid_pattern = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        assert uuid_pattern.match(ctx.analysis_id)

    def test_create_uses_explicit_id(
        self,
        sample_target: Target,
        populated_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify AnalysisContext.create respects explicitly provided analysis_id."""
        explicit_id = "test-run-001"
        ctx = AnalysisContext.create(
            target=sample_target,
            evidence=populated_bundle,
            metadata=sample_metadata,
            analysis_id=explicit_id,
        )
        assert ctx.analysis_id == explicit_id

    def test_round_trip(
        self,
        sample_target: Target,
        populated_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify AnalysisContext round-trip serialization and deserialization."""
        ctx = AnalysisContext.create(
            target=sample_target,
            evidence=populated_bundle,
            metadata=sample_metadata,
            analysis_id="round-trip-test",
        )
        restored = AnalysisContext.from_dict(ctx.to_dict())
        assert restored.analysis_id == ctx.analysis_id
        assert restored.target == ctx.target
        assert restored.metadata.cli_version == ctx.metadata.cli_version
        assert restored.evidence.get("ev.pod.container.status") is not None

    def test_to_dict_is_json_serialisable(
        self,
        sample_target: Target,
        populated_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify AnalysisContext.to_dict() output is valid JSON."""
        ctx = AnalysisContext.create(
            target=sample_target,
            evidence=populated_bundle,
            metadata=sample_metadata,
        )
        serialised = json.dumps(ctx.to_dict())
        assert isinstance(serialised, str)

    def test_target_mismatch_raises_value_error_direct(
        self,
        populated_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify AnalysisContext direct init rejects target differing from evidence.target."""
        different_target = Target(
            workload_kind="Deployment",
            workload_name="other-api",
            namespace="production",
        )
        with pytest.raises(ValueError, match="AnalysisContext.target must match evidence.target"):
            AnalysisContext(
                analysis_id="mismatch-test",
                target=different_target,
                evidence=populated_bundle,
                metadata=sample_metadata,
            )

    def test_target_mismatch_raises_value_error_create(
        self,
        populated_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify AnalysisContext.create rejects target differing from evidence.target."""
        different_target = Target(
            workload_kind="Deployment",
            workload_name="other-api",
            namespace="production",
        )
        with pytest.raises(ValueError, match="AnalysisContext.target must match evidence.target"):
            AnalysisContext.create(
                target=different_target,
                evidence=populated_bundle,
                metadata=sample_metadata,
            )

    def test_target_mismatch_raises_value_error_from_dict(
        self,
        populated_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify AnalysisContext.from_dict rejects payload with mismatched targets."""
        different_target = Target(
            workload_kind="Deployment",
            workload_name="other-api",
            namespace="production",
        )
        payload = {
            "analysis_id": "mismatch-dict-test",
            "target": different_target.to_dict(),
            "evidence": populated_bundle.to_dict(),
            "metadata": sample_metadata.to_dict(),
        }
        with pytest.raises(ValueError, match="AnalysisContext.target must match evidence.target"):
            AnalysisContext.from_dict(payload)
