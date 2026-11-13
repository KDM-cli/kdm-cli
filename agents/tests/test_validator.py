"""
Unit Tests — Cross-Agent Validator and Disagreement Resolution (Phase 9)
========================================================================
Tests cover:
  - Task 9.1: ValidationResult dataclass model, attributes, clamping, and serialization.
  - Task 9.2: CrossAgentValidator contradiction checks against EvidenceBundle:
      * Factual OOMKill contradiction (exit code != 137, e.g. exit code 1 panic).
      * Valid OOMKill verification (exit code == 137).
      * DNS failure contradiction (CoreDNS 100% healthy).
      * Process crash contradiction (clean exit code 0).
      * Probe failure contradiction (no health probes configured or probes passing).
      * Node condition pressure contradiction (MemoryPressure=False, DiskPressure=False, Ready=True).
      * Image pull failure contradiction (container already running).
      * Target container name resolution in multi-container payloads.
  - Task 9.3: Disagreement resolution and hypothesis re-ranking:
      * resolve_disagreements re-ranks hypotheses when top hypothesis is refuted.
      * validate_hypotheses batch validation.
      * Edge cases: None hypothesis, None bundle, empty bundle, non-finite score clamping.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict
import unittest

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target
    from agents.synthesis.hypotheses import Hypothesis
    from agents.validation.validator import CrossAgentValidator, ValidationResult
except ImportError:
    from core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target  # type: ignore[no-redef]
    from synthesis.hypotheses import Hypothesis  # type: ignore[no-redef]
    from validation.validator import CrossAgentValidator, ValidationResult  # type: ignore[no-redef]


def _create_bundle(
    workload_name: str = "checkout-api",
    container_name: str = "api",
    namespace: str = "production",
) -> EvidenceBundle:
    """Helper to construct an EvidenceBundle for test scenarios."""
    target = Target(
        workload_kind="Deployment",
        workload_name=workload_name,
        namespace=namespace,
        container_name=container_name,
    )
    return EvidenceBundle(target=target, collected_at="2026-10-10T12:00:00Z")


def _add_evidence(
    bundle: EvidenceBundle,
    item_id: str,
    data: Any,
    status: CollectionStatus = CollectionStatus.AVAILABLE,
) -> None:
    """Helper to insert an EvidenceItem into an EvidenceBundle."""
    bundle.add(
        EvidenceItem(
            id=item_id,
            source="kubernetes_api",
            status=status,
            data=data,
        )
    )


def _make_status_dict(code: int, reason: str = "Error") -> Dict[str, Any]:
    """Helper to construct a container terminated state status dictionary."""
    return {
        "name": "api",
        "lastState": {
            "terminated": {
                "exitCode": code,
                "reason": reason,
            }
        },
    }


def _make_dns_dict(healthy: bool = True) -> Dict[str, Any]:
    """Helper to construct a CoreDNS status dictionary."""
    return {
        "status": "100% healthy" if healthy else "Degraded",
        "healthy": healthy,
        "replicas": 2,
        "readyReplicas": 2 if healthy else 0,
    }


def _make_node_conditions(
    mem: str = "False", disk: str = "False", ready: str = "True"
) -> Dict[str, Any]:
    """Helper to construct node condition records."""
    return {
        "conditions": [
            {"type": "MemoryPressure", "status": mem},
            {"type": "DiskPressure", "status": disk},
            {"type": "Ready", "status": ready},
        ]
    }


class TestValidationResultModel(unittest.TestCase):
    """Tests for :class:`~agents.validation.validator.ValidationResult` dataclass."""

    def test_validation_result_initialization(self) -> None:
        """Verify standard fields, approved flag, score, and explanation."""
        res = ValidationResult(
            approved=True,
            confidence_score=0.92,
            reason="No contradictions found.",
        )
        self.assertTrue(res.approved)
        self.assertEqual(res.confidence_score, 0.92)
        self.assertEqual(res.reason, "No contradictions found.")

    def test_confidence_score_clamping_and_sanitization(self) -> None:
        """Verify out-of-bounds, negative, and non-finite scores are sanitized."""
        res_high = ValidationResult(approved=True, confidence_score=1.5, reason="High")
        self.assertEqual(res_high.confidence_score, 1.0)

        res_low = ValidationResult(approved=False, confidence_score=-0.2, reason="Low")
        self.assertEqual(res_low.confidence_score, 0.0)

        res_nan = ValidationResult(approved=False, confidence_score=float("nan"), reason="NaN")
        self.assertEqual(res_nan.confidence_score, 0.2)

        res_inf = ValidationResult(approved=False, confidence_score=float("inf"), reason="Inf")
        self.assertEqual(res_inf.confidence_score, 0.2)

    def test_serialization_roundtrip(self) -> None:
        """Verify to_dict and from_dict serialize and restore faithfully."""
        original = ValidationResult(
            approved=False,
            confidence_score=0.25,
            reason="Hypothesis claims OOMKilled, but container exit code was 1 (application panic), not 137.",
        )
        data = original.to_dict()
        self.assertFalse(data["approved"])
        self.assertEqual(data["confidence_score"], 0.25)
        self.assertIn("application panic", data["reason"])

        restored = ValidationResult.from_dict(data)
        self.assertFalse(restored.approved)
        self.assertEqual(restored.confidence_score, 0.25)
        self.assertEqual(restored.reason, original.reason)


class TestCrossAgentValidatorContradictions(unittest.TestCase):
    """Tests for factual contradiction detection against EvidenceBundle."""

    def setUp(self) -> None:
        self.validator = CrossAgentValidator(default_downgrade_score=0.2)
        self.bundle = _create_bundle()

    def test_valid_hypothesis_approved_without_contradiction(self) -> None:
        """Verify a non-contradicted hypothesis is approved with original likelihood."""
        hyp = Hypothesis(
            id="hyp-01",
            description="Upstream dependency timeout causing slow request processing.",
            likelihood=0.88,
            supporting_evidence=["HTTP 504 gateway timeout recorded"],
        )
        result = self.validator.validate(hyp, self.bundle)
        self.assertTrue(result.approved)
        self.assertEqual(result.confidence_score, 0.88)
        self.assertEqual(result.reason, "No contradictions found.")

    def test_oomkilled_contradicted_by_exit_code_1_panic(self) -> None:
        """Verify OOMKilled claim refuted when exit code is 1 (application panic)."""
        hyp = Hypothesis(
            id="hyp-01",
            description="Container OOMKilled under memory exhaustion.",
            likelihood=0.95,
            supporting_evidence=["Memory limit set to 256Mi"],
        )
        _add_evidence(self.bundle, "ev.pod.container.status", _make_status_dict(1))

        result = self.validator.validate(hyp, self.bundle)
        self.assertFalse(result.approved)
        self.assertEqual(result.confidence_score, 0.2)
        self.assertIn("Hypothesis claims OOMKilled", result.reason)
        self.assertIn("exit code was 1 (application panic), not 137", result.reason)

    def test_oomkilled_contradicted_by_arbitrary_non_137_exit_code(self) -> None:
        """Verify OOMKilled claim refuted when exit code is 143 (SIGTERM)."""
        hyp = Hypothesis(
            id="hyp-01",
            description="Application OOMKilled during background processing.",
            likelihood=0.9,
            supporting_evidence=[],
        )
        _add_evidence(self.bundle, "ev.pod.container.status", _make_status_dict(143, "Terminated"))

        result = self.validator.validate(hyp, self.bundle)
        self.assertFalse(result.approved)
        self.assertEqual(result.confidence_score, 0.2)
        self.assertIn("Hypothesis claims OOMKilled but container exit code was 143, not 137", result.reason)

    def test_oomkilled_verified_when_exit_code_is_137(self) -> None:
        """Verify OOMKilled claim confirmed when container exit code is 137."""
        hyp = Hypothesis(
            id="hyp-01",
            description="Container OOMKilled under peak workload.",
            likelihood=0.92,
            supporting_evidence=["Exit code 137"],
        )
        _add_evidence(self.bundle, "ev.pod.container.status", _make_status_dict(137, "OOMKilled"))

        result = self.validator.validate(hyp, self.bundle)
        self.assertTrue(result.approved)
        self.assertEqual(result.confidence_score, 0.92)
        self.assertEqual(result.reason, "No contradictions found.")

    def test_dns_failure_contradicted_by_healthy_coredns(self) -> None:
        """Verify DNS failure hypothesis refuted when CoreDNS is 100% healthy."""
        hyp = Hypothesis(
            id="hyp-02",
            description="Internal DNS resolution failure preventing service discovery.",
            likelihood=0.85,
            supporting_evidence=["Database connection timeout"],
        )
        _add_evidence(self.bundle, "ev.cluster.dns.status", _make_dns_dict(True))

        result = self.validator.validate(hyp, self.bundle)
        self.assertFalse(result.approved)
        self.assertEqual(result.confidence_score, 0.2)
        self.assertIn("Hypothesis claims DNS failure", result.reason)
        self.assertIn("CoreDNS is 100% healthy", result.reason)

    def test_process_crash_contradicted_by_clean_exit_code_0(self) -> None:
        """Verify process crash hypothesis refuted when container exit code was 0."""
        hyp = Hypothesis(
            id="hyp-03",
            description="Application crash due to unhandled runtime exception.",
            likelihood=0.8,
            supporting_evidence=[],
        )
        status_data = _make_status_dict(0, "Completed")
        status_data["restartCount"] = 0
        _add_evidence(self.bundle, "ev.pod.container.status", status_data)

        result = self.validator.validate(hyp, self.bundle)
        self.assertFalse(result.approved)
        self.assertIn("exited cleanly with exit code 0", result.reason)

    def test_probe_failure_contradicted_when_no_probes_configured(self) -> None:
        """Verify probe failure hypothesis refuted when specification lacks probes."""
        hyp = Hypothesis(
            id="hyp-04",
            description="Readiness probe failure caused endpoint withdrawal.",
            likelihood=0.75,
            supporting_evidence=[],
        )
        spec_data = {"containers": [{"name": "api", "image": "my-app:v1.0.0"}]}
        _add_evidence(self.bundle, "ev.pod.spec", spec_data)

        result = self.validator.validate(hyp, self.bundle)
        self.assertFalse(result.approved)
        self.assertIn("no health probes configured", result.reason)

    def test_node_memory_pressure_contradicted_by_node_conditions(self) -> None:
        """Verify Node MemoryPressure hypothesis refuted when conditions report False."""
        hyp = Hypothesis(
            id="hyp-05",
            description="Node MemoryPressure eviction killed the workload pod.",
            likelihood=0.82,
            supporting_evidence=[],
        )
        _add_evidence(self.bundle, "ev.node.conditions", _make_node_conditions(mem="False"))

        result = self.validator.validate(hyp, self.bundle)
        self.assertFalse(result.approved)
        self.assertIn("explicitly report MemoryPressure=False", result.reason)

    def test_image_pull_contradicted_when_container_is_running(self) -> None:
        """Verify ImagePullBackOff hypothesis refuted when container is already running."""
        hyp = Hypothesis(
            id="hyp-06",
            description="Container stuck in ImagePullBackOff due to missing image tag.",
            likelihood=0.88,
            supporting_evidence=[],
        )
        status_data = {
            "name": "api",
            "state": {"running": {"startedAt": "2026-10-10T11:00:00Z"}},
            "ready": True,
        }
        _add_evidence(self.bundle, "ev.pod.container.status", status_data)

        result = self.validator.validate(hyp, self.bundle)
        self.assertFalse(result.approved)
        self.assertIn("image was pulled successfully and container is running", result.reason)


class TestTargetContainerResolution(unittest.TestCase):
    """Tests container targeting in multi-container pods."""

    def test_prioritizes_target_container_in_container_statuses_list(self) -> None:
        """Verify validator inspects target container rather than first unrelated container."""
        bundle = _create_bundle(container_name="sidecar")
        hyp = Hypothesis(
            id="hyp-01",
            description="Container OOMKilled under memory limit.",
            likelihood=0.9,
            supporting_evidence=[],
        )
        status_data = {
            "containerStatuses": [
                {"name": "api", "lastState": {"terminated": {"exitCode": 137}}},
                {"name": "sidecar", "lastState": {"terminated": {"exitCode": 1}}},
            ]
        }
        _add_evidence(bundle, "ev.pod.container.status", status_data)

        validator = CrossAgentValidator()
        result = validator.validate(hyp, bundle)
        self.assertFalse(result.approved)
        self.assertIn("exit code was 1", result.reason)


class TestDisagreementResolution(unittest.TestCase):
    """Tests for disagreement resolution and hypothesis re-ranking."""

    def setUp(self) -> None:
        self.validator = CrossAgentValidator(default_downgrade_score=0.2)
        self.bundle = _create_bundle()

    def test_resolve_disagreements_reranks_contradicted_top_hypothesis(self) -> None:
        """Verify contradicted top hypothesis is penalized and demoted below valid hypothesis."""
        hyp_oom = Hypothesis(
            id="hyp-01",
            description="Application OOMKilled due to memory limit under peak load.",
            likelihood=0.92,
            supporting_evidence=["Memory limit set to 256Mi"],
        )
        hyp_panic = Hypothesis(
            id="hyp-02",
            description="Process panic triggered by database schema migration mismatch.",
            likelihood=0.65,
            supporting_evidence=["Panic log in stderr"],
        )
        _add_evidence(self.bundle, "ev.pod.container.status", _make_status_dict(1))

        resolved = self.validator.resolve_disagreements([hyp_oom, hyp_panic], self.bundle)

        self.assertEqual(resolved[0].id, "hyp-02")
        self.assertEqual(resolved[0].likelihood, 0.65)
        self.assertEqual(resolved[1].id, "hyp-01")
        self.assertEqual(resolved[1].likelihood, 0.2)
        self.assertTrue(len(resolved[1].contradicting_evidence) > 0)
        self.assertIn("exit code was 1", resolved[1].contradicting_evidence[0])

    def test_validate_hypotheses_batch(self) -> None:
        """Verify validate_hypotheses returns paired validation results for all items."""
        hyp1 = Hypothesis(id="hyp-01", description="General network latency", likelihood=0.8, supporting_evidence=[])
        hyp2 = Hypothesis(id="hyp-02", description="Container OOMKilled", likelihood=0.7, supporting_evidence=[])

        _add_evidence(self.bundle, "ev.pod.container.status", _make_status_dict(1))

        results = self.validator.validate_hypotheses([hyp1, hyp2], self.bundle)
        self.assertEqual(len(results), 2)
        self.assertTrue(results[0][1].approved)
        self.assertFalse(results[1][1].approved)


class TestValidatorEdgeCases(unittest.TestCase):
    """Tests edge cases, empty bundles, and missing parameters."""

    def test_validate_none_hypothesis_rejected(self) -> None:
        """Verify None hypothesis returns approved=False with zero score."""
        validator = CrossAgentValidator()
        result = validator.validate(None, _create_bundle())
        self.assertFalse(result.approved)
        self.assertEqual(result.confidence_score, 0.0)

    def test_validate_none_bundle_accepted_with_unverified_confidence(self) -> None:
        """Verify None bundle accepts hypothesis gracefully without crashing."""
        validator = CrossAgentValidator()
        hyp = Hypothesis(id="hyp-01", description="Test hypothesis", likelihood=0.75, supporting_evidence=[])
        result = validator.validate(hyp, None)
        self.assertTrue(result.approved)
        self.assertEqual(result.confidence_score, 0.75)


if __name__ == "__main__":
    unittest.main()
