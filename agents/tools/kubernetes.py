"""
Kubernetes Read-Only Tools — KDM v4.0.0
=========================================
Implements safe, async, read-only tools for inspecting Kubernetes resources.

All tools are registered on the module-level :data:`tool_registry` singleton
and return structured JSON dicts.  Credential values are scrubbed by the
:func:`~core.sanitizer.redact_sensitive_data` helper before any data leaves
this layer.

Tools exposed
-------------
* ``get_pod_status``      — Pod phase and container states.
* ``get_container_logs``  — Bounded log lines for a named container.
* ``get_pod_events``      — Warning events sorted by timestamp.
* ``get_deployment_spec`` — Replicas, selector, and resource requirements.
"""

from __future__ import annotations

import asyncio
import json
import sys
import os
from typing import Any, Dict, List

# ---------------------------------------------------------------------------
# Make ``agents/`` importable when this module is loaded directly.
# ---------------------------------------------------------------------------
_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

from core.sanitizer import redact_sensitive_data
from tools.registry import tool_registry

# ---------------------------------------------------------------------------
# Maximum number of log lines that may be requested in a single call.
# Prevents agents from swamping context windows.
# ---------------------------------------------------------------------------
_MAX_TAIL_LINES: int = 500


async def _run_kubectl(*args: str) -> Dict[str, Any]:
    """Execute a read-only ``kubectl`` command and return parsed JSON output.

    Args:
        *args: Command-line arguments appended after ``kubectl``.

    Returns:
        Parsed JSON response dict, or ``{"error": ..., "message": ...}`` on
        failure.
    """
    proc = await asyncio.create_subprocess_exec(
        "kubectl",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        return _kubectl_error(stderr.decode())
    return json.loads(stdout.decode())


def _kubectl_error(stderr_text: str) -> Dict[str, str]:
    """Build a structured error dict from kubectl stderr output.

    Args:
        stderr_text: Raw stderr string from the failed kubectl invocation.

    Returns:
        A dict with ``"error"`` and ``"message"`` keys.
    """
    if "Forbidden" in stderr_text or "403" in stderr_text:
        return {"error": "Forbidden", "message": "User lacks permissions"}
    return {"error": "kubectl_error", "message": stderr_text.strip()}


def _clamp_tail(tail_lines: int) -> int:
    """Clamp *tail_lines* to the allowable range ``[1, _MAX_TAIL_LINES]``.

    Args:
        tail_lines: The caller-requested line count.

    Returns:
        A value guaranteed to be within ``[1, _MAX_TAIL_LINES]``.
    """
    return max(1, min(tail_lines, _MAX_TAIL_LINES))


def _extract_pod_status(pod: Dict[str, Any]) -> Dict[str, Any]:
    """Pull the relevant status fields from a raw pod resource dict.

    Args:
        pod: Full pod resource dict as returned by ``kubectl get pod -o json``.

    Returns:
        A filtered dict with ``phase`` and ``containerStatuses``.
    """
    status = pod.get("status", {})
    return {
        "phase": status.get("phase"),
        "containerStatuses": status.get("containerStatuses", []),
    }


def _extract_deployment_spec(deploy: Dict[str, Any]) -> Dict[str, Any]:
    """Pull the relevant spec fields from a raw deployment resource dict.

    Args:
        deploy: Full deployment resource dict from kubectl.

    Returns:
        A filtered dict with ``replicas``, ``selector``, and ``template``.
    """
    spec = deploy.get("spec", {})
    return {
        "replicas": spec.get("replicas"),
        "selector": spec.get("selector"),
        "template": spec.get("template", {}),
    }


def _sort_events_by_time(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sort a list of Kubernetes event dicts by ``lastTimestamp`` ascending.

    Args:
        events: Raw event dicts from the Kubernetes API.

    Returns:
        A new list sorted by ``lastTimestamp``, oldest first.
    """
    return sorted(events, key=lambda e: e.get("lastTimestamp") or "")


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


@tool_registry.register(
    "get_pod_status",
    "Return the phase and container states for a Kubernetes pod.",
)
async def get_pod_status(namespace: str, pod: str) -> Dict[str, Any]:
    """Fetch phase and container status for a Kubernetes pod.

    Args:
        namespace: Kubernetes namespace containing the pod.
        pod: Pod name.

    Returns:
        Sanitised dict with ``phase`` and ``containerStatuses``, or an
        ``{"error": ...}`` dict on failure.
    """
    raw = await _run_kubectl("get", "pod", pod, "-n", namespace, "-o", "json")
    if "error" in raw:
        return raw
    return redact_sensitive_data(_extract_pod_status(raw))


@tool_registry.register(
    "get_container_logs",
    "Fetch recent log lines for a named container inside a pod.",
)
async def get_container_logs(
    namespace: str,
    pod: str,
    container: str,
    tail_lines: int = 100,
    previous: bool = False,
) -> Dict[str, Any]:
    """Retrieve bounded log output for a container.

    Args:
        namespace: Kubernetes namespace containing the pod.
        pod: Pod name.
        container: Container name within the pod.
        tail_lines: Maximum number of lines to return (clamped to 500).
        previous: If ``True``, fetch logs from the *previous* container run.

    Returns:
        A dict with a ``"lines"`` key containing a list of log strings, or an
        ``{"error": ...}`` dict on failure.
    """
    clamped = _clamp_tail(tail_lines)
    cmd = _build_logs_cmd(namespace, pod, container, clamped, previous)
    proc = await asyncio.create_subprocess_exec(
        "kubectl", *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        return _kubectl_error(stderr.decode())
    return {"lines": stdout.decode().splitlines()}


def _build_logs_cmd(
    namespace: str,
    pod: str,
    container: str,
    tail_lines: int,
    previous: bool,
) -> List[str]:
    """Construct the kubectl logs argument list.

    Args:
        namespace: Kubernetes namespace.
        pod: Pod name.
        container: Container name.
        tail_lines: Number of lines (already clamped).
        previous: Whether to fetch previous-run logs.

    Returns:
        A list of string arguments for kubectl (excluding ``"kubectl"`` itself).
    """
    cmd = [
        "logs", pod, "-n", namespace,
        "-c", container,
        f"--tail={tail_lines}",
    ]
    if previous:
        cmd.append("--previous")
    return cmd


@tool_registry.register(
    "get_pod_events",
    "Return warning events for a pod, sorted oldest-first.",
)
async def get_pod_events(namespace: str, pod: str) -> List[Dict[str, Any]]:
    """Retrieve warning events for a Kubernetes pod.

    Args:
        namespace: Kubernetes namespace containing the pod.
        pod: Pod name used as the ``--field-selector`` value.

    Returns:
        Sorted list of event dicts (``type``, ``reason``, ``message``,
        ``lastTimestamp``), or an ``{"error": ...}`` dict on failure.
    """
    field = f"involvedObject.name={pod}"
    raw = await _run_kubectl(
        "get", "events", "-n", namespace, "--field-selector", field, "-o", "json"
    )
    if "error" in raw:
        return raw  # type: ignore[return-value]
    items = raw.get("items", [])
    warning_events = [e for e in items if e.get("type") == "Warning"]
    return _sort_events_by_time(warning_events)


@tool_registry.register(
    "get_deployment_spec",
    "Return replicas, selector, and resource requirements for a deployment.",
)
async def get_deployment_spec(namespace: str, deployment: str) -> Dict[str, Any]:
    """Fetch the spec of a Kubernetes Deployment.

    Args:
        namespace: Kubernetes namespace containing the deployment.
        deployment: Deployment name.

    Returns:
        Sanitised dict with ``replicas``, ``selector``, and ``template``, or
        an ``{"error": ...}`` dict on failure.
    """
    raw = await _run_kubectl(
        "get", "deployment", deployment, "-n", namespace, "-o", "json"
    )
    if "error" in raw:
        return raw
    return redact_sensitive_data(_extract_deployment_spec(raw))
