"""
Docker Read-Only Tools — KDM v4.0.0
======================================
Implements safe, async, read-only tools for inspecting Docker containers.

All tools are registered on the module-level :data:`tool_registry` singleton
and return structured JSON dicts.  Credential values are scrubbed by the
:func:`~core.sanitizer.redact_sensitive_data` helper before any data leaves
this layer.

Tools exposed
-------------
* ``get_docker_container_inspect`` — State, exitCode, OOMKilled, restartCount.
* ``get_docker_logs``              — Bounded recent stdout/stderr lines.
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
# ---------------------------------------------------------------------------
_MAX_TAIL: int = 500


async def _run_docker(*args: str) -> Any:
    """Execute a read-only ``docker`` command and return parsed JSON output.

    Args:
        *args: Command-line arguments appended after ``docker``.

    Returns:
        Parsed JSON response (list or dict), or ``{"error": ..., "message": ...}``
        on failure.
    """
    proc = await asyncio.create_subprocess_exec(
        "docker",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        return _docker_error(stderr.decode())
    return json.loads(stdout.decode())


def _docker_error(stderr_text: str) -> Dict[str, str]:
    """Build a structured error dict from docker stderr output.

    Args:
        stderr_text: Raw stderr string from the failed docker invocation.

    Returns:
        A dict with ``"error"`` and ``"message"`` keys.
    """
    return {"error": "docker_error", "message": stderr_text.strip()}


def _clamp_tail(tail: int) -> int:
    """Clamp *tail* to the allowable range ``[1, _MAX_TAIL]``.

    Args:
        tail: The caller-requested line count.

    Returns:
        A value guaranteed to be within ``[1, _MAX_TAIL]``.
    """
    return max(1, min(tail, _MAX_TAIL))


def _extract_container_state(inspect_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Pull the relevant state fields from docker inspect output.

    Args:
        inspect_data: Parsed list returned by ``docker inspect``.

    Returns:
        A filtered dict with ``State``, ``RestartCount``, and ``Name``.
    """
    if not inspect_data:
        return {"error": "not_found", "message": "No container data returned"}
    container = inspect_data[0]
    state = container.get("State", {})
    return {
        "Name": container.get("Name", ""),
        "RestartCount": container.get("RestartCount", 0),
        "State": {
            "Status": state.get("Status"),
            "ExitCode": state.get("ExitCode"),
            "OOMKilled": state.get("OOMKilled"),
            "Error": state.get("Error", ""),
        },
    }


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


@tool_registry.register(
    "get_docker_container_inspect",
    "Return state, exitCode, OOMKilled, and restartCount for a Docker container.",
)
async def get_docker_container_inspect(container_id: str) -> Dict[str, Any]:
    """Inspect a Docker container and return key state information.

    Args:
        container_id: The Docker container ID or name.

    Returns:
        Sanitised dict with ``Name``, ``RestartCount``, and ``State`` sub-dict,
        or an ``{"error": ...}`` dict on failure.
    """
    raw = await _run_docker("inspect", container_id)
    if isinstance(raw, dict) and "error" in raw:
        return raw
    return redact_sensitive_data(_extract_container_state(raw))


@tool_registry.register(
    "get_docker_logs",
    "Fetch recent stdout/stderr log lines for a Docker container.",
)
async def get_docker_logs(container_id: str, tail: int = 100) -> Dict[str, Any]:
    """Retrieve bounded log output for a Docker container.

    Args:
        container_id: The Docker container ID or name.
        tail: Maximum number of log lines to return (clamped to 500).

    Returns:
        A dict with a ``"lines"`` key containing a list of log strings, or an
        ``{"error": ...}`` dict on failure.
    """
    clamped = _clamp_tail(tail)
    proc = await asyncio.create_subprocess_exec(
        "docker", "logs", container_id, f"--tail={clamped}",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    stdout, _ = await proc.communicate()
    if proc.returncode != 0:
        return _docker_error(stdout.decode())
    return {"lines": stdout.decode().splitlines()}
