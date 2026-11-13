"""
Unit Tests — KDM v4.0.0 Safe Typed Tool Layer
===============================================
Tests cover:
  - ToolRegistry whitelist enforcement (unregistered tools raise ValueError).
  - Ollama schema generation from function signatures.
  - get_pod_status, get_container_logs, get_pod_events, get_deployment_spec.
  - get_docker_container_inspect, get_docker_logs.
  - tail_lines clamping for both Kubernetes and Docker log tools.
  - Timeout handling in ToolRegistry.execute.
  - RBAC/Forbidden error detection in kubectl helpers.
"""

from __future__ import annotations

import asyncio
import json
import sys
import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Path setup — allow imports from the ``agents/`` directory.
# ---------------------------------------------------------------------------
_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

from tools.registry import ToolRegistry, _TOOL_TIMEOUT_SECONDS, tool_registry
import tools.kubernetes as k8s_tools
import tools.docker as docker_tools


# ===========================================================================
# Helpers
# ===========================================================================


def _make_process(stdout: bytes, returncode: int = 0, stderr: bytes = b"") -> MagicMock:
    """Build a mock asyncio subprocess that returns fixed output.

    Args:
        stdout: Bytes to return from communicate().
        returncode: Process exit code.
        stderr: Bytes to return as stderr from communicate().

    Returns:
        A :class:`~unittest.mock.MagicMock` mimicking an asyncio Process.
    """
    proc = MagicMock()
    proc.returncode = returncode
    proc.communicate = AsyncMock(return_value=(stdout, stderr))
    return proc


def _json_bytes(data: Any) -> bytes:
    """Serialise *data* to UTF-8 JSON bytes.

    Args:
        data: Any JSON-serialisable object.

    Returns:
        UTF-8 encoded JSON bytes.
    """
    return json.dumps(data).encode()


# ===========================================================================
# ToolRegistry — whitelist & schema tests
# ===========================================================================


class TestToolRegistry:
    """Tests for :class:`tools.registry.ToolRegistry`."""

    def test_execute_unregistered_tool_raises_value_error(self) -> None:
        """Calling an unknown tool must raise ValueError immediately."""
        registry = ToolRegistry()
        with pytest.raises(ValueError, match="Unauthorized or unknown tool: delete_pod"):
            asyncio.run(registry.execute("delete_pod"))

    def test_register_and_execute_returns_result(self) -> None:
        """A registered async tool is callable through execute()."""
        registry = ToolRegistry()

        @registry.register("ping", "Returns pong")
        async def ping() -> dict:
            return {"status": "pong"}

        result = asyncio.run(registry.execute("ping"))
        assert result == {"status": "pong"}

    def test_ollama_schema_required_fields(self) -> None:
        """Schema for a required-only parameter must list it in required[]."""
        registry = ToolRegistry()

        @registry.register("say", "Echo a message")
        async def say(message: str) -> dict:
            return {"echo": message}

        schemas = registry.get_ollama_tools()
        assert len(schemas) == 1
        fn = schemas[0]["function"]
        assert fn["name"] == "say"
        assert "message" in fn["parameters"]["required"]
        assert fn["parameters"]["properties"]["message"]["type"] == "string"

    def test_ollama_schema_optional_not_in_required(self) -> None:
        """Parameters with defaults must not appear in required[]."""
        registry = ToolRegistry()

        @registry.register("fetch_logs", "Fetch logs")
        async def fetch_logs(pod: str, tail: int = 100) -> dict:
            return {}

        schemas = registry.get_ollama_tools()
        fn = schemas[0]["function"]
        assert "pod" in fn["parameters"]["required"]
        assert "tail" not in fn["parameters"]["required"]

    def test_ollama_schema_type_mapping(self) -> None:
        """Python types are mapped to correct JSON schema type strings."""
        registry = ToolRegistry()

        @registry.register("typed", "Types demo")
        async def typed(a: str, b: int, c: bool) -> dict:
            return {}

        props = registry.get_ollama_tools()[0]["function"]["parameters"]["properties"]
        assert props["a"]["type"] == "string"
        assert props["b"]["type"] == "integer"
        assert props["c"]["type"] == "boolean"

    def test_execute_timeout_returns_error_dict(self) -> None:
        """Tools that exceed the timeout must return an error dict, not raise."""
        registry = ToolRegistry()

        @registry.register("slow", "Hangs forever")
        async def slow() -> dict:
            await asyncio.sleep(_TOOL_TIMEOUT_SECONDS + 5)
            return {}

        result = asyncio.run(registry.execute("slow"))
        assert "error" in result
        assert "timed out" in result["error"]


# ===========================================================================
# Kubernetes tools
# ===========================================================================


class TestGetPodStatus:
    """Tests for :func:`tools.kubernetes.get_pod_status`."""

    @pytest.mark.asyncio
    async def test_returns_phase_and_container_statuses(self) -> None:
        """get_pod_status extracts phase and containerStatuses from the API."""
        fake_pod = {
            "status": {
                "phase": "Running",
                "containerStatuses": [{"name": "app", "ready": True}],
            }
        }
        proc = _make_process(_json_bytes(fake_pod))
        with patch("asyncio.create_subprocess_exec", return_value=proc):
            result = await k8s_tools.get_pod_status("prod", "api-xyz")
        assert result["phase"] == "Running"
        assert result["containerStatuses"][0]["name"] == "app"

    @pytest.mark.asyncio
    async def test_forbidden_returns_error_dict(self) -> None:
        """A 403 Forbidden response surfaces as a structured error dict."""
        proc = _make_process(b"", returncode=1, stderr=b"Error from server (Forbidden)")
        with patch("asyncio.create_subprocess_exec", return_value=proc):
            result = await k8s_tools.get_pod_status("prod", "api-xyz")
        assert result["error"] == "Forbidden"


class TestGetContainerLogs:
    """Tests for :func:`tools.kubernetes.get_container_logs`."""

    @pytest.mark.asyncio
    async def test_returns_lines_list(self) -> None:
        """get_container_logs returns a dict with a list of log strings."""
        raw_logs = b"line1\nline2\nline3"
        proc = _make_process(raw_logs)
        with patch("asyncio.create_subprocess_exec", return_value=proc):
            result = await k8s_tools.get_container_logs("prod", "api-xyz", "app")
        assert result["lines"] == ["line1", "line2", "line3"]

    @pytest.mark.asyncio
    async def test_tail_lines_clamped_to_max(self) -> None:
        """Requesting more than 500 lines is silently clamped to 500."""
        proc = _make_process(b"log")
        captured_args: list = []

        async def fake_exec(*args: Any, **kwargs: Any) -> MagicMock:
            captured_args.extend(args)
            return proc

        with patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
            await k8s_tools.get_container_logs("prod", "pod", "c", tail_lines=9999)

        assert "--tail=500" in captured_args

    @pytest.mark.asyncio
    async def test_previous_flag_included(self) -> None:
        """Passing previous=True adds the --previous flag to kubectl."""
        proc = _make_process(b"old log")
        captured_args: list = []

        async def fake_exec(*args: Any, **kwargs: Any) -> MagicMock:
            captured_args.extend(args)
            return proc

        with patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
            await k8s_tools.get_container_logs("prod", "pod", "c", previous=True)

        assert "--previous" in captured_args


class TestGetPodEvents:
    """Tests for :func:`tools.kubernetes.get_pod_events`."""

    @pytest.mark.asyncio
    async def test_returns_only_warning_events_sorted(self) -> None:
        """get_pod_events filters to Warning type and sorts by lastTimestamp."""
        fake_events = {
            "items": [
                {"type": "Warning", "reason": "BackOff", "lastTimestamp": "2026-09-11T12:01:00Z"},
                {"type": "Normal", "reason": "Pulled", "lastTimestamp": "2026-09-11T12:00:00Z"},
                {"type": "Warning", "reason": "OOMKilling", "lastTimestamp": "2026-09-11T12:00:30Z"},
            ]
        }
        proc = _make_process(_json_bytes(fake_events))
        with patch("asyncio.create_subprocess_exec", return_value=proc):
            result = await k8s_tools.get_pod_events("prod", "api-xyz")
        assert len(result) == 2
        assert result[0]["reason"] == "OOMKilling"
        assert result[1]["reason"] == "BackOff"


class TestGetDeploymentSpec:
    """Tests for :func:`tools.kubernetes.get_deployment_spec`."""

    @pytest.mark.asyncio
    async def test_returns_replicas_and_selector(self) -> None:
        """get_deployment_spec returns replicas and selector fields."""
        fake_deploy = {
            "spec": {
                "replicas": 3,
                "selector": {"matchLabels": {"app": "api"}},
                "template": {},
            }
        }
        proc = _make_process(_json_bytes(fake_deploy))
        with patch("asyncio.create_subprocess_exec", return_value=proc):
            result = await k8s_tools.get_deployment_spec("prod", "api")
        assert result["replicas"] == 3
        assert result["selector"]["matchLabels"]["app"] == "api"


# ===========================================================================
# Docker tools
# ===========================================================================


class TestGetDockerContainerInspect:
    """Tests for :func:`tools.docker.get_docker_container_inspect`."""

    @pytest.mark.asyncio
    async def test_returns_state_and_restart_count(self) -> None:
        """get_docker_container_inspect extracts State and RestartCount."""
        fake_inspect = [
            {
                "Name": "/my-container",
                "RestartCount": 2,
                "State": {
                    "Status": "exited",
                    "ExitCode": 1,
                    "OOMKilled": False,
                    "Error": "",
                },
            }
        ]
        proc = _make_process(_json_bytes(fake_inspect))
        with patch("asyncio.create_subprocess_exec", return_value=proc):
            result = await docker_tools.get_docker_container_inspect("abc123")
        assert result["RestartCount"] == 2
        assert result["State"]["ExitCode"] == 1
        assert result["State"]["OOMKilled"] is False

    @pytest.mark.asyncio
    async def test_docker_error_surfaces_as_dict(self) -> None:
        """A docker inspect failure returns an error dict."""
        proc = _make_process(b"", returncode=1, stderr=b"No such container: abc")
        with patch("asyncio.create_subprocess_exec", return_value=proc):
            result = await docker_tools.get_docker_container_inspect("abc")
        assert result["error"] == "docker_error"


class TestGetDockerLogs:
    """Tests for :func:`tools.docker.get_docker_logs`."""

    @pytest.mark.asyncio
    async def test_returns_lines_list(self) -> None:
        """get_docker_logs returns a dict with a list of log strings."""
        proc = _make_process(b"alpha\nbeta")
        with patch("asyncio.create_subprocess_exec", return_value=proc):
            result = await docker_tools.get_docker_logs("my-container")
        assert result["lines"] == ["alpha", "beta"]

    @pytest.mark.asyncio
    async def test_tail_clamped_to_max(self) -> None:
        """Requesting more than 500 lines is silently clamped to 500."""
        proc = _make_process(b"log")
        captured_args: list = []

        async def fake_exec(*args: Any, **kwargs: Any) -> MagicMock:
            captured_args.extend(args)
            return proc

        with patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
            await docker_tools.get_docker_logs("c", tail=10000)

        assert "--tail=500" in captured_args


# ===========================================================================
# Integration — global tool_registry contains all registered tools
# ===========================================================================


class TestGlobalRegistryIntegration:
    """Verify the global tool_registry has all expected tools after import."""

    def test_all_kubernetes_tools_registered(self) -> None:
        """After importing kubernetes module, k8s tools appear in global registry."""
        schemas = {s["function"]["name"] for s in tool_registry.get_ollama_tools()}
        expected = {
            "get_pod_status",
            "get_container_logs",
            "get_pod_events",
            "get_deployment_spec",
        }
        assert expected.issubset(schemas)

    def test_all_docker_tools_registered(self) -> None:
        """After importing docker module, docker tools appear in global registry."""
        schemas = {s["function"]["name"] for s in tool_registry.get_ollama_tools()}
        expected = {"get_docker_container_inspect", "get_docker_logs"}
        assert expected.issubset(schemas)

    def test_no_mutating_tools_registered(self) -> None:
        """No tools with mutating names (delete/apply/patch/scale) must exist."""
        mutating = {"delete", "apply", "patch", "scale", "create", "update"}
        schema_names = {s["function"]["name"] for s in tool_registry.get_ollama_tools()}
        for name in schema_names:
            parts = set(name.lower().split("_"))
            overlap = parts & mutating
            assert not overlap, f"Mutating tool detected: {name}"
