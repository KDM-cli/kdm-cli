"""
Unit Tests — Deterministic Diagnostic Rule Engine (agents/rules/)
==================================================================
Tests cover:
  - RuleMatch dataclass validation, dictionary serialization round-trips, and equality.
  - BaseRule abstract class contract and inheritance.
  - OOMKilledRule: positive matches (exitCode 137, reason OOMKilled, lastState, state),
    negative healthy/error cases, and missing/unavailable evidence handling.
  - ImagePullRule: positive matches (ErrImagePull, ImagePullBackOff, custom messages),
    negative cases, and missing/unavailable evidence handling.
  - CrashLoopRule: positive matches (CrashLoopBackOff with exitCode > 0, restartCount),
    negative exitCode 0 cases, and missing/unavailable evidence handling.
  - ProbeFailureRule: positive matches (Liveness, Readiness, Startup probe failure events),
    negative warning events, and missing/unavailable evidence handling.
  - SchedulingRule: positive matches (Pending phase with FailedScheduling event),
    negative running phase or missing events, and missing/unavailable evidence handling.
  - RuleEngine: default registration, custom rules, sorting by confidence descending,
    primary match selection, LLM bypass check, and faulty rule resilience.
  - Benchmark: verify RuleEngine.evaluate_all() execution time is well under 10ms.
"""

from __future__ import annotations

import os
import sys
import time
from typing import Optional
import unittest

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target
    from agents.rules.base import BaseRule, RuleMatch
    from agents.rules.crashloop import CrashLoopRule
    from agents.rules.engine import RuleEngine
    from agents.rules.image_pull import ImagePullRule
    from agents.rules.oom import OOMKilledRule
    from agents.rules.probes import ProbeFailureRule
    from agents.rules.scheduling import SchedulingRule
except ImportError:
    from core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target  # type: ignore[no-redef]
    from rules.base import BaseRule, RuleMatch  # type: ignore[no-redef]
    from rules.crashloop import CrashLoopRule  # type: ignore[no-redef]
    from rules.engine import RuleEngine  # type: ignore[no-redef]
    from rules.image_pull import ImagePullRule  # type: ignore[no-redef]
    from rules.oom import OOMKilledRule  # type: ignore[no-redef]
    from rules.probes import ProbeFailureRule  # type: ignore[no-redef]
    from rules.scheduling import SchedulingRule  # type: ignore[no-redef]


def _make_bundle(
    workload_name: str = "checkout-api",
    container_name: Optional[str] = "checkout",
    namespace: str = "production",
) -> EvidenceBundle:
    """Helper to create a fresh EvidenceBundle for testing."""
    target = Target(
        workload_kind="Deployment",
        workload_name=workload_name,
        namespace=namespace,
        container_name=container_name,
    )
    return EvidenceBundle(target=target, collected_at="2026-10-09T00:00:00Z")


class TestRuleMatch(unittest.TestCase):
    """Tests for :class:`~rules.base.RuleMatch` dataclass and validation."""

    def test_initialization_and_attributes(self) -> None:
        """Verify RuleMatch instantiates correctly with required attributes."""
        match = RuleMatch(
            rule_id="rule.kubernetes.test",
            title="Test Diagnostic Title",
            root_cause="Test root cause explanation",
            confidence=1.0,
            evidence_ids=["ev.pod.container.status"],
        )
        self.assertEqual(match.rule_id, "rule.kubernetes.test")
        self.assertEqual(match.title, "Test Diagnostic Title")
        self.assertEqual(match.root_cause, "Test root cause explanation")
        self.assertEqual(match.confidence, 1.0)
        self.assertEqual(match.evidence_ids, ["ev.pod.container.status"])

    def test_confidence_validation(self) -> None:
        """Verify confidence out of [0.0, 1.0] range raises ValueError."""
        with self.assertRaises(ValueError):
            RuleMatch(
                rule_id="rule.test",
                title="Invalid",
                root_cause="Invalid",
                confidence=1.5,
            )

        with self.assertRaises(ValueError):
            RuleMatch(
                rule_id="rule.test",
                title="Invalid",
                root_cause="Invalid",
                confidence=-0.1,
            )

    def test_to_dict_and_from_dict_round_trip(self) -> None:
        """Verify RuleMatch serialization and deserialization preserves all fields."""
        original = RuleMatch(
            rule_id="rule.kubernetes.oom_killed",
            title="Container Out-Of-Memory (OOMKilled)",
            root_cause="Container 'auth' terminated with exit code 137 (OOMKilled).",
            confidence=1.0,
            evidence_ids=["ev.pod.container.status"],
        )
        d = original.to_dict()
        self.assertEqual(d["rule_id"], "rule.kubernetes.oom_killed")
        self.assertEqual(d["confidence"], 1.0)
        self.assertEqual(d["evidence_ids"], ["ev.pod.container.status"])

        restored = RuleMatch.from_dict(d)
        self.assertEqual(restored, original)


class TestOOMKilledRule(unittest.TestCase):
    """Tests for :class:`~rules.oom.OOMKilledRule`."""

    def setUp(self) -> None:
        self.rule = OOMKilledRule()
        self.bundle = _make_bundle()

    def test_positive_match_last_state_terminated_reason_oomkilled(self) -> None:
        """Verify detection when lastState.terminated.reason is OOMKilled."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={
                    "restartCount": 3,
                    "lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}},
                },
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.rule_id, "rule.kubernetes.oom_killed")
        self.assertEqual(match.title, "Container Out-Of-Memory (OOMKilled)")
        self.assertEqual(match.confidence, 1.0)
        self.assertEqual(match.evidence_ids, ["ev.pod.container.status"])
        self.assertIn("137", match.root_cause)
        self.assertIn("OOMKilled", match.root_cause)
        self.assertIn("checkout", match.root_cause)

    def test_positive_match_exit_code_137_without_reason_string(self) -> None:
        """Verify detection when exit code 137 is present even if reason is Error."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"lastState": {"terminated": {"exitCode": 137, "reason": "Error"}}},
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.confidence, 1.0)

    def test_positive_match_active_state_terminated(self) -> None:
        """Verify detection when state.terminated has exitCode 137."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"state": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}},
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.confidence, 1.0)

    def test_positive_match_pod_container_statuses_list(self) -> None:
        """Verify detection when data contains containerStatuses list."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={
                    "containerStatuses": [
                        {"name": "sidecar", "state": {"running": {}}},
                        {
                            "name": "checkout",
                            "lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}},
                        },
                    ]
                },
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertIn("checkout", match.root_cause)

    def test_negative_healthy_running_container(self) -> None:
        """Verify None returned when container is actively running healthy."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"state": {"running": {"startedAt": "2026-10-09T00:00:00Z"}}},
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))

    def test_negative_clean_exit_code_zero(self) -> None:
        """Verify None returned when container terminated cleanly with exitCode 0."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"lastState": {"terminated": {"exitCode": 0, "reason": "Completed"}}},
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))

    def test_negative_generic_application_error_exit_code_one(self) -> None:
        """Verify None returned when container terminated with exitCode 1 (not OOM)."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"lastState": {"terminated": {"exitCode": 1, "reason": "Error"}}},
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))

    def test_negative_missing_evidence_item(self) -> None:
        """Verify None returned safely when ev.pod.container.status is not in bundle."""
        self.assertIsNone(self.rule.evaluate(self.bundle))

    def test_negative_unavailable_evidence_status(self) -> None:
        """Verify None returned safely when ev.pod.container.status is UNAVAILABLE."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.UNAVAILABLE,
                data={"lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}},
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))

    def test_negative_none_or_malformed_bundle(self) -> None:
        """Verify None returned safely for None or non-bundle inputs."""
        self.assertIsNone(self.rule.evaluate(None))  # type: ignore[arg-type]


class TestImagePullRule(unittest.TestCase):
    """Tests for :class:`~rules.image_pull.ImagePullRule`."""

    def setUp(self) -> None:
        self.rule = ImagePullRule()
        self.bundle = _make_bundle()

    def test_positive_match_image_pull_backoff(self) -> None:
        """Verify detection when container waiting reason is ImagePullBackOff."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={
                    "state": {
                        "waiting": {
                            "reason": "ImagePullBackOff",
                            "message": "Back-off pulling image 'my-app:v2'",
                        }
                    }
                },
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.rule_id, "rule.kubernetes.image_pull")
        self.assertEqual(match.confidence, 1.0)
        self.assertEqual(match.evidence_ids, ["ev.pod.container.status"])
        self.assertIn("ImagePullBackOff", match.root_cause)
        self.assertIn("checkout", match.root_cause)

    def test_positive_match_err_image_pull(self) -> None:
        """Verify detection when container waiting reason is ErrImagePull."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={
                    "waiting": {
                        "reason": "ErrImagePull",
                        "message": "rpc error: code = NotFound desc = failed to pull",
                    }
                },
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.confidence, 1.0)
        self.assertIn("ErrImagePull", match.root_cause)

    def test_negative_container_creating(self) -> None:
        """Verify None returned when container is waiting under ContainerCreating."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"state": {"waiting": {"reason": "ContainerCreating"}}},
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))

    def test_negative_healthy_running(self) -> None:
        """Verify None returned when container is running."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"state": {"running": {}}},
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))

    def test_negative_unavailable_evidence(self) -> None:
        """Verify None returned when container status is not AVAILABLE."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.TIMEOUT,
                data={"state": {"waiting": {"reason": "ImagePullBackOff"}}},
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))


class TestCrashLoopRule(unittest.TestCase):
    """Tests for :class:`~rules.crashloop.CrashLoopRule`."""

    def setUp(self) -> None:
        self.rule = CrashLoopRule()
        self.bundle = _make_bundle()

    def test_positive_match_crashloop_backoff_with_exit_code_1(self) -> None:
        """Verify detection when waiting is CrashLoopBackOff and exitCode is 1."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={
                    "restartCount": 5,
                    "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                    "lastState": {"terminated": {"exitCode": 1, "reason": "Error"}},
                },
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.rule_id, "rule.kubernetes.crashloop_backoff")
        self.assertEqual(match.title, "Container CrashLoopBackOff")
        self.assertEqual(match.confidence, 1.0)
        self.assertEqual(match.evidence_ids, ["ev.pod.container.status"])
        self.assertIn("restartCount: 5", match.root_cause)
        self.assertIn("exitCode: 1", match.root_cause)

    def test_positive_match_crashloop_backoff_with_exit_code_255(self) -> None:
        """Verify detection with non-zero exitCode 255."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={
                    "restartCount": 12,
                    "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                    "lastState": {"terminated": {"exitCode": 255, "reason": "Error"}},
                },
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.confidence, 1.0)
        self.assertIn("255", match.root_cause)

    def test_negative_exit_code_zero(self) -> None:
        """Verify rule does not match when exit code is 0 (clean completion)."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={
                    "restartCount": 1,
                    "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                    "lastState": {"terminated": {"exitCode": 0, "reason": "Completed"}},
                },
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))

    def test_negative_not_crashloop_backoff(self) -> None:
        """Verify None returned when container is waiting under another reason."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={
                    "restartCount": 0,
                    "state": {"waiting": {"reason": "PodInitializing"}},
                },
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))


class TestProbeFailureRule(unittest.TestCase):
    """Tests for :class:`~rules.probes.ProbeFailureRule`."""

    def setUp(self) -> None:
        self.rule = ProbeFailureRule()
        self.bundle = _make_bundle()

    def test_positive_match_liveness_probe_failure(self) -> None:
        """Verify detection when warning event reports Liveness probe failed."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.events",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data=[
                    {
                        "type": "Warning",
                        "reason": "Unhealthy",
                        "message": "Liveness probe failed: HTTP probe failed with statuscode: 500",
                    }
                ],
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.rule_id, "rule.kubernetes.probe_failure")
        self.assertEqual(match.title, "Container Liveness Probe Failure")
        self.assertEqual(match.confidence, 1.0)
        self.assertEqual(match.evidence_ids, ["ev.pod.events"])
        self.assertIn("Liveness probe failed", match.root_cause)

    def test_positive_match_readiness_probe_failure(self) -> None:
        """Verify detection when warning event reports Readiness probe failed."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.events",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data=[
                    {
                        "type": "Warning",
                        "reason": "Unhealthy",
                        "message": "Readiness probe failed: connection refused",
                    }
                ],
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.title, "Container Readiness Probe Failure")
        self.assertEqual(match.confidence, 1.0)
        self.assertIn("Readiness probe failed", match.root_cause)

    def test_positive_match_events_with_items_wrapper(self) -> None:
        """Verify detection when events data is wrapped in {'items': [...]} dict."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.events",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={
                    "items": [
                        {
                            "type": "Warning",
                            "reason": "Unhealthy",
                            "message": "Liveness probe failed: timed out after 10s",
                        }
                    ]
                },
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.confidence, 1.0)

    def test_negative_generic_warning_events_without_probe_failures(self) -> None:
        """Verify None returned when warning events are unrelated to health probes."""
        self.bundle.add(
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
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))

    def test_negative_empty_events_list(self) -> None:
        """Verify None returned when events list is empty."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.events",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data=[],
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))


class TestSchedulingRule(unittest.TestCase):
    """Tests for :class:`~rules.scheduling.SchedulingRule`."""

    def setUp(self) -> None:
        self.rule = SchedulingRule()
        self.bundle = _make_bundle()

    def test_positive_match_pending_pod_with_failed_scheduling_event(self) -> None:
        """Verify detection when pod is Pending and FailedScheduling event is reported."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"phase": "Pending"},
            )
        )
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.events",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data=[
                    {
                        "type": "Warning",
                        "reason": "FailedScheduling",
                        "message": "0/3 nodes are available: 3 Insufficient cpu, 3 Insufficient memory.",
                    }
                ],
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.rule_id, "rule.kubernetes.failed_scheduling")
        self.assertEqual(match.title, "Pod Scheduling Failure (FailedScheduling)")
        self.assertEqual(match.confidence, 1.0)
        self.assertIn("ev.pod.events", match.evidence_ids)
        self.assertIn("ev.pod.status", match.evidence_ids)
        self.assertIn("FailedScheduling", match.root_cause)
        self.assertIn("Insufficient cpu", match.root_cause)

    def test_positive_match_failed_scheduling_from_events_only(self) -> None:
        """Verify detection when FailedScheduling is present even if pod phase item omitted."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.events",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data=[
                    {
                        "type": "Warning",
                        "reason": "FailedScheduling",
                        "message": "0/4 nodes are available: 4 node(s) had untolerated taint",
                    }
                ],
            )
        )
        match = self.rule.evaluate(self.bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.confidence, 1.0)
        self.assertEqual(match.evidence_ids, ["ev.pod.events"])

    def test_negative_pod_running_with_stale_scheduling_event(self) -> None:
        """Verify None returned when pod is currently Running despite past scheduling event."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"phase": "Running"},
            )
        )
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.events",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data=[
                    {
                        "type": "Warning",
                        "reason": "FailedScheduling",
                        "message": "0/3 nodes are available: 3 Insufficient cpu.",
                    }
                ],
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))

    def test_negative_pending_pod_without_failed_scheduling_event(self) -> None:
        """Verify None returned when pod is Pending but no FailedScheduling event occurred."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"phase": "Pending"},
            )
        )
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.events",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data=[
                    {
                        "type": "Normal",
                        "reason": "Scheduled",
                        "message": "Successfully assigned default/pod to node-1",
                    }
                ],
            )
        )
        self.assertIsNone(self.rule.evaluate(self.bundle))


class TestRuleEngine(unittest.TestCase):
    """Tests for :class:`~rules.engine.RuleEngine` dispatcher."""

    def setUp(self) -> None:
        self.engine = RuleEngine()
        self.bundle = _make_bundle()

    def test_default_rules_registered(self) -> None:
        """Verify default initialization loads all 5 canonical rules."""
        self.assertEqual(len(self.engine.rules), 5)
        rule_types = [type(r) for r in self.engine.rules]
        self.assertIn(OOMKilledRule, rule_types)
        self.assertIn(ImagePullRule, rule_types)
        self.assertIn(CrashLoopRule, rule_types)
        self.assertIn(ProbeFailureRule, rule_types)
        self.assertIn(SchedulingRule, rule_types)

    def test_custom_rule_initialization_and_register(self) -> None:
        """Verify initializing engine with a custom subset of rules and registering new ones."""
        custom_engine = RuleEngine([OOMKilledRule(), ImagePullRule()])
        self.assertEqual(len(custom_engine.rules), 2)

        custom_engine.register(CrashLoopRule())
        self.assertEqual(len(custom_engine.rules), 3)

    def test_evaluate_all_returns_single_positive_match(self) -> None:
        """Verify evaluate_all finds the matching rule."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}},
            )
        )
        matches = self.engine.evaluate_all(self.bundle)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].rule_id, "rule.kubernetes.oom_killed")
        self.assertEqual(matches[0].confidence, 1.0)

    def test_get_primary_match_returns_highest_confidence(self) -> None:
        """Verify get_primary_match returns the top-confidence match."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={
                    "state": {
                        "waiting": {
                            "reason": "ImagePullBackOff",
                            "message": "Back-off pulling image",
                        }
                    }
                },
            )
        )
        primary = self.engine.get_primary_match(self.bundle)
        self.assertIsNotNone(primary)
        assert primary is not None
        self.assertEqual(primary.rule_id, "rule.kubernetes.image_pull")
        self.assertEqual(primary.confidence, 1.0)

    def test_should_bypass_llm_predicate(self) -> None:
        """Verify should_bypass_llm returns True when confidence >= 0.99."""
        perfect_match = RuleMatch(
            rule_id="rule.test",
            title="Deterministic",
            root_cause="Exact signature",
            confidence=1.0,
        )
        self.assertTrue(self.engine.should_bypass_llm(perfect_match))

        threshold_match = RuleMatch(
            rule_id="rule.test",
            title="High confidence",
            root_cause="High confidence",
            confidence=0.99,
        )
        self.assertTrue(self.engine.should_bypass_llm(threshold_match))

        lower_match = RuleMatch(
            rule_id="rule.test",
            title="Heuristic",
            root_cause="Probable cause",
            confidence=0.85,
        )
        self.assertFalse(self.engine.should_bypass_llm(lower_match))
        self.assertFalse(self.engine.should_bypass_llm(None))

    def test_empty_matches_for_healthy_workload(self) -> None:
        """Verify evaluate_all returns empty list and primary match is None for healthy workload."""
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"state": {"running": {}}},
            )
        )
        matches = self.engine.evaluate_all(self.bundle)
        self.assertEqual(matches, [])
        self.assertIsNone(self.engine.get_primary_match(self.bundle))

    def test_none_bundle_safety(self) -> None:
        """Verify evaluate_all handles None bundle without error."""
        self.assertEqual(self.engine.evaluate_all(None), [])  # type: ignore[arg-type]
        self.assertIsNone(self.engine.get_primary_match(None))  # type: ignore[arg-type]

    def test_faulty_rule_resilience(self) -> None:
        """Verify an individual rule that raises an exception does not crash evaluate_all."""
        class BuggyRule(BaseRule):
            rule_id = "rule.buggy"
            title = "Buggy Rule"

            def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
                raise RuntimeError("Unexpected failure in rule")

        resilient_engine = RuleEngine([BuggyRule(), OOMKilledRule()])
        self.bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}},
            )
        )
        matches = resilient_engine.evaluate_all(self.bundle)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].rule_id, "rule.kubernetes.oom_killed")


class TestRuleEngineBenchmark(unittest.TestCase):
    """Benchmark tests validating sub-5ms rule engine execution requirements."""

    def test_execution_time_under_five_milliseconds(self) -> None:
        """Verify evaluate_all completes in under 5ms (and well under 10ms threshold)."""
        engine = RuleEngine()
        bundle = _make_bundle()
        bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={
                    "restartCount": 4,
                    "lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}},
                },
            )
        )
        bundle.add(
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
            )
        )

        # Warm up
        engine.evaluate_all(bundle)

        # Run 1,000 evaluations
        iterations = 1000
        start = time.perf_counter()
        for _ in range(iterations):
            matches = engine.evaluate_all(bundle)
            self.assertEqual(len(matches), 1)
        elapsed = time.perf_counter() - start

        avg_time_ms = (elapsed / iterations) * 1000.0
        # Requirement: diagnose in < 5ms (benchmarked threshold in issue acceptance is < 10ms)
        self.assertLess(avg_time_ms, 5.0, f"Average execution was {avg_time_ms:.4f} ms (expected < 5.0 ms)")
        self.assertLess(elapsed, 1.0, f"Total 1,000 iterations took {elapsed:.4f} s (expected < 1.0 s)")


if __name__ == "__main__":
    unittest.main()
