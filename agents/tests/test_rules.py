"""
Unit Tests — Deterministic Diagnostic Rule Engine (agents/rules/)
==================================================================
Tests cover:
  - RuleMatch dataclass validation, dictionary serialization round-trips, and equality.
  - BaseRule abstract class contract and inheritance.
  - Canonical Kubernetes rules (OOMKilled, ImagePull, CrashLoop, ProbeFailure, Scheduling).
  - Target-container sidecar isolation and accurate confidence scoring.
  - RuleEngine dispatcher registration, sorting, bypass predicates, and logging resilience.
  - Performance benchmarking validating sub-5ms rule evaluation.
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any, Optional
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


def _add_evidence(
    bundle: EvidenceBundle,
    item_id: str,
    data: Any,
    status: CollectionStatus = CollectionStatus.AVAILABLE,
) -> None:
    """Helper to populate an evidence item into a bundle."""
    bundle.add(
        EvidenceItem(
            id=item_id,
            source="kubernetes_api",
            status=status,
            data=data,
        )
    )


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
        for invalid_conf in (1.5, -0.1, 2.0):
            with self.subTest(invalid_conf=invalid_conf):
                with self.assertRaises(ValueError):
                    RuleMatch(
                        rule_id="rule.test",
                        title="Invalid",
                        root_cause="Invalid",
                        confidence=invalid_conf,
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
        self.assertEqual(RuleMatch.from_dict(d), original)


class TestKubernetesRules(unittest.TestCase):
    """Parameterized test suite covering canonical Kubernetes failure rules."""

    def test_oom_rule_scenarios(self) -> None:
        """Verify OOMKilledRule handles positive, negative, and sidecar isolation cases."""
        rule = OOMKilledRule()

        scenarios = [
            (
                "last_state_oomkilled",
                {"lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}},
                True,
                1.0,
            ),
            (
                "active_state_oomkilled",
                {"state": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}},
                True,
                1.0,
            ),
            (
                "exit_code_137_only_lower_confidence",
                {"lastState": {"terminated": {"exitCode": 137, "reason": "Error"}}},
                True,
                0.8,
            ),
            (
                "healthy_running",
                {"state": {"running": {}}},
                False,
                0.0,
            ),
            (
                "clean_exit_0",
                {"lastState": {"terminated": {"exitCode": 0, "reason": "Completed"}}},
                False,
                0.0,
            ),
            (
                "error_exit_1",
                {"lastState": {"terminated": {"exitCode": 1, "reason": "Error"}}},
                False,
                0.0,
            ),
        ]

        for case_name, data, should_match, exp_conf in scenarios:
            with self.subTest(case_name=case_name):
                bundle = _make_bundle()
                _add_evidence(bundle, "ev.pod.container.status", data)
                match = rule.evaluate(bundle)
                if should_match:
                    self.assertIsNotNone(match)
                    assert match is not None
                    self.assertEqual(match.confidence, exp_conf)
                    self.assertEqual(match.evidence_ids, ["ev.pod.container.status"])
                else:
                    self.assertIsNone(match)

        # Test sidecar isolation: target container 'checkout' is healthy while sidecar is OOM
        sidecar_bundle = _make_bundle(container_name="checkout")
        _add_evidence(
            sidecar_bundle,
            "ev.pod.container.status",
            {
                "containerStatuses": [
                    {"name": "checkout", "state": {"running": {}}},
                    {"name": "istio-proxy", "lastState": {"terminated": {"reason": "OOMKilled", "exitCode": 137}}},
                ]
            },
        )
        self.assertIsNone(rule.evaluate(sidecar_bundle))

        # Test unavailable evidence handling
        unavail_bundle = _make_bundle()
        _add_evidence(unavail_bundle, "ev.pod.container.status", {}, status=CollectionStatus.UNAVAILABLE)
        self.assertIsNone(rule.evaluate(unavail_bundle))
        self.assertIsNone(rule.evaluate(None))  # type: ignore[arg-type]

    def test_image_pull_rule_scenarios(self) -> None:
        """Verify ImagePullRule matches ErrImagePull/ImagePullBackOff and isolates sidecars."""
        rule = ImagePullRule()

        scenarios = [
            (
                "image_pull_backoff",
                {"state": {"waiting": {"reason": "ImagePullBackOff", "message": "Back-off pulling image"}}},
                True,
            ),
            (
                "err_image_pull",
                {"waiting": {"reason": "ErrImagePull", "message": "rpc error: NotFound"}},
                True,
            ),
            (
                "container_creating",
                {"state": {"waiting": {"reason": "ContainerCreating"}}},
                False,
            ),
            (
                "healthy_running",
                {"state": {"running": {}}},
                False,
            ),
        ]

        for case_name, data, should_match in scenarios:
            with self.subTest(case_name=case_name):
                bundle = _make_bundle()
                _add_evidence(bundle, "ev.pod.container.status", data)
                match = rule.evaluate(bundle)
                if should_match:
                    self.assertIsNotNone(match)
                    assert match is not None
                    self.assertEqual(match.confidence, 1.0)
                    self.assertEqual(match.evidence_ids, ["ev.pod.container.status"])
                else:
                    self.assertIsNone(match)

        # Sidecar isolation: target healthy, sidecar pulling failed -> None
        sidecar_bundle = _make_bundle(container_name="checkout")
        _add_evidence(
            sidecar_bundle,
            "ev.pod.container.status",
            {
                "containerStatuses": [
                    {"name": "checkout", "state": {"running": {}}},
                    {"name": "sidecar", "state": {"waiting": {"reason": "ImagePullBackOff"}}},
                ]
            },
        )
        self.assertIsNone(rule.evaluate(sidecar_bundle))

    def test_crashloop_rule_scenarios(self) -> None:
        """Verify CrashLoopRule matches exitCode > 0 and isolates sidecars."""
        rule = CrashLoopRule()

        scenarios = [
            (
                "exit_1",
                {
                    "restartCount": 4,
                    "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                    "lastState": {"terminated": {"exitCode": 1}},
                },
                True,
            ),
            (
                "exit_255",
                {
                    "restartCount": 10,
                    "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                    "lastState": {"terminated": {"exitCode": 255}},
                },
                True,
            ),
            (
                "exit_0_clean",
                {
                    "restartCount": 1,
                    "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                    "lastState": {"terminated": {"exitCode": 0}},
                },
                False,
            ),
            (
                "missing_exit_code",
                {
                    "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                    "lastState": {"terminated": {}},
                },
                False,
            ),
            (
                "unparseable_exit_code",
                {
                    "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                    "lastState": {"terminated": {"exitCode": "invalid"}},
                },
                False,
            ),
            (
                "negative_exit_code",
                {
                    "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                    "lastState": {"terminated": {"exitCode": -1}},
                },
                False,
            ),
            (
                "pod_initializing",
                {
                    "state": {"waiting": {"reason": "PodInitializing"}},
                },
                False,
            ),
        ]

        for case_name, data, should_match in scenarios:
            with self.subTest(case_name=case_name):
                bundle = _make_bundle()
                _add_evidence(bundle, "ev.pod.container.status", data)
                match = rule.evaluate(bundle)
                if should_match:
                    self.assertIsNotNone(match)
                    assert match is not None
                    self.assertEqual(match.confidence, 1.0)
                    self.assertEqual(match.evidence_ids, ["ev.pod.container.status"])
                else:
                    self.assertIsNone(match)

        # Sidecar isolation
        sidecar_bundle = _make_bundle(container_name="checkout")
        _add_evidence(
            sidecar_bundle,
            "ev.pod.container.status",
            {
                "containerStatuses": [
                    {"name": "checkout", "state": {"running": {}}},
                    {
                        "name": "metrics",
                        "state": {"waiting": {"reason": "CrashLoopBackOff"}},
                        "lastState": {"terminated": {"exitCode": 1}},
                    },
                ]
            },
        )
        self.assertIsNone(rule.evaluate(sidecar_bundle))

    def test_probe_failure_rule_scenarios(self) -> None:
        """Verify ProbeFailureRule matches Liveness, Readiness, and Startup failures."""
        rule = ProbeFailureRule()

        scenarios = [
            ("liveness", [{"type": "Warning", "message": "Liveness probe failed: HTTP 500"}], True),
            ("readiness", [{"type": "Warning", "message": "Readiness probe failed: connection refused"}], True),
            ("startup", [{"type": "Warning", "message": "Startup probe failed: timeout"}], True),
            ("items_dict", {"items": [{"type": "Warning", "message": "Liveness probe failed: timeout"}]}, True),
            ("generic_warning", [{"type": "Warning", "message": "Back-off restarting failed container"}], False),
            ("empty_events", [], False),
        ]

        for case_name, data, should_match in scenarios:
            with self.subTest(case_name=case_name):
                bundle = _make_bundle()
                _add_evidence(bundle, "ev.pod.events", data)
                match = rule.evaluate(bundle)
                if should_match:
                    self.assertIsNotNone(match)
                    assert match is not None
                    self.assertEqual(match.confidence, 1.0)
                    self.assertEqual(match.evidence_ids, ["ev.pod.events"])
                else:
                    self.assertIsNone(match)

    def test_scheduling_rule_scenarios(self) -> None:
        """Verify SchedulingRule matches FailedScheduling under Pending phase."""
        rule = SchedulingRule()

        # Positive: Pending phase + FailedScheduling event
        p_bundle = _make_bundle()
        _add_evidence(p_bundle, "ev.pod.status", {"phase": "Pending"})
        _add_evidence(p_bundle, "ev.pod.events", [{"reason": "FailedScheduling", "message": "0/3 nodes available"}])
        match = rule.evaluate(p_bundle)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.confidence, 1.0)
        self.assertIn("ev.pod.events", match.evidence_ids)
        self.assertIn("ev.pod.status", match.evidence_ids)

        # Positive: events only
        e_bundle = _make_bundle()
        _add_evidence(e_bundle, "ev.pod.events", [{"reason": "FailedScheduling", "message": "0/3 nodes available"}])
        self.assertIsNotNone(rule.evaluate(e_bundle))

        # Negative: Running phase with stale scheduling event
        r_bundle = _make_bundle()
        _add_evidence(r_bundle, "ev.pod.status", {"phase": "Running"})
        _add_evidence(r_bundle, "ev.pod.events", [{"reason": "FailedScheduling", "message": "0/3 nodes available"}])
        self.assertIsNone(rule.evaluate(r_bundle))

        # Negative: Pending phase without FailedScheduling event
        no_event_bundle = _make_bundle()
        _add_evidence(no_event_bundle, "ev.pod.status", {"phase": "Pending"})
        _add_evidence(no_event_bundle, "ev.pod.events", [{"reason": "Scheduled", "message": "Assigned to node-1"}])
        self.assertIsNone(rule.evaluate(no_event_bundle))

        # Verify ev.pod.container.status does not supply phase (per review comment)
        cs_bundle = _make_bundle()
        _add_evidence(cs_bundle, "ev.pod.container.status", {"phase": "Running"})
        _add_evidence(cs_bundle, "ev.pod.events", [{"reason": "FailedScheduling", "message": "0/3 nodes"}])
        # Since ev.pod.container.status is not queried, phase is not found, so it matches on event
        self.assertIsNotNone(rule.evaluate(cs_bundle))


class TestRuleEngine(unittest.TestCase):
    """Tests for :class:`~rules.engine.RuleEngine` dispatcher."""

    def test_engine_dispatch_and_bypass(self) -> None:
        """Verify rule registration, evaluation, sorting, and bypass predicate."""
        engine = RuleEngine()
        self.assertEqual(len(engine.rules), 5)

        custom = RuleEngine([OOMKilledRule(), ImagePullRule()])
        self.assertEqual(len(custom.rules), 2)
        custom.register(CrashLoopRule())
        self.assertEqual(len(custom.rules), 3)

        bundle = _make_bundle()
        _add_evidence(
            bundle,
            "ev.pod.container.status",
            {"lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}},
        )
        matches = engine.evaluate_all(bundle)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].rule_id, "rule.kubernetes.oom_killed")

        primary = engine.get_primary_match(bundle)
        self.assertIsNotNone(primary)
        assert primary is not None
        self.assertEqual(primary.rule_id, "rule.kubernetes.oom_killed")
        self.assertTrue(engine.should_bypass_llm(primary))

        # Test predicate thresholds
        self.assertTrue(engine.should_bypass_llm(RuleMatch("r", "t", "rc", 0.99)))
        self.assertFalse(engine.should_bypass_llm(RuleMatch("r", "t", "rc", 0.95)))
        self.assertFalse(engine.should_bypass_llm(None))

    def test_engine_resilience_and_logging(self) -> None:
        """Verify engine catches rule exceptions, logs them with rule_id, and continues."""
        class FailingRule(BaseRule):
            rule_id = "rule.faulty"
            title = "Faulty"

            def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
                raise RuntimeError("Exploding rule")

        engine = RuleEngine([FailingRule(), OOMKilledRule()])
        bundle = _make_bundle()
        _add_evidence(
            bundle,
            "ev.pod.container.status",
            {"lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}},
        )

        with self.assertLogs(level="ERROR") as cm:
            matches = engine.evaluate_all(bundle)
            self.assertEqual(len(matches), 1)
            self.assertEqual(matches[0].rule_id, "rule.kubernetes.oom_killed")
            self.assertTrue(any("rule.faulty" in log_msg for log_msg in cm.output))

        # Safe on empty or None bundle
        self.assertEqual(engine.evaluate_all(None), [])  # type: ignore[arg-type]
        self.assertIsNone(engine.get_primary_match(None))  # type: ignore[arg-type]


class TestRuleEngineBenchmark(unittest.TestCase):
    """Benchmark tests validating sub-5ms rule engine execution requirements."""

    def test_execution_time_under_five_milliseconds(self) -> None:
        """Verify evaluate_all completes in under 5ms (and well under 10ms threshold)."""
        engine = RuleEngine()
        bundle = _make_bundle()
        _add_evidence(
            bundle,
            "ev.pod.container.status",
            {"restartCount": 4, "lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}},
        )
        _add_evidence(
            bundle,
            "ev.pod.events",
            [{"type": "Warning", "reason": "BackOff", "message": "Back-off restarting"}],
        )

        # Warm up
        engine.evaluate_all(bundle)

        iterations = 1000
        start = time.perf_counter()
        for _ in range(iterations):
            matches = engine.evaluate_all(bundle)
            self.assertEqual(len(matches), 1)
        elapsed = time.perf_counter() - start

        avg_time_ms = (elapsed / iterations) * 1000.0
        self.assertLess(avg_time_ms, 5.0, f"Average execution was {avg_time_ms:.4f} ms (expected < 5.0 ms)")
        self.assertLess(elapsed, 1.0, f"Total 1,000 iterations took {elapsed:.4f} s (expected < 1.0 s)")


if __name__ == "__main__":
    unittest.main()
