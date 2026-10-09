"""
Unit Tests — Parallel Agent Orchestrator (agents/orchestration/orchestrator.py)
==============================================================================
Tests cover:
  - AgentOrchestrator default parameters and initial state.
  - Concurrent execution speedup over sequential execution.
  - Concurrency throttling enforced by asyncio.Semaphore.
  - Failure isolation when an agent raises an unhandled exception.
  - Timeout enforcement when a slow agent exceeds timeout_seconds.
  - Edge case handling when all agents timeout or raise errors.
  - Handling of empty agent lists and None evidence bundles.
  - End-to-end integration with concrete domain specialist agents.
"""

from __future__ import annotations

import asyncio
import os
import sys
import threading
import time
from typing import Any, Callable, Dict, Optional
import unittest
from unittest.mock import MagicMock

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import EvidenceBundle, Target
    from agents.orchestration.orchestrator import AgentOrchestrator
    from agents.specialists.base import BaseSpecialistAgent
    from agents.specialists.config import ConfigDependencyAgent
    from agents.specialists.resource import ClusterResourceAgent
    from agents.specialists.runtime import RuntimeLogAgent
except ImportError:
    from core.evidence import EvidenceBundle, Target  # type: ignore[no-redef]
    from orchestration.orchestrator import AgentOrchestrator  # type: ignore[no-redef]
    from specialists.base import BaseSpecialistAgent  # type: ignore[no-redef]
    from specialists.config import ConfigDependencyAgent  # type: ignore[no-redef]
    from specialists.resource import ClusterResourceAgent  # type: ignore[no-redef]
    from specialists.runtime import RuntimeLogAgent  # type: ignore[no-redef]


class DummySpecialist(BaseSpecialistAgent):
    """Mock specialist agent for deterministic concurrency and failure testing."""

    def __init__(
        self,
        role: str,
        delay: float = 0.0,
        result: Optional[Dict[str, Any]] = None,
        exception: Optional[Exception] = None,
        on_start: Optional[Callable[[], None]] = None,
        on_finish: Optional[Callable[[], None]] = None,
    ) -> None:
        """Initialize dummy specialist with controllable latency and exceptions."""
        self.role = role
        self.display_name = f"Dummy {role.capitalize()}"
        self.icon = "🔍"
        self.delay = delay
        self.result = result if result is not None else {"summary": f"{role} success"}
        self.exception = exception
        self.on_start = on_start
        self.on_finish = on_finish
        self.call_count = 0

    def build_prompt(self, bundle: EvidenceBundle) -> str:
        """Return dummy prompt."""
        return f"Dummy prompt for {self.role}"

    def get_system_prompt(self) -> str:
        """Return dummy system prompt."""
        return f"Dummy system prompt for {self.role}"

    def run_investigation(
        self, bundle: Optional[EvidenceBundle] = None
    ) -> Dict[str, Any]:
        """Execute investigation simulation with latency and optional exception."""
        self.call_count += 1
        if self.on_start:
            self.on_start()
        try:
            if self.delay > 0:
                time.sleep(self.delay)
            if self.exception:
                raise self.exception
            return dict(self.result)
        finally:
            if self.on_finish:
                self.on_finish()


def _create_sample_bundle() -> EvidenceBundle:
    """Create a minimal evidence bundle for testing."""
    target = Target(
        workload_kind="Deployment",
        workload_name="api-server",
        namespace="prod",
    )
    return EvidenceBundle(target=target)


def _run_async(coro: Any) -> Any:
    """Run an async coroutine safely on an isolated event loop."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestAgentOrchestratorInitialization(unittest.TestCase):
    """Tests for AgentOrchestrator construction and configuration."""

    def test_default_initialization(self) -> None:
        """Verify orchestrator initializes with sensible defaults."""
        orchestrator = AgentOrchestrator()
        self.assertEqual(orchestrator.agents, [])
        self.assertEqual(orchestrator.max_concurrency, 2)
        self.assertEqual(orchestrator.timeout, 25.0)
        self.assertEqual(orchestrator.timeout_seconds, 25.0)

    def test_custom_initialization(self) -> None:
        """Verify custom concurrency and timeout configuration."""
        agent1 = DummySpecialist(role="runtime")
        agent2 = DummySpecialist(role="config")
        orchestrator = AgentOrchestrator(
            agents=[agent1, agent2],
            max_concurrency=4,
            timeout_seconds=10.0,
        )
        self.assertEqual(len(orchestrator.agents), 2)
        self.assertEqual(orchestrator.max_concurrency, 4)
        self.assertEqual(orchestrator.timeout, 10.0)

    def test_empty_agents_execution(self) -> None:
        """Verify executing with no registered agents returns an empty list."""
        orchestrator = AgentOrchestrator([])
        bundle = _create_sample_bundle()
        results = _run_async(orchestrator.run_all(bundle))
        self.assertEqual(results, [])


class TestAgentOrchestratorConcurrency(unittest.TestCase):
    """Tests for parallel execution and concurrency throttling."""

    def test_concurrent_execution_speedup(self) -> None:
        """Verify parallel execution runs faster than sequential cumulative delay."""
        delay = 0.12
        agents = [
            DummySpecialist(role="runtime", delay=delay),
            DummySpecialist(role="config", delay=delay),
            DummySpecialist(role="resource", delay=delay),
        ]
        orchestrator = AgentOrchestrator(agents=agents, max_concurrency=3)
        bundle = _create_sample_bundle()

        start = time.perf_counter()
        results = _run_async(orchestrator.run_all(bundle))
        elapsed = time.perf_counter() - start

        # 3 sequential runs would take at least 0.36s; concurrent runs finish in ~0.15s
        self.assertLess(elapsed, 0.30)
        self.assertEqual(len(results), 3)
        for res in results:
            self.assertEqual(res["status"], "completed")

    def test_semaphore_limits_active_concurrency(self) -> None:
        """Verify semaphore restricts concurrent executions to max_concurrency."""
        active_count = 0
        max_observed = 0
        lock = threading.Lock()

        def record_start() -> None:
            nonlocal active_count, max_observed
            with lock:
                active_count += 1
                if active_count > max_observed:
                    max_observed = active_count

        def record_finish() -> None:
            nonlocal active_count
            with lock:
                active_count -= 1

        agents = [
            DummySpecialist(
                role=f"worker-{i}",
                delay=0.06,
                on_start=record_start,
                on_finish=record_finish,
            )
            for i in range(4)
        ]
        orchestrator = AgentOrchestrator(agents=agents, max_concurrency=2)
        results = _run_async(orchestrator.run_all(_create_sample_bundle()))

        self.assertEqual(len(results), 4)
        self.assertLessEqual(max_observed, 2)
        self.assertGreaterEqual(max_observed, 1)


class TestAgentOrchestratorFailureIsolation(unittest.TestCase):
    """Tests for error isolation, timeouts, and edge cases."""

    def test_unhandled_exception_does_not_fail_batch(self) -> None:
        """Verify an agent raising an exception does not fail remaining agents."""
        agents = [
            DummySpecialist(role="runtime"),
            DummySpecialist(
                role="config",
                exception=RuntimeError("Corrupt ConfigMap payload"),
            ),
            DummySpecialist(role="resource"),
        ]
        orchestrator = AgentOrchestrator(agents=agents, max_concurrency=3)
        results = _run_async(orchestrator.run_all(_create_sample_bundle()))

        self.assertEqual(len(results), 3)
        self.assertEqual(results[0]["role"], "runtime")
        self.assertEqual(results[0]["status"], "completed")

        self.assertEqual(results[1]["role"], "config")
        self.assertEqual(results[1]["status"], "failed")
        self.assertIn("Corrupt ConfigMap payload", results[1]["error"])

        self.assertEqual(results[2]["role"], "resource")
        self.assertEqual(results[2]["status"], "completed")

    def test_timeout_cancels_slow_agent_and_returns_partial_results(self) -> None:
        """Verify slow agent times out while fast agents return successfully."""
        agents = [
            DummySpecialist(role="runtime", delay=0.01),
            DummySpecialist(role="config", delay=0.50),
            DummySpecialist(role="resource", delay=0.01),
        ]
        orchestrator = AgentOrchestrator(
            agents=agents,
            max_concurrency=3,
            timeout_seconds=0.10,
        )
        results = _run_async(orchestrator.run_all(_create_sample_bundle()))

        self.assertEqual(len(results), 3)
        self.assertEqual(results[0]["status"], "completed")
        self.assertEqual(results[1]["status"], "failed")
        self.assertIn("Timed out after 0.1s", results[1]["error"])
        self.assertEqual(results[2]["status"], "completed")

    def test_all_agents_timeout_does_not_crash(self) -> None:
        """Verify orchestrator gracefully aggregates failures when all agents timeout."""
        agents = [
            DummySpecialist(role="runtime", delay=0.4),
            DummySpecialist(role="config", delay=0.4),
            DummySpecialist(role="resource", delay=0.4),
        ]
        orchestrator = AgentOrchestrator(
            agents=agents,
            max_concurrency=2,
            timeout_seconds=0.05,
        )
        results = _run_async(orchestrator.run_all(_create_sample_bundle()))

        self.assertEqual(len(results), 3)
        for item in results:
            self.assertEqual(item["status"], "failed")
            self.assertIn("Timed out after 0.05s", item["error"])

    def test_all_agents_fail_with_exceptions(self) -> None:
        """Verify orchestrator handles batch where all specialists raise exceptions."""
        agents = [
            DummySpecialist(role="runtime", exception=ValueError("Invalid pod log")),
            DummySpecialist(role="config", exception=KeyError("Missing key in secret")),
        ]
        orchestrator = AgentOrchestrator(agents=agents)
        results = _run_async(orchestrator.run_all(_create_sample_bundle()))

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["status"], "failed")
        self.assertIn("Invalid pod log", results[0]["error"])
        self.assertEqual(results[1]["status"], "failed")
        self.assertIn("Missing key in secret", results[1]["error"])

    def test_none_evidence_bundle_handled(self) -> None:
        """Verify running with bundle=None succeeds without crashing."""
        agent = DummySpecialist(role="runtime")
        orchestrator = AgentOrchestrator(agents=[agent])
        results = _run_async(orchestrator.run_all(None))

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["status"], "completed")


class TestAgentOrchestratorSpecialistIntegration(unittest.TestCase):
    """End-to-end integration tests with concrete specialist agent classes."""

    def test_concrete_specialists_execution(self) -> None:
        """Verify orchestrator runs concrete specialist classes with mocked Ollama."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.message.content = (
            '{"summary": "Healthy", "evidence": [], "hypotheses": [], "confidence": "high"}'
        )
        mock_client.chat.return_value = mock_response

        agents = [
            RuntimeLogAgent(client=mock_client, model="llama3"),
            ConfigDependencyAgent(client=mock_client, model="llama3"),
            ClusterResourceAgent(client=mock_client, model="llama3"),
        ]
        orchestrator = AgentOrchestrator(agents=agents, max_concurrency=3)
        bundle = _create_sample_bundle()

        results = _run_async(orchestrator.run_all(bundle))

        self.assertEqual(len(results), 3)
        roles = [r["role"] for r in results]
        self.assertEqual(roles, ["runtime", "config", "resource"])
        for r in results:
            self.assertEqual(r["status"], "completed")
            self.assertEqual(r["result"]["confidence"], "high")


if __name__ == "__main__":
    unittest.main()
