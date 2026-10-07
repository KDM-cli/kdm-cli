"""
Unit Tests — Analysis Context & Metadata (agents/core/context.py)
==================================================================
Tests cover:
  - AnalysisMetadata timestamp generation and JSON serialization round-trips.
  - AnalysisContext UUID generation and explicit ID handling.
  - AnalysisContext JSON serialization and round-trips.
  - Target consistency invariant between AnalysisContext and EvidenceBundle.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

import pytest

from core.context import AnalysisContext, AnalysisMetadata
from core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target


# ===========================================================================
# Fixtures
# ===========================================================================


@pytest.fixture()
def sample_target() -> Target:
    """Provide a standard sample Target instance for context tests."""
    return Target(
        workload_kind="Deployment",
        workload_name="checkout-api",
        namespace="production",
        container_name="checkout",
    )


@pytest.fixture()
def sample_bundle(sample_target: Target) -> EvidenceBundle:
    """Provide a pre-populated EvidenceBundle for context tests."""
    bundle = EvidenceBundle(target=sample_target, collected_at="2026-09-11T12:00:00Z")
    bundle.add(
        EvidenceItem(
            id="ev.pod.container.status",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data={"restartCount": 4},
            timestamp="2026-09-11T12:00:00Z",
        )
    )
    return bundle


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
# AnalysisMetadata Tests
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
# AnalysisContext Tests
# ===========================================================================


class TestAnalysisContext:
    """Test suite for AnalysisContext."""

    def test_create_generates_uuid(
        self,
        sample_target: Target,
        sample_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify AnalysisContext.create generates a valid UUID for analysis_id."""
        ctx = AnalysisContext.create(
            target=sample_target,
            evidence=sample_bundle,
            metadata=sample_metadata,
        )
        uuid_pattern = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        assert uuid_pattern.match(ctx.analysis_id)

    def test_create_uses_explicit_id(
        self,
        sample_target: Target,
        sample_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify AnalysisContext.create respects explicitly provided analysis_id."""
        explicit_id = "test-run-001"
        ctx = AnalysisContext.create(
            target=sample_target,
            evidence=sample_bundle,
            metadata=sample_metadata,
            analysis_id=explicit_id,
        )
        assert ctx.analysis_id == explicit_id

    def test_round_trip(
        self,
        sample_target: Target,
        sample_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify AnalysisContext round-trip serialization and deserialization."""
        ctx = AnalysisContext.create(
            target=sample_target,
            evidence=sample_bundle,
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
        sample_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify AnalysisContext.to_dict() output is valid JSON."""
        ctx = AnalysisContext.create(
            target=sample_target,
            evidence=sample_bundle,
            metadata=sample_metadata,
        )
        serialised = json.dumps(ctx.to_dict())
        assert isinstance(serialised, str)

    @pytest.mark.parametrize(
        "factory",
        [
            lambda t, b, m: AnalysisContext(
                analysis_id="mismatch-test", target=t, evidence=b, metadata=m
            ),
            lambda t, b, m: AnalysisContext.create(target=t, evidence=b, metadata=m),
            lambda t, b, m: AnalysisContext.from_dict(
                {
                    "analysis_id": "mismatch-dict-test",
                    "target": t.to_dict(),
                    "evidence": b.to_dict(),
                    "metadata": m.to_dict(),
                }
            ),
        ],
    )
    def test_target_mismatch_raises_value_error(
        self,
        factory: Callable[[Target, EvidenceBundle, AnalysisMetadata], Any],
        sample_bundle: EvidenceBundle,
        sample_metadata: AnalysisMetadata,
    ) -> None:
        """Verify direct init, create, and from_dict reject target mismatch."""
        different_target = Target(
            workload_kind="Deployment",
            workload_name="other-api",
            namespace="production",
        )
        with pytest.raises(ValueError, match="AnalysisContext.target must match evidence.target"):
            factory(different_target, sample_bundle, sample_metadata)
