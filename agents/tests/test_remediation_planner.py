"""
Unit Tests — Structured Remediation Planner (Phase 14)
======================================================
Tests cover:
  - Task 14.1: RemediationStep and RemediationPlan dataclasses, validation,
    diff previews, risk level normalization, and to_dict / from_dict.
  - Task 14.2: RemediationPlanner planning across failure classes (OOMKilled,
    CrashLoopBackOff, ImagePullBackOff, and generic consensus fallbacks).
  - Task 14.3: Safe parameter bump calculation logic and robust kubectl
    rollback command generation for every plan.
"""

from __future__ import annotations

import os
import sys
from typing import List, Optional
import unittest

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target
    from agents.remediation.planner import (
        RemediationPlanner,
        WorkloadTargetInfo,
        calculate_memory_bump,
        extract_workload_info,
        generate_rollback_command,
    )
    from agents.remediation.types import (
        RemediationPlan,
        RemediationStep,
        normalize_risk_level,
    )
    from agents.synthesis.consensus import BestSolution, ConsensusDiagnosis
except ImportError:
    from core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target  # type: ignore[no-redef]
    from remediation.planner import (  # type: ignore[no-redef]
        RemediationPlanner,
        WorkloadTargetInfo,
        calculate_memory_bump,
        extract_workload_info,
        generate_rollback_command,
    )
    from remediation.types import (  # type: ignore[no-redef]
        RemediationPlan,
        RemediationStep,
        normalize_risk_level,
    )
    from synthesis.consensus import BestSolution, ConsensusDiagnosis  # type: ignore[no-redef]


def _build_test_bundle(
    workload_name: str = "checkout-api",
    namespace: str = "production",
    workload_kind: str = "deployment",
    memory_limit: Optional[str] = None,
) -> EvidenceBundle:
    """Helper creating a populated EvidenceBundle for planner tests."""
    target = Target(
        workload_kind=workload_kind,
        workload_name=workload_name,
        namespace=namespace,
    )
    bundle = EvidenceBundle(target=target)
    if memory_limit:
        bundle.add(
            EvidenceItem(
                id="ev.resources.limits",
                source="kubernetes_api",
                status=CollectionStatus.AVAILABLE,
                data={"memory": memory_limit},
            )
        )
    return bundle


def _build_test_consensus(
    root_cause: str = "Container terminated with exit code 137 (OOMKilled).",
    risk_level: str = "low",
    command_to_run: Optional[str] = None,
) -> ConsensusDiagnosis:
    """Helper creating a standardized ConsensusDiagnosis for planner tests."""
    solution = BestSolution(
        action_title="Apply Recommended Fix",
        steps=["Review workload status and logs."],
        command_to_run=command_to_run,
        risk_level=risk_level,
    )
    return ConsensusDiagnosis(
        root_cause=root_cause,
        confidence="high",
        findings=[],
        best_solution=solution,
        evidence_citations=["ev.pod.container.status"],
    )


class TestRemediationDataModels(unittest.TestCase):
    """Tests for RemediationStep and RemediationPlan data models."""

    def test_remediation_step_creation_and_defaults(self) -> None:
        """Verify RemediationStep attributes, defaults, and sanitization."""
        step = RemediationStep(
            order=1,
            title="Update container memory limit",
            command="kubectl set resources deployment checkout-api --limits=memory=512Mi -n production",
        )
        self.assertEqual(step.order, 1)
        self.assertEqual(step.title, "Update container memory limit")
        self.assertIn("--limits=memory=512Mi", step.command)
        self.assertIsNone(step.diff_preview)
        self.assertFalse(step.is_destructive)

    def test_remediation_step_serialization_roundtrip(self) -> None:
        """Verify step serialization to_dict and from_dict roundtrip."""
        original = RemediationStep(
            order=2,
            title="Restart workload pods",
            command="kubectl rollout restart deployment/checkout-api -n production",
            diff_preview="- memory: 256Mi\n+ memory: 512Mi",
            is_destructive=True,
        )
        raw = original.to_dict()
        reconstructed = RemediationStep.from_dict(raw)
        self.assertEqual(original, reconstructed)
        self.assertTrue(reconstructed.is_destructive)
        self.assertEqual(reconstructed.diff_preview, "- memory: 256Mi\n+ memory: 512Mi")

    def test_remediation_plan_serialization_roundtrip(self) -> None:
        """Verify RemediationPlan serialization and dictionary reconstruction."""
        step = RemediationStep(
            order=1,
            title="Update limit",
            command="kubectl set resources deployment api --limits=memory=512Mi",
        )
        plan = RemediationPlan(
            plan_id="plan-oom-001",
            target_workload="checkout-api",
            summary="Bump memory limit to 512Mi to prevent OOMKill restarts.",
            risk_level="low",
            steps=[step],
            rollback_command="kubectl rollout undo deployment/checkout-api -n production",
        )
        data = plan.to_dict()
        reconstructed = RemediationPlan.from_dict(data)
        self.assertEqual(plan.plan_id, reconstructed.plan_id)
        self.assertEqual(plan.target_workload, reconstructed.target_workload)
        self.assertEqual(plan.rollback_command, reconstructed.rollback_command)
        self.assertEqual(len(reconstructed.steps), 1)
        self.assertEqual(reconstructed.steps[0].command, step.command)

    def test_risk_level_normalization(self) -> None:
        """Verify risk level string validation against standard tiers."""
        self.assertEqual(normalize_risk_level("LOW"), "low")
        self.assertEqual(normalize_risk_level("medium"), "medium")
        self.assertEqual(normalize_risk_level("HIGH"), "high")
        self.assertEqual(normalize_risk_level("invalid-tier"), "low")
        self.assertEqual(normalize_risk_level(None), "low")


class TestParameterBumpAndRollback(unittest.TestCase):
    """Tests for safe parameter calculation and rollback command generation."""

    def test_memory_bump_standard_values(self) -> None:
        """Verify memory scaling for standard Kubernetes memory units."""
        cases = [
            ("256Mi", 2.0, "256Mi", "512Mi"),
            ("512Mi", 2.0, "512Mi", "1024Mi"),
            ("1Gi", 2.0, "1Gi", "2Gi"),
            ("64Mi", 2.0, "64Mi", "128Mi"),
            ("100Mi", 1.5, "100Mi", "150Mi"),
        ]
        for current, factor, exp_orig, exp_bumped in cases:
            with self.subTest(current=current, factor=factor):
                orig, bumped = calculate_memory_bump(current, factor=factor)
                self.assertEqual(orig, exp_orig)
                self.assertEqual(bumped, exp_bumped)

    def test_memory_bump_edge_cases(self) -> None:
        """Verify memory bump defaults when input is None, empty, or unparseable."""
        orig, bumped = calculate_memory_bump(None)
        self.assertEqual(orig, "256Mi")
        self.assertEqual(bumped, "512Mi")

        orig_bad, bumped_bad = calculate_memory_bump("corrupted-limit")
        self.assertEqual(orig_bad, "256Mi")
        self.assertEqual(bumped_bad, "512Mi")

    def test_generate_rollback_command_scenarios(self) -> None:
        """Verify safe rollback command generation across resource kinds and namespaces."""
        cases = [
            (
                WorkloadTargetInfo("deployment", "checkout-api", "production"),
                "kubectl rollout undo deployment/checkout-api -n production",
            ),
            (
                WorkloadTargetInfo("StatefulSet", "redis-master", "cache"),
                "kubectl rollout undo statefulset/redis-master -n cache",
            ),
            (
                WorkloadTargetInfo("DaemonSet", "node-exporter", "monitoring"),
                "kubectl rollout undo daemonset/node-exporter -n monitoring",
            ),
            (
                WorkloadTargetInfo("deployment", "frontend", ""),
                "kubectl rollout undo deployment/frontend",
            ),
        ]
        for info, expected in cases:
            with self.subTest(kind=info.workload_kind, name=info.workload_name):
                cmd = generate_rollback_command(info)
                self.assertEqual(cmd, expected)

    def test_extract_workload_info(self) -> None:
        """Verify workload coordinate extraction from bundle and fallback."""
        bundle = _build_test_bundle("checkout-api", "production", "deployment")
        info = extract_workload_info(bundle)
        self.assertEqual(info.workload_name, "checkout-api")
        self.assertEqual(info.namespace, "production")
        self.assertEqual(info.workload_kind, "deployment")


class TestRemediationPlanner(unittest.TestCase):
    """Tests for RemediationPlanner end-to-end plan creation."""

    def setUp(self) -> None:
        """Create fresh RemediationPlanner instance."""
        self.planner = RemediationPlanner()

    def _assert_plan_structure(
        self,
        plan: RemediationPlan,
        expected_id: str,
        expected_workload: str,
        expected_risk: str,
        expected_step_count: int,
    ) -> List[str]:
        """Assert core plan metadata and return list of step command strings."""
        self.assertEqual(plan.plan_id, expected_id)
        self.assertEqual(plan.target_workload, expected_workload)
        self.assertEqual(plan.risk_level, expected_risk)
        self.assertEqual(len(plan.steps), expected_step_count)
        self.assertIsNotNone(plan.rollback_command)
        return [step.command for step in plan.steps]

    def test_create_plan_oom_killed_expected_output(self) -> None:
        """Verify exact expected output matching Issue #285 specification."""
        bundle = _build_test_bundle("checkout-api", "production", memory_limit="256Mi")
        consensus = _build_test_consensus("Container terminated with exit code 137 (OOMKilled).")

        plan = self.planner.create_plan(consensus, bundle)

        self.assertEqual(plan.plan_id, "plan-oom-001")
        self.assertEqual(plan.target_workload, "checkout-api")
        self.assertEqual(plan.summary, "Bump memory limit to 512Mi to prevent OOMKill restarts.")
        self.assertEqual(plan.risk_level, "low")
        self.assertEqual(len(plan.steps), 1)

        step = plan.steps[0]
        self.assertEqual(step.order, 1)
        self.assertEqual(step.title, "Update container memory limit")
        self.assertEqual(
            step.command,
            "kubectl set resources deployment checkout-api --limits=memory=512Mi -n production",
        )
        self.assertEqual(step.diff_preview, "- memory: 256Mi\n+ memory: 512Mi")
        self.assertFalse(step.is_destructive)

        self.assertEqual(
            plan.rollback_command,
            "kubectl rollout undo deployment/checkout-api -n production",
        )

    def test_create_plan_crashloop_backoff(self) -> None:
        """Verify plan generation for CrashLoopBackOff failure scenario."""
        bundle = _build_test_bundle("auth-service", "staging")
        consensus = _build_test_consensus("Container restarting repeatedly in CrashLoopBackOff.")
        plan = self.planner.create_plan(consensus, bundle)

        cmds = self._assert_plan_structure(plan, "plan-crashloop-001", "auth-service", "medium", 3)
        self.assertTrue(any("kubectl logs" in c for c in cmds))
        self.assertTrue(any("kubectl set env" in c for c in cmds))
        self.assertTrue(any("kubectl rollout restart" in c for c in cmds))
        self.assertIn("-n staging", plan.rollback_command or "")

    def test_create_plan_image_pull_backoff(self) -> None:
        """Verify plan generation for ImagePullBackOff failure scenario."""
        bundle = _build_test_bundle("payment-gw", "production")
        consensus = _build_test_consensus("Failed to pull container image: ImagePullBackOff.")
        plan = self.planner.create_plan(consensus, bundle)

        cmds = self._assert_plan_structure(plan, "plan-imagepull-001", "payment-gw", "low", 2)
        self.assertTrue(any("kubectl set image" in c for c in cmds))
        self.assertTrue(any("kubectl create secret" in c for c in cmds))
        self.assertIn("-n production", plan.rollback_command or "")

    def test_create_plan_from_consensus_best_solution(self) -> None:
        """Verify planner translates arbitrary BestSolution into structured plan."""
        bundle = _build_test_bundle("ingress-controller", "kube-system")
        consensus = _build_test_consensus(
            root_cause="Node pressure eviction alert.",
            risk_level="high",
            command_to_run="kubectl drain node-1 --ignore-daemonsets",
        )

        plan = self.planner.create_plan(consensus, bundle)
        cmds = self._assert_plan_structure(plan, "plan-generic-001", "ingress-controller", "high", 1)
        self.assertEqual(cmds[0], "kubectl drain node-1 --ignore-daemonsets")
        self.assertIn("kubectl rollout undo", plan.rollback_command or "")

    def test_create_plan_with_custom_plan_id(self) -> None:
        """Verify custom plan_id parameter overrides auto-generated identifier."""
        bundle = _build_test_bundle("checkout-api", "production")
        consensus = _build_test_consensus("OOMKilled memory limit exceeded.")

        plan = self.planner.create_plan(consensus, bundle, plan_id="custom-plan-999")
        self.assertEqual(plan.plan_id, "custom-plan-999")

    def test_create_plan_with_dict_payloads(self) -> None:
        """Verify planner accepts dictionary representations of consensus and bundle."""
        bundle_dict = {
            "target": {
                "workload_name": "cart-service",
                "namespace": "ecommerce",
                "workload_kind": "deployment",
            }
        }
        consensus_dict = {
            "root_cause": "Container terminated with exit code 137 (OOMKilled).",
            "confidence": "high",
        }
        plan = self.planner.create_plan(consensus_dict, bundle_dict)
        self.assertEqual(plan.target_workload, "cart-service")
        self.assertIn("ecommerce", plan.rollback_command or "")
        self.assertEqual(plan.risk_level, "low")

    def test_create_plan_without_bundle_graceful_fallback(self) -> None:
        """Verify planner functions cleanly when bundle is omitted."""
        consensus = "deployment/order-api failed with exit code 137 (OOMKilled)"
        plan = self.planner.create_plan(consensus, bundle=None)

        self.assertEqual(plan.target_workload, "order-api")
        self.assertIsNotNone(plan.rollback_command)
        self.assertIn("order-api", plan.rollback_command or "")

    def test_package_exports_and_plan_context(self) -> None:
        """Verify agents.remediation exposes expected classes and PlanContext."""
        try:
            import agents.remediation as rem
        except ImportError:
            import remediation as rem  # type: ignore[no-redef]

        self.assertTrue(hasattr(rem, "RemediationPlan"))
        self.assertTrue(hasattr(rem, "RemediationStep"))
        self.assertTrue(hasattr(rem, "RemediationPlanner"))
        self.assertTrue(hasattr(rem, "PlanContext"))
        self.assertTrue(hasattr(rem, "calculate_memory_bump"))
        self.assertTrue(hasattr(rem, "generate_rollback_command"))

        ctx = rem.PlanContext(
            info=rem.WorkloadTargetInfo(workload_name="api"),
            plan_id="plan-test-001",
        )
        self.assertEqual(ctx.plan_id, "plan-test-001")
        self.assertEqual(ctx.info.workload_name, "api")


if __name__ == "__main__":
    unittest.main()
