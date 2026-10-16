"""
Unit Tests for Closed-Loop Workload Verifier — KDM v4.0.0
==========================================================
Validates:
- Successful verification when workload reaches Ready state without restarts.
- Detection of restart regressions post-remediation triggering failure and rollback.
- Identification of CrashLoopBackOff and OOMKilled container failure regressions.
- Timeout handling when workload fails to transition to Ready in allotted duration.
- Support for synchronous and asynchronous status check functions.
- Multi-iteration rollout simulation where workload transitions to Ready after delay.
- Formatted CLI terminal outcome reporting for passed, failed, and timed out runs.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List, Optional
import unittest

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.remediation.verifier import (
        CRASH_REGRESSION_REASONS,
        WorkloadVerifier,
        format_verification_result,
    )
except ImportError:
    from remediation.verifier import (  # type: ignore[no-redef]
        CRASH_REGRESSION_REASONS,
        WorkloadVerifier,
        format_verification_result,
    )


def _build_status(
    ready: bool = True,
    restart_count: int = 0,
    phase: str = "Running",
    pod_name: str = "checkout-api-7d9f",
    reason: Optional[str] = None,
    as_containers: bool = False,
    memory_usage: Optional[str] = None,
    memory_limit: Optional[str] = None,
) -> Dict[str, Any]:
    """Helper factory for generating standardized workload status payloads."""
    base: Dict[str, Any] = {
        "phase": phase,
        "pod_name": pod_name,
        "memory_usage": memory_usage,
        "memory_limit": memory_limit,
    }

    if as_containers:
        container_state: Dict[str, Any] = {}
        if reason in ("CrashLoopBackOff", "ContainerCannotRun"):
            container_state = {"waiting": {"reason": reason}}
        elif reason in ("OOMKilled", "Error"):
            container_state = {"terminated": {"reason": reason, "exitCode": 137}}
        else:
            container_state = {"running": {"startedAt": "2026-10-16T12:00:00Z"}}

        base["containerStatuses"] = [
            {
                "name": "api",
                "ready": ready,
                "restartCount": restart_count,
                "state": container_state,
            }
        ]
        return base

    base["ready"] = ready
    base["restart_count"] = restart_count
    if reason:
        base["reason"] = reason
    return base


class TestWorkloadVerifier(unittest.IsolatedAsyncioTestCase):
    """Test suite for closed-loop WorkloadVerifier engine."""

    async def test_pod_transitions_to_ready_verified(self) -> None:
        """Workload that reaches Ready with stable restart count returns verified."""
        status = _build_status(ready=True, restart_count=0, memory_usage="180Mi", memory_limit="512Mi")
        verifier = WorkloadVerifier(check_fn=lambda: status, poll_interval=0.01)

        result = await verifier.verify(initial_restart_count=0, timeout=1)

        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["message"], "Workload is healthy and Ready.")
        self.assertTrue(result["ready"])
        self.assertEqual(result["restart_count"], 0)
        self.assertIn("180Mi", result["details"]["memory_usage"])

    async def test_pod_restarts_again_returns_failed_with_regression(self) -> None:
        """Container restart increment post-remediation returns failed with regression."""
        status = _build_status(ready=False, restart_count=3)
        verifier = WorkloadVerifier(
            check_fn=lambda: status,
            poll_interval=0.01,
            rollback_command="kubectl rollout undo deployment/checkout-api",
        )

        result = await verifier.verify(initial_restart_count=2, timeout=1)

        self.assertEqual(result["status"], "failed")
        self.assertTrue(result["message"].startswith("Container crashed again post-remediation"))
        self.assertTrue(result["rollback_recommended"])
        self.assertEqual(result["rollback_command"], "kubectl rollout undo deployment/checkout-api")
        self.assertEqual(result["restart_count"], 3)

    async def test_verification_timeout_condition(self) -> None:
        """Workload that never reaches Ready returns timed_out status."""
        status = _build_status(ready=False, restart_count=0, phase="Pending")
        verifier = WorkloadVerifier(check_fn=lambda: status, poll_interval=0.01)

        result = await verifier.verify(initial_restart_count=0, timeout=0.03)

        self.assertEqual(result["status"], "timed_out")
        self.assertEqual(result["message"], "Workload did not reach Ready within timeout.")
        self.assertFalse(result["ready"])

    async def test_multi_iteration_delayed_readiness(self) -> None:
        """Workload transitioning from pending to ready over multiple polls is verified."""
        call_count = 0

        def check_status() -> Dict[str, Any]:
            nonlocal call_count
            call_count += 1
            is_ready = call_count >= 3
            return _build_status(ready=is_ready, restart_count=1)

        verifier = WorkloadVerifier(check_fn=check_status, poll_interval=0.01)
        result = await verifier.verify(initial_restart_count=1, timeout=1)

        self.assertEqual(result["status"], "verified")
        self.assertGreaterEqual(call_count, 3)

    async def test_async_check_fn_support(self) -> None:
        """Verifier supports asynchronous coroutine check_fn callables."""
        async def async_checker() -> Dict[str, Any]:
            await asyncio.sleep(0.001)
            return _build_status(ready=True, restart_count=0)

        verifier = WorkloadVerifier(check_fn=async_checker, poll_interval=0.01)
        result = await verifier.verify(initial_restart_count=0, timeout=1)

        self.assertEqual(result["status"], "verified")

    async def test_regression_reasons_in_container_statuses(self) -> None:
        """Verify CrashLoopBackOff and OOMKilled triggers regression failure."""
        test_cases = [
            ("CrashLoopBackOff", "waiting"),
            ("OOMKilled", "terminated"),
        ]

        for reason, _ in test_cases:
            with self.subTest(reason=reason):
                status = _build_status(
                    ready=False,
                    restart_count=1,
                    reason=reason,
                    as_containers=True,
                )
                verifier = WorkloadVerifier(
                    check_fn=lambda s=status: s,
                    poll_interval=0.01,
                    rollback_command="kubectl rollout undo deployment/api",
                )

                result = await verifier.verify(initial_restart_count=1, timeout=1)

                self.assertEqual(result["status"], "failed")
                self.assertIn(reason, result["message"])
                self.assertEqual(result["regression"], reason)
                self.assertTrue(result["rollback_recommended"])
                self.assertEqual(result["rollback_command"], "kubectl rollout undo deployment/api")

    async def test_k8s_container_statuses_all_ready(self) -> None:
        """Verify k8s containerStatuses array requires all containers ready."""
        status = {
            "phase": "Running",
            "containerStatuses": [
                {"name": "c1", "ready": True, "restartCount": 0},
                {"name": "c2", "ready": True, "restartCount": 0},
            ],
        }
        verifier = WorkloadVerifier(check_fn=lambda: status, poll_interval=0.01)
        result = await verifier.verify(initial_restart_count=0, timeout=1)

        self.assertEqual(result["status"], "verified")

    async def test_k8s_container_statuses_partial_ready_not_verified(self) -> None:
        """When one of multiple containers is not ready, workload does not verify immediately."""
        status = {
            "phase": "Running",
            "containerStatuses": [
                {"name": "c1", "ready": True, "restartCount": 0},
                {"name": "c2", "ready": False, "restartCount": 0},
            ],
        }
        verifier = WorkloadVerifier(check_fn=lambda: status, poll_interval=0.01)
        result = await verifier.verify(initial_restart_count=0, timeout=0.03)

        self.assertEqual(result["status"], "timed_out")

    async def test_non_running_pod_phase_fails_verification(self) -> None:
        """Pods in 'Pending' or non-Running state do not verify even if ready flag is True."""
        status = _build_status(ready=True, restart_count=0, phase="Pending")
        verifier = WorkloadVerifier(check_fn=lambda: status, poll_interval=0.01)
        result = await verifier.verify(initial_restart_count=0, timeout=0.03)

        self.assertEqual(result["status"], "timed_out")

    async def test_terminal_printer_notification(self) -> None:
        """Ensure terminal printer callback receives formatted output upon outcome."""
        printed: List[str] = []
        status = _build_status(ready=True, restart_count=0, memory_usage="180Mi", memory_limit="512Mi")
        verifier = WorkloadVerifier(
            check_fn=lambda: status,
            poll_interval=0.01,
            print_fn=printed.append,
        )

        await verifier.verify(initial_restart_count=0, timeout=1)

        self.assertEqual(len(printed), 1)
        self.assertIn("Verification Passed", printed[0])
        self.assertIn("checkout-api-7d9f", printed[0])
        self.assertIn("180Mi / 512Mi", printed[0])

    async def test_resilient_error_handling(self) -> None:
        """Verifier handles exceptions inside check_fn gracefully without unhandled crashes."""
        def broken_checker() -> Dict[str, Any]:
            raise ConnectionResetError("Cluster API unavailable")

        verifier = WorkloadVerifier(check_fn=broken_checker, poll_interval=0.01)
        result = await verifier.verify(initial_restart_count=0, timeout=0.03)

        self.assertEqual(result["status"], "timed_out")

    def test_format_verification_result_variants(self) -> None:
        """Verify format_verification_result produces expected CLI text for each state."""
        verified_out = format_verification_result({
            "status": "verified",
            "pod_name": "checkout-api-7d9f",
            "restart_count": 0,
            "details": {"memory_usage": "180Mi", "memory_limit": "512Mi"},
        })
        self.assertIn("✓ Verification Passed:", verified_out)
        self.assertIn("Pod checkout-api-7d9f is 1/1 Ready", verified_out)
        self.assertIn("Zero restarts detected since patch", verified_out)
        self.assertIn("Memory usage: 180Mi / 512Mi (healthy)", verified_out)

        failed_out = format_verification_result({
            "status": "failed",
            "message": "Container crashed again post-remediation: CrashLoopBackOff detected.",
            "rollback_command": "kubectl rollout undo deployment/checkout-api",
        })
        self.assertIn("✖ Verification Failed:", failed_out)
        self.assertIn("CrashLoopBackOff detected", failed_out)
        self.assertIn("Recommended Rollback: kubectl rollout undo", failed_out)

        timeout_out = format_verification_result({
            "status": "timed_out",
            "message": "Workload did not reach Ready within timeout.",
        })
        self.assertIn("✖ Verification Timed Out:", timeout_out)

    def test_constants_and_defaults(self) -> None:
        """Verify crash regression constants include expected failures."""
        self.assertIn("CrashLoopBackOff", CRASH_REGRESSION_REASONS)
        self.assertIn("OOMKilled", CRASH_REGRESSION_REASONS)


if __name__ == "__main__":
    unittest.main()
