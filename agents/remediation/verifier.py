"""
Closed-Loop Workload Verifier — KDM v4.0.0
==========================================
Actively polls cluster workload state post-remediation to verify containers
reach 'Ready' status without regressions, restarts, or crash loops.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import inspect
from typing import Any, Callable, Dict, List, Optional, Tuple

CRASH_REGRESSION_REASONS: Tuple[str, ...] = (
    "CrashLoopBackOff",
    "OOMKilled",
    "Error",
    "ContainerCannotRun",
)


@dataclass
class PodStatusFacts:
    """Extracted snapshot facts from a pod/container health check.

    Attributes:
        phase: Pod lifecycle phase (e.g. 'Running', 'Pending', 'Failed').
        ready: Whether all required containers are in Ready state.
        restart_count: Cumulative restart count across target containers.
        pod_name: Identifier of the pod being verified.
        regression_reason: Specific detected failure regression if any.
        memory_usage: Observable memory usage string (e.g. '180Mi').
        memory_limit: Observable memory limit string (e.g. '512Mi').
        details: Raw status dictionary payload for debugging.
    """

    phase: Optional[str] = None
    ready: bool = False
    restart_count: int = 0
    pod_name: Optional[str] = None
    regression_reason: Optional[str] = None
    memory_usage: Optional[str] = None
    memory_limit: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)


class WorkloadVerifier:
    """Closed-loop verification engine for remediated workloads.

    Actively polls cluster container health over a defined timeout interval
    to confirm that:
    1. The pod phase is 'Running'.
    2. All target container(s) are 'Ready' (containerStatuses[].ready == True).
    3. The container restartCount has not incremented since remediation started.
    4. No failure regressions (e.g. CrashLoopBackOff, OOMKilled) have occurred.
    """

    def __init__(
        self,
        check_fn: Callable[[], Any],
        poll_interval: float = 5.0,
        rollback_command: Optional[str] = None,
        print_fn: Optional[Callable[[str], None]] = None,
    ) -> None:
        """Initialize the workload verifier.

        :param check_fn: Callable returning container/pod status dict or awaitable coroutine.
        :param poll_interval: Polling frequency in seconds (default: 5s).
        :param rollback_command: Optional rollback instruction to recommend on regression.
        :param print_fn: Optional printer callback for terminal progress logging.
        """
        self.check_fn = check_fn
        self.poll_interval = float(poll_interval)
        self.rollback_command = rollback_command
        self.print_fn = print_fn

    async def verify(
        self,
        initial_restart_count: int = 0,
        timeout: int = 45,
        rollback_command: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Poll cluster evidence until workload is verified, failed, or timed out.

        :param initial_restart_count: Baseline restart count prior to remediation.
        :param timeout: Maximum verification polling duration in seconds (default: 45s).
        :param rollback_command: Optional override for the recommended rollback command.
        :return: Verification outcome dictionary containing status and message.
        """
        loop = asyncio.get_event_loop()
        start = loop.time()
        effective_rollback = rollback_command or self.rollback_command
        last_facts = PodStatusFacts()

        while (loop.time() - start) < timeout:
            raw_status = await self._fetch_status()
            last_facts = self._extract_facts(raw_status)

            regression = self._check_regression(last_facts, initial_restart_count)
            if regression is not None:
                res = self._build_failed_result(regression, last_facts, effective_rollback)
                self._notify_terminal(res)
                return res

            if self._is_verified(last_facts, initial_restart_count):
                res = self._build_verified_result(last_facts)
                self._notify_terminal(res)
                return res

            await self._sleep_poll_interval(loop, start, timeout)

        res = self._build_timeout_result(last_facts)
        self._notify_terminal(res)
        return res

    def _notify_terminal(self, result: Dict[str, Any]) -> None:
        """Emit formatted terminal summary if a printer callback was configured."""
        if self.print_fn is not None:
            self.print_fn(format_verification_result(result))

    async def _fetch_status(self) -> Dict[str, Any]:
        """Invoke check_fn safely supporting both sync and async callables."""
        try:
            res = self.check_fn()
            if inspect.isawaitable(res):
                res = await res
            return res if isinstance(res, dict) else {}
        except Exception as exc:
            return {"error": str(exc), "ready": False}

    def _extract_facts(self, status: Dict[str, Any]) -> PodStatusFacts:
        """Extract canonical health and container facts from raw status dict."""
        containers = self._parse_containers(status)
        ready = self._resolve_ready(status, containers)
        restarts = self._resolve_restart_count(status, containers)
        regression = self._find_regression_reason(status, containers)

        return PodStatusFacts(
            phase=status.get("phase") or status.get("pod_phase"),
            ready=ready,
            restart_count=restarts,
            pod_name=status.get("pod_name") or status.get("name"),
            regression_reason=regression,
            memory_usage=status.get("memory_usage"),
            memory_limit=status.get("memory_limit"),
            details=status,
        )

    def _parse_containers(self, status: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract container status list safely."""
        c_list = status.get("containerStatuses") or status.get("container_statuses")
        if not isinstance(c_list, list):
            return []
        return [c for c in c_list if isinstance(c, dict)]

    def _resolve_ready(
        self, status: Dict[str, Any], containers: List[Dict[str, Any]]
    ) -> bool:
        """Determine whether all containers or workload status report ready."""
        if "ready" in status:
            return bool(status["ready"])
        if containers:
            return all(bool(c.get("ready")) for c in containers)
        return False

    def _resolve_restart_count(
        self, status: Dict[str, Any], containers: List[Dict[str, Any]]
    ) -> int:
        """Extract current total container restart count."""
        raw_count = status.get("restart_count", status.get("restartCount"))
        if raw_count is not None:
            return self._safe_int(raw_count)
        if containers:
            return sum(
                self._safe_int(c.get("restartCount", c.get("restart_count", 0)))
                for c in containers
            )
        return 0

    def _find_regression_reason(
        self, status: Dict[str, Any], containers: List[Dict[str, Any]]
    ) -> Optional[str]:
        """Detect CrashLoopBackOff, OOMKilled, or failure states in status or containers."""
        top_reason = status.get("regression") or status.get("reason")
        if top_reason in CRASH_REGRESSION_REASONS:
            return str(top_reason)

        for c in containers:
            reason = self._scan_container_reasons(c)
            if reason:
                return reason

        return None

    def _scan_container_reasons(self, container: Dict[str, Any]) -> Optional[str]:
        """Inspect waiting and terminated container states for regression triggers."""
        for state_key in ("state", "lastState", "last_state"):
            sub_dict = container.get(state_key)
            if not isinstance(sub_dict, dict):
                continue
            for sub_key in ("waiting", "terminated"):
                sub_state = sub_dict.get(sub_key)
                if isinstance(sub_state, dict):
                    reason = sub_state.get("reason")
                    if reason in CRASH_REGRESSION_REASONS:
                        return str(reason)

        return None

    def _check_regression(
        self, facts: PodStatusFacts, initial_restart_count: int
    ) -> Optional[str]:
        """Check whether workload has regressed, crashed, or incremented restarts."""
        if facts.restart_count > initial_restart_count:
            return facts.regression_reason or "restart_count_incremented"
        if facts.regression_reason:
            return facts.regression_reason
        return None

    def _is_verified(self, facts: PodStatusFacts, initial_restart_count: int) -> bool:
        """Verify that workload meets all readiness and stability criteria."""
        phase_ok = facts.phase is None or str(facts.phase).strip().lower() == "running"
        return facts.ready and phase_ok and facts.restart_count <= initial_restart_count

    async def _sleep_poll_interval(
        self, loop: asyncio.AbstractEventLoop, start_time: float, timeout: float
    ) -> None:
        """Sleep for poll_interval, capped at remaining verification duration."""
        remaining = timeout - (loop.time() - start_time)
        if remaining > 0:
            sleep_time = min(self.poll_interval, remaining)
            await asyncio.sleep(sleep_time)

    def _build_verified_result(self, facts: PodStatusFacts) -> Dict[str, Any]:
        """Construct the successful verification result payload."""
        return {
            "status": "verified",
            "message": "Workload is healthy and Ready.",
            "ready": True,
            "restart_count": facts.restart_count,
            "pod_name": facts.pod_name,
            "details": {
                "phase": facts.phase,
                "ready": facts.ready,
                "restart_count": facts.restart_count,
                "memory_usage": facts.memory_usage,
                "memory_limit": facts.memory_limit,
            },
        }

    def _build_failed_result(
        self,
        reason: str,
        facts: PodStatusFacts,
        rollback_command: Optional[str],
    ) -> Dict[str, Any]:
        """Construct the failed verification regression payload with rollback guidance."""
        message = (
            "Container crashed again post-remediation."
            if reason == "restart_count_incremented"
            else f"Container crashed again post-remediation: {reason} detected. Rollback recommended."
        )

        return {
            "status": "failed",
            "message": message,
            "regression": reason,
            "rollback_recommended": True,
            "rollback_command": rollback_command,
            "restart_count": facts.restart_count,
            "details": {
                "phase": facts.phase,
                "ready": facts.ready,
                "restart_count": facts.restart_count,
                "regression_reason": reason,
            },
        }

    def _build_timeout_result(self, facts: PodStatusFacts) -> Dict[str, Any]:
        """Construct the timeout verification payload."""
        return {
            "status": "timed_out",
            "message": "Workload did not reach Ready within timeout.",
            "ready": facts.ready,
            "restart_count": facts.restart_count,
            "details": {
                "phase": facts.phase,
                "ready": facts.ready,
                "restart_count": facts.restart_count,
            },
        }

    @staticmethod
    def _safe_int(val: Any) -> int:
        """Safely parse an integer or return 0."""
        try:
            return int(val)
        except (ValueError, TypeError):
            return 0


def format_verification_result(result: Dict[str, Any]) -> str:
    """Format verification outcome into standard CLI terminal output.

    :param result: Result dict returned by WorkloadVerifier.verify().
    :return: Formatted multi-line string for terminal display.
    """
    status = result.get("status")
    lines = ["🔍 Verifying remediation outcome..."]

    if status == "verified":
        lines.append("✓ Verification Passed:")
        pod_name = result.get("pod_name") or "workload"
        restarts = result.get("restart_count", 0)
        details = result.get("details", {})
        mem_usage = details.get("memory_usage")
        mem_limit = details.get("memory_limit")

        lines.append(f"   - Pod {pod_name} is 1/1 Ready")
        restart_str = (
            "Zero restarts detected since patch"
            if restarts == 0
            else f"Restart count stable at {restarts}"
        )
        lines.append(f"   - {restart_str}")
        if mem_usage and mem_limit:
            lines.append(f"   - Memory usage: {mem_usage} / {mem_limit} (healthy)")

    elif status == "failed":
        lines.append("✖ Verification Failed:")
        lines.append(f"   - {result.get('message', 'Container crashed post-remediation.')}")
        rollback = result.get("rollback_command")
        if rollback:
            lines.append(f"   - Recommended Rollback: {rollback}")

    else:
        lines.append("✖ Verification Timed Out:")
        lines.append(f"   - {result.get('message', 'Workload did not reach Ready within timeout.')}")

    return "\n".join(lines)
