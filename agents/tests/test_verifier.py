"""
Unit Tests for Closed-Loop Workload Verifier — KDM v4.0.0
==========================================================
Validates:
- Successful verification when workload reaches Ready state without restarts.
- Detection of restart regressions post-remediation triggering failure and rollback.
- Identification of CrashLoopBackOff and OOMKilled container failure regressions.
- Excluding pre-remediation historical lastState failures when restart count is stable.
- Timeout handling when workload fails to transition to Ready in allotted duration.
- Support for synchronous and asynchronous status check functions.
- Multi-iteration rollout simulation where workload transitions to Ready after delay.
- Formatted CLI terminal outcome reporting for passed, failed, and timed out runs.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Callable, Dict, List, Optional, Union
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


def _build_container_state(reason: Optional[str]) -> Dict[str, Any]:
    """Map regression reason to container state dict."""
    if reason in ("CrashLoopBackOff", "ContainerCannotRun"):
        return {"waiting": {"reason": reason}}
    if reason in ("OOMKilled", "Error"):
        return {"terminated": {"reason": reason, "exitCode": 137}}
    return {"running": {"startedAt": "2026-10-16T12:00:00Z"}}


def _build_container_status(
    ready: bool,
    restart_count: int = 0,
    **kwargs: Any,
) -> Dict[str, Any]:
    """Construct a container status dictionary with optional state reason."""
    reason = kwargs.get("reason")
    name = kwargs.get("name", "api")
    last_state = kwargs.get("last_state")

    c_dict: Dict[str, Any] = {
        "name": name,
        "ready": ready,
        "restartCount": restart_count,
        "state": _build_container_state(reason),
    }
    if last_state:
        c_dict["lastState"] = last_state
    return c_dict


def _build_flat_status(
    ready: bool = True,
    restart_count: int = 0,
    **kwargs: Any,
) -> Dict[str, Any]:
    """Helper factory for generating flat workload status payloads."""
    payload: Dict[str, Any] = {
        "phase": kwargs.get("phase", "Running"),
        "pod_name": kwargs.get("pod_name", "checkout-api-7d9f"),
        "ready": ready,
        "restart_count": restart_count,
        "memory_usage": kwargs.get("memory_usage"),
        "memory_limit": kwargs.get("memory_limit"),
    }
    if "reason" in kwargs:
        payload["reason"] = kwargs["reason"]
    return payload


class TestWorkloadVerifier(unittest.IsolatedAsyncioTestCase):
    """Test suite for closed-loop WorkloadVerifier engine."""

    async def _execute_verifier(
        self,
        check_target: Union[Dict[str, Any], Callable[[], Any]],
        initial_restarts: int = 0,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Unified runner to eliminate setup duplication across test cases."""
        fn = check_target if callable(check_target) else (lambda: check_target)
        verifier = WorkloadVerifier(
            check_fn=fn,
            poll_interval=0.01,
            rollback_command=kwargs.get("rollback_cmd"),
            print_fn=kwargs.get("print_fn"),
        )
        return await verifier.verify(
            initial_restart_count=initial_restarts,
            timeout=kwargs.get("timeout", 1),
        )

    async def test_pod_transitions_to_ready_verified(self) -> None:
        """Workload that reaches Ready with stable restart count returns verified."""
        status = _build_flat_status(
            ready=True, restart_count=0, memory_usage="180Mi", memory_limit="512Mi"
        )
        result = await self._execute_verifier(status)

        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["message"], "Workload is healthy and Ready.")
        self.assertTrue(result["ready"])
        self.assertEqual(result["restart_count"], 0)
        self.assertEqual(result["details"]["memory_usage"], "180Mi")

    async def test_pod_restarts_again_returns_failed_with_regression(self) -> None:
        """Container restart increment post-remediation returns failed with regression."""
        status = _build_flat_status(ready=False, restart_count=3)
        rollback = "kubectl rollout undo deployment/checkout-api"
        result = await self._execute_verifier(
            status, initial_restarts=2, rollback_cmd=rollback
        )

        self.assertEqual(result["status"], "failed")
        self.assertTrue(result["message"].startswith("Container crashed again post-remediation"))
        self.assertTrue(result["rollback_recommended"])
        self.assertEqual(result["rollback_command"], rollback)
        self.assertEqual(result["restart_count"], 3)

    async def test_verification_timeout_condition(self) -> None:
        """Workload that never reaches Ready returns timed_out status."""
        status = _build_flat_status(ready=False, restart_count=0, phase="Pending")
        result = await self._execute_verifier(status, timeout=0.03)

        self.assertEqual(result["status"], "timed_out")
        self.assertEqual(result["message"], "Workload did not reach Ready within timeout.")
        self.assertFalse(result["ready"])

    async def test_multi_iteration_delayed_readiness(self) -> None:
        """Workload transitioning from pending to ready over multiple polls is verified."""
        call_count = 0

        def check_status() -> Dict[str, Any]:
            nonlocal call_count
            call_count += 1
            return _build_flat_status(ready=(call_count >= 3), restart_count=1)

        result = await self._execute_verifier(check_status, initial_restarts=1)

        self.assertEqual(result["status"], "verified")
        self.assertGreaterEqual(call_count, 3)

    async def test_async_check_fn_support(self) -> None:
        """Verifier supports asynchronous coroutine check_fn callables."""
        async def async_checker() -> Dict[str, Any]:
            await asyncio.sleep(0.001)
            return _build_flat_status(ready=True, restart_count=0)

        result = await self._execute_verifier(async_checker)
        self.assertEqual(result["status"], "verified")

    async def test_regression_reasons_in_container_statuses(self) -> None:
        """Verify CrashLoopBackOff and OOMKilled triggers regression failure."""
        for reason in ("CrashLoopBackOff", "OOMKilled"):
            with self.subTest(reason=reason):
                container = _build_container_status(ready=False, restart_count=1, reason=reason)
                status = {"phase": "Running", "containerStatuses": [container]}
                rollback = "kubectl rollout undo deployment/api"

                result = await self._execute_verifier(
                    status, initial_restarts=1, rollback_cmd=rollback
                )

                self.assertEqual(result["status"], "failed")
                self.assertIn(reason, result["message"])
                self.assertEqual(result["regression"], reason)
                self.assertTrue(result["rollback_recommended"])
                self.assertEqual(result["rollback_command"], rollback)

    async def test_historical_last_state_without_new_restart_does_not_fail(self) -> None:
        """Pre-remediation failure in lastState does not trigger regression when restarts are stable."""
        container = _build_container_status(
            ready=True,
            restart_count=2,
            last_state={"terminated": {"reason": "OOMKilled", "exitCode": 137}},
        )
        status = {"phase": "Running", "containerStatuses": [container]}

        result = await self._execute_verifier(status, initial_restarts=2)
        self.assertEqual(result["status"], "verified")

    async def test_k8s_container_readiness_scenarios(self) -> None:
        """Verify multi-container workloads require all containers ready."""
        scenarios = (
            (True, "verified", 1.0),
            (False, "timed_out", 0.03),
        )
        for second_ready, expected_status, timeout_val in scenarios:
            with self.subTest(second_ready=second_ready):
                status = {
                    "phase": "Running",
                    "containerStatuses": [
                        _build_container_status(ready=True, name="c1"),
                        _build_container_status(ready=second_ready, name="c2"),
                    ],
                }
                result = await self._execute_verifier(status, timeout=timeout_val)
                self.assertEqual(result["status"], expected_status)

    async def test_non_running_pod_phase_fails_verification(self) -> None:
        """Pods in 'Pending' or non-Running state do not verify even if ready flag is True."""
        status = _build_flat_status(ready=True, phase="Pending")
        result = await self._execute_verifier(status, timeout=0.03)
        self.assertEqual(result["status"], "timed_out")

    async def test_terminal_printer_notification(self) -> None:
        """Ensure terminal printer callback receives formatted output upon outcome."""
        printed: List[str] = []
        status = _build_flat_status(
            ready=True, restart_count=0, memory_usage="180Mi", memory_limit="512Mi"
        )
        await self._execute_verifier(status, print_fn=printed.append)

        self.assertEqual(len(printed), 1)
        self.assertIn("Verification Passed", printed[0])
        self.assertIn("checkout-api-7d9f", printed[0])
        self.assertIn("180Mi / 512Mi", printed[0])

    async def test_resilient_error_handling(self) -> None:
        """Verifier handles exceptions inside check_fn gracefully without unhandled crashes."""
        def broken_checker() -> Dict[str, Any]:
            raise ConnectionResetError("Cluster API unavailable")

        result = await self._execute_verifier(broken_checker, timeout=0.03)
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
