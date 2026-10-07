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
"""

from __future__ import annotations

import json
import sys
import os

# ---------------------------------------------------------------------------
# Make sure ``agents/`` is on the path so imports work when tests are run from
# the repository root *or* from the agents/ directory directly.
# ---------------------------------------------------------------------------
_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

import pytest

from core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target
from core.context import AnalysisContext, AnalysisMetadata
from core.sanitizer import REDACTED_PLACEHOLDER, redact_sensitive_data


# ===========================================================================
# Fixtures
# ===========================================================================


@pytest.fixture()
def sample_target() -> Target:
    return Target(
        workload_kind="Deployment",
        workload_name="checkout-api",
        namespace="production",
        container_name="checkout",
    )


@pytest.fixture()
def empty_bundle(sample_target: Target) -> EvidenceBundle:
    return EvidenceBundle(target=sample_target, collected_at="2026-09-11T12:00:00Z")


@pytest.fixture()
def populated_bundle(empty_bundle: EvidenceBundle) -> EvidenceBundle:
    """Bundle pre-loaded with a container-status and an events item."""
    empty_bundle.add(
        EvidenceItem.create(
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
        EvidenceItem.create(
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
    def test_values_are_strings(self) -> None:
        """CollectionStatus members must be plain strings for JSON compat."""
        assert isinstance(CollectionStatus.AVAILABLE, str)
        assert CollectionStatus.AVAILABLE == "available"

    def test_all_statuses_exist(self) -> None:
        expected = {"available", "unavailable", "permission_denied", "timeout", "not_found"}
        actual = {s.value for s in CollectionStatus}
        assert actual == expected

    def test_reconstruct_from_string(self) -> None:
        assert CollectionStatus("permission_denied") is CollectionStatus.PERMISSION_DENIED


# ===========================================================================
# Target
# ===========================================================================


class TestTarget:
    def test_round_trip(self, sample_target: Target) -> None:
        assert Target.from_dict(sample_target.to_dict()) == sample_target

    def test_optional_fields_omitted(self) -> None:
        t = Target(workload_kind="Job", workload_name="batch-job", namespace="default")
        d = t.to_dict()
        assert "container_name" not in d
        assert "cluster_context" not in d

    def test_optional_fields_present(self) -> None:
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
        with pytest.raises((AttributeError, TypeError)):
            sample_target.workload_name = "mutated"  # type: ignore[misc]


# ===========================================================================
# EvidenceItem
# ===========================================================================


class TestEvidenceItem:
    def test_create_fills_timestamp(self) -> None:
        item = EvidenceItem.create(
            id="ev.pod.container.status",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data={"restartCount": 1},
        )
        # Timestamp must look like an ISO string
        assert "T" in item.timestamp and "Z" in item.timestamp

    def test_explicit_timestamp_preserved(self) -> None:
        ts = "2026-01-01T00:00:00Z"
        item = EvidenceItem.create(
            id="ev.pod.events",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            timestamp=ts,
        )
        assert item.timestamp == ts

    def test_round_trip_available(self) -> None:
        item = EvidenceItem.create(
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
        item = EvidenceItem.create(
            id="ev.secret.env",
            source="kubernetes_api",
            status=CollectionStatus.PERMISSION_DENIED,
            error_message="secrets is forbidden: User cannot get resource",
            timestamp="2026-09-11T12:00:00Z",
        )
        d = item.to_dict()
        assert d["status"] == "permission_denied"
        assert d["error_message"] == "secrets is forbidden: User cannot get resource"
        assert "data" not in d  # absent when None

        r = EvidenceItem.from_dict(d)
        assert r.status == CollectionStatus.PERMISSION_DENIED
        assert r.data is None
        assert r.error_message == item.error_message

    def test_round_trip_timeout(self) -> None:
        item = EvidenceItem.create(
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
        item = EvidenceItem.create(
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
    def test_add_and_get(self, empty_bundle: EvidenceBundle) -> None:
        item = EvidenceItem.create(
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
        assert empty_bundle.get("ev.does.not.exist") is None

    def test_has(self, empty_bundle: EvidenceBundle) -> None:
        assert not empty_bundle.has("ev.pod.container.status")
        empty_bundle.add(
            EvidenceItem.create(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                timestamp="2026-09-11T12:00:00Z",
            )
        )
        assert empty_bundle.has("ev.pod.container.status")

    def test_overwrite_on_duplicate_id(self, empty_bundle: EvidenceBundle) -> None:
        """Adding an item with an existing id should overwrite the previous one."""
        item_v1 = EvidenceItem.create(
            id="ev.pod.container.status",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data={"restartCount": 1},
            timestamp="2026-09-11T12:00:00Z",
        )
        item_v2 = EvidenceItem.create(
            id="ev.pod.container.status",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data={"restartCount": 5},
            timestamp="2026-09-11T12:00:01Z",
        )
        empty_bundle.add(item_v1)
        empty_bundle.add(item_v2)
        assert empty_bundle.get("ev.pod.container.status").data["restartCount"] == 5

    def test_available_ids(self, populated_bundle: EvidenceBundle) -> None:
        # Add one unavailable item
        populated_bundle.add(
            EvidenceItem.create(
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
        empty_bundle.add(
            EvidenceItem.create(
                id="ev.secret.env",
                source="kubernetes_api",
                status=CollectionStatus.PERMISSION_DENIED,
                timestamp="2026-09-11T12:00:00Z",
            )
        )
        empty_bundle.add(
            EvidenceItem.create(
                id="ev.pod.logs",
                source="kubernetes_api",
                status=CollectionStatus.TIMEOUT,
                timestamp="2026-09-11T12:00:00Z",
            )
        )
        failed = empty_bundle.failed_ids()
        assert "ev.secret.env" in failed
        assert "ev.pod.logs" in failed

    # -----------------------------------------------------------------------
    # JSON round-trip
    # -----------------------------------------------------------------------

    def test_to_dict_is_json_serialisable(self, populated_bundle: EvidenceBundle) -> None:
        d = populated_bundle.to_dict()
        serialised = json.dumps(d)
        assert isinstance(serialised, str)

    def test_round_trip_preserves_all_items(self, populated_bundle: EvidenceBundle) -> None:
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
        empty_bundle.add(
            EvidenceItem.create(
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
        """Verify the canonical top-level dict schema."""
        d = populated_bundle.to_dict()
        assert "target" in d
        assert "collected_at" in d
        assert "items" in d
        assert "ev.pod.container.status" in d["items"]
        assert "ev.pod.events" in d["items"]


# ===========================================================================
# Sanitizer
# ===========================================================================


class TestSanitizer:
    def test_password_key_redacted(self) -> None:
        assert redact_sensitive_data({"password": "s3cr3t"}) == {"password": REDACTED_PLACEHOLDER}

    def test_token_key_redacted(self) -> None:
        assert redact_sensitive_data({"api_token": "abc"}) == {"api_token": REDACTED_PLACEHOLDER}

    def test_auth_key_redacted(self) -> None:
        assert redact_sensitive_data({"Authorization": "Bearer xyz"}) == {
            "Authorization": REDACTED_PLACEHOLDER
        }

    def test_case_insensitive(self) -> None:
        cases = {"PASSWORD": "a", "Secret": "b", "API_KEY": "c", "Token": "d"}
        result = redact_sensitive_data(cases)
        for k in cases:
            assert result[k] == REDACTED_PLACEHOLDER

    def test_safe_key_preserved(self) -> None:
        assert redact_sensitive_data({"restartCount": 4}) == {"restartCount": 4}

    def test_nested_dict(self) -> None:
        data = {"outer": {"DB_PASSWORD": "secret", "safe_field": "ok"}}
        result = redact_sensitive_data(data)
        assert result["outer"]["DB_PASSWORD"] == REDACTED_PLACEHOLDER
        assert result["outer"]["safe_field"] == "ok"

    def test_deeply_nested(self) -> None:
        data = {"level1": {"level2": {"level3": {"api_key": "deep_secret"}}}}
        result = redact_sensitive_data(data)
        assert result["level1"]["level2"]["level3"]["api_key"] == REDACTED_PLACEHOLDER

    def test_list_of_dicts(self) -> None:
        data = [{"token": "abc"}, {"safe": "value"}]
        result = redact_sensitive_data(data)
        assert result[0]["token"] == REDACTED_PLACEHOLDER
        assert result[1]["safe"] == "value"

    def test_mixed_nested_structure(self) -> None:
        data = {
            "envVars": [
                {"name": "DB_HOST", "value": "localhost"},
                {"name": "DB_PASSWORD", "value": "supersecret"},
            ],
            "credentials": {"cert": "PEM...", "endpoint": "https://example.com"},
        }
        result = redact_sensitive_data(data)
        # "envVars" key is not sensitive — list items are walked recursively.
        # "name" and "value" keys are not sensitive, so values are preserved as-is.
        assert result["envVars"][0]["value"] == "localhost"
        assert result["envVars"][1]["value"] == "supersecret"  # value key is safe; name key is safe
        # "credentials" key matches the sensitive pattern => entire value redacted.
        assert result["credentials"] == REDACTED_PLACEHOLDER

    def test_scalar_passthrough(self) -> None:
        assert redact_sensitive_data("plain string") == "plain string"
        assert redact_sensitive_data(42) == 42
        assert redact_sensitive_data(None) is None

    def test_original_not_mutated(self) -> None:
        original = {"password": "secret", "safe": "data"}
        redact_sensitive_data(original)
        assert original["password"] == "secret"  # original unchanged

    def test_cert_key_redacted(self) -> None:
        assert redact_sensitive_data({"tls_cert": "PEM_DATA"}) == {
            "tls_cert": REDACTED_PLACEHOLDER
        }

    def test_secret_in_evidence_item(self) -> None:
        """Demonstrate integration: sanitise before storing in EvidenceItem."""
        raw_env = {"DB_HOST": "db.svc", "DB_PASSWORD": "hunter2"}
        safe_env = redact_sensitive_data(raw_env)
        item = EvidenceItem.create(
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
    def test_round_trip(self, sample_metadata: AnalysisMetadata) -> None:
        restored = AnalysisMetadata.from_dict(sample_metadata.to_dict())
        assert restored.cli_version == sample_metadata.cli_version
        assert restored.backend == sample_metadata.backend
        assert restored.model == sample_metadata.model
        assert restored.started_at == sample_metadata.started_at

    def test_create_fills_timestamp(self) -> None:
        m = AnalysisMetadata.create(cli_version="4.0.0", backend="ollama", model="llama3.1")
        assert "T" in m.started_at and "Z" in m.started_at


# ===========================================================================
# AnalysisContext
# ===========================================================================


class TestAnalysisContext:
    def test_create_generates_uuid(
        self,
        sample_target: Target,
        populated_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        ctx = AnalysisContext.create(
            target=sample_target,
            evidence=populated_bundle,
            metadata=sample_metadata,
        )
        import re
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
        ctx = AnalysisContext.create(
            target=sample_target,
            evidence=populated_bundle,
            metadata=sample_metadata,
        )
        serialised = json.dumps(ctx.to_dict())
        assert isinstance(serialised, str)
