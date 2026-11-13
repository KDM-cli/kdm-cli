"""
Unit Tests — Progressive Investigation Loop (agents/orchestration/tool_loop.py)
=============================================================================
Tests cover:
  - Default initialization and custom parameters (tool_registry, evidence_store, max_turns).
  - Single-turn immediate final_answer completion.
  - Multi-turn flow where agent calls get_container_logs and then produces final diagnosis.
  - Bounded execution with hard stop at max_turns (max_turns=3, max_turns=1).
  - Tool failure in loop: feeding errors back in history for agent hypothesis pivoting.
  - Ollama native function calling format (dict with tool_calls).
  - Ollama native function calling with stringified JSON arguments.
  - Ollama response object with message.tool_calls attribute.
  - Structured JSON action aliases ("call" and "call_tool").
  - Audit logging verification in EvidenceStore.
  - Graceful handling of agents lacking evaluate_next_step or force_synthesis.
  - Safe execution when evidence bundle is None.
  - End-to-end integration with concrete ToolRegistry and registered tools.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Callable, Dict, List, Optional
import unittest
from unittest.mock import MagicMock

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import EvidenceBundle, Target
    from agents.core.store import EvidenceStore
    from agents.orchestration.tool_loop import (
        MAX_DEPTH_INSTRUCTION,
        ProgressiveInvestigationLoop,
    )
    from agents.tools.registry import ToolRegistry
except ImportError:
    from core.evidence import EvidenceBundle, Target  # type: ignore[no-redef]
    from core.store import EvidenceStore  # type: ignore[no-redef]
    from orchestration.tool_loop import (  # type: ignore[no-redef]
        MAX_DEPTH_INSTRUCTION,
        ProgressiveInvestigationLoop,
    )
    from tools.registry import ToolRegistry  # type: ignore[no-redef]


class DummyLoopAgent:
    """Controllable dummy specialist agent for testing progressive tool loop turns."""

    def __init__(self, role: str = "runtime", **kwargs: Any) -> None:
        """Initialize dummy agent with optional script of decisions.

        :param role: Agent role name.
        :param kwargs: Optional parameters:
            - decisions: List of decisions returned sequentially on evaluate_next_step.
            - synthesis_report: Final report returned on force_synthesis.
            - on_evaluate: Callback invoked on each evaluate_next_step turn.
        """
        self.role = role
        self.decisions: List[Any] = list(kwargs.get("decisions", []))
        self.synthesis_report: Dict[str, Any] = kwargs.get(
            "synthesis_report",
            {
                "summary": "Synthesized diagnosis after max turns",
                "evidence": ["bounded loop stop"],
                "hypotheses": ["root cause synthesized"],
                "confidence": "medium",
            },
        )
        self.on_evaluate: Optional[Callable[[int, List[Dict[str, Any]]], None]] = (
            kwargs.get("on_evaluate")
        )
        self.evaluate_call_count = 0
        self.force_synthesis_called = False
        self.last_history_received: List[Dict[str, Any]] = []
        self.last_instruction_received = ""

    async def evaluate_next_step(
        self,
        bundle: Optional[EvidenceBundle],
        history: List[Dict[str, Any]],
    ) -> Any:
        """Return next scripted decision or default final answer."""
        turn = self.evaluate_call_count
        self.evaluate_call_count += 1
        self.last_history_received = list(history)

        if self.on_evaluate:
            self.on_evaluate(turn, history)

        if turn < len(self.decisions):
            return self.decisions[turn]
        return {
            "action": "final_answer",
            "report": {
                "summary": f"Default diagnosis by {self.role}",
                "evidence": [],
                "hypotheses": [],
                "confidence": "high",
            },
        }

    async def force_synthesis(
        self,
        bundle: Optional[EvidenceBundle],
        history: List[Dict[str, Any]],
        instruction: str = "",
    ) -> Dict[str, Any]:
        """Record synthesis call and return preconfigured synthesis report."""
        self.force_synthesis_called = True
        self.last_history_received = list(history)
        self.last_instruction_received = instruction
        return dict(self.synthesis_report)


def _build_test_bundle() -> EvidenceBundle:
    """Build a minimal sample evidence bundle for loop tests."""
    target = Target(
        workload_kind="Deployment",
        workload_name="cart-service",
        namespace="production",
        container_name="cart",
    )
    return EvidenceBundle(target=target)


class BaseLoopTestCase(unittest.IsolatedAsyncioTestCase):
    """Common test fixture providing initialized registry, store, and bundle."""

    def setUp(self) -> None:
        """Initialize clean store, registry, and test evidence bundle."""
        self.store = EvidenceStore()
        self.registry = ToolRegistry(store=self.store)
        self.bundle = _build_test_bundle()

    def make_loop(self, max_turns: int = 3) -> ProgressiveInvestigationLoop:
        """Construct a loop bound to the active test fixtures."""
        return ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=max_turns,
        )


class TestProgressiveLoopInitialization(unittest.TestCase):
    """Tests covering loop parameter initialization."""

    def test_default_parameters(self) -> None:
        """Verify default constructor parameters."""
        loop = ProgressiveInvestigationLoop()
        self.assertEqual(loop.max_turns, 3)
        self.assertIsInstance(loop.tools, ToolRegistry)
        self.assertIsInstance(loop.store, EvidenceStore)
        self.assertEqual(loop.turn_history, [])

    def test_custom_parameters(self) -> None:
        """Verify custom store and turn limit assignment."""
        store = EvidenceStore()
        registry = ToolRegistry(store=store)
        loop = ProgressiveInvestigationLoop(
            tool_registry=registry,
            evidence_store=store,
            max_turns=5,
        )
        self.assertEqual(loop.max_turns, 5)
        self.assertIs(loop.tools, registry)
        self.assertIs(loop.store, store)


class TestProgressiveLoopFlow(BaseLoopTestCase):
    """Tests covering multi-turn and single-turn execution workflows."""

    async def test_immediate_final_answer(self) -> None:
        """Verify immediate return on turn 1 without tool invocations."""
        expected = {
            "summary": "Pod healthy",
            "evidence": ["restarts: 0"],
            "hypotheses": [],
            "confidence": "high",
        }
        agent = DummyLoopAgent(decisions=[{"action": "final_answer", "report": expected}])
        loop = self.make_loop()

        res = await loop.run_agent_loop(agent, self.bundle)
        self.assertEqual(res, expected)
        self.assertEqual(agent.evaluate_call_count, 1)
        self.assertFalse(agent.force_synthesis_called)
        self.assertEqual(loop.turn_history, [])

    async def test_multiturn_flow_calling_tool_then_final_diagnosis(self) -> None:
        """Test tool execution followed by diagnosis synthesis on turn 2."""
        @self.registry.register("get_container_logs", "Inspect container stdout logs")
        async def mock_get_logs(tail_lines: int = 50, previous: bool = False) -> Dict[str, Any]:
            return {
                "logs": "panic: nil pointer dereference",
                "tail_lines": tail_lines,
                "previous": previous,
            }

        agent = DummyLoopAgent(
            decisions=[
                {
                    "action": "call",
                    "tool": "get_container_logs",
                    "args": {"tail_lines": 50, "previous": True},
                },
                {
                    "action": "final_answer",
                    "report": {
                        "summary": "Nil pointer dereference diagnosed",
                        "evidence": ["panic: nil pointer dereference"],
                        "hypotheses": ["Uninitialized pointer"],
                        "confidence": "high",
                    },
                },
            ]
        )
        loop = self.make_loop()
        res = await loop.run_agent_loop(agent, self.bundle)

        self.assertEqual(agent.evaluate_call_count, 2)
        self.assertIn("Nil pointer dereference", res["summary"])
        self.assertEqual(len(loop.turn_history), 1)
        self.assertEqual(loop.turn_history[0]["tool"], "get_container_logs")

        records = self.store.get_tool_calls()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].tool_name, "get_container_logs")
        self.assertEqual(records[0].status, "success")


class TestProgressiveLoopBounds(BaseLoopTestCase):
    """Tests covering bounded execution safeguards and forced synthesis."""

    async def test_max_turns_bounded_execution(self) -> None:
        """Verify hard termination at 3 turns when agent continually calls tools."""
        @self.registry.register("get_pod_status", "Return pod phase")
        async def mock_status() -> Dict[str, Any]:
            return {"phase": "Running"}

        agent = DummyLoopAgent(
            decisions=[{"action": "call", "tool": "get_pod_status", "args": {}}] * 4,
            synthesis_report={"summary": "Bounded synthesis stop", "confidence": "medium"},
        )
        loop = self.make_loop(max_turns=3)
        res = await loop.run_agent_loop(agent, self.bundle)

        self.assertEqual(agent.evaluate_call_count, 3)
        self.assertTrue(agent.force_synthesis_called)
        self.assertEqual(agent.last_instruction_received, MAX_DEPTH_INSTRUCTION)
        self.assertEqual(res["summary"], "Bounded synthesis stop")
        self.assertEqual(len(loop.turn_history), 3)

    async def test_custom_max_turns_bound(self) -> None:
        """Verify termination at custom limit of 1 turn."""
        @self.registry.register("probe_tool", "Probe tool")
        async def probe() -> Dict[str, Any]:
            return {"ok": True}

        agent = DummyLoopAgent(
            decisions=[{"action": "call", "tool": "probe_tool", "args": {}}],
            synthesis_report={"summary": "Stop after 1 turn", "confidence": "low"},
        )
        loop = self.make_loop(max_turns=1)
        res = await loop.run_agent_loop(agent, self.bundle)

        self.assertEqual(agent.evaluate_call_count, 1)
        self.assertTrue(agent.force_synthesis_called)
        self.assertEqual(res["summary"], "Stop after 1 turn")


class TestProgressiveLoopToolFormats(BaseLoopTestCase):
    """Tests covering diverse tool calling schemas and payloads."""

    async def test_native_function_calling_dict(self) -> None:
        """Verify handling of Ollama native tool_calls dictionary format."""
        @self.registry.register("get_container_logs", "Inspect logs")
        async def mock_logs(tail_lines: int = 50) -> Dict[str, Any]:
            return {"logs": "exit code 137"}

        agent = DummyLoopAgent(
            decisions=[
                {"tool_calls": [{"function": {"name": "get_container_logs", "arguments": {"tail_lines": 30}}}]},
                {"action": "final_answer", "report": {"summary": "OOM detected"}},
            ]
        )
        loop = self.make_loop()
        res = await loop.run_agent_loop(agent, self.bundle)

        self.assertEqual(res["summary"], "OOM detected")
        self.assertEqual(loop.turn_history[0]["args"]["tail_lines"], 30)

    async def test_native_function_calling_stringified_args(self) -> None:
        """Verify parsing of stringified JSON arguments in native tool calls."""
        @self.registry.register("get_deployment_spec", "Spec")
        async def mock_spec(replicas: int = 1) -> Dict[str, Any]:
            return {"replicas": replicas}

        agent = DummyLoopAgent(
            decisions=[
                {"tool_calls": [{"function": {"name": "get_deployment_spec", "arguments": '{"replicas": 4}'}}]},
                {"action": "final_answer", "report": {"summary": "Scale mismatch"}},
            ]
        )
        loop = self.make_loop()
        res = await loop.run_agent_loop(agent, self.bundle)

        self.assertEqual(res["summary"], "Scale mismatch")
        self.assertEqual(loop.turn_history[0]["args"]["replicas"], 4)

    async def test_native_function_calling_message_object(self) -> None:
        """Verify extraction from objects with message.tool_calls attribute."""
        @self.registry.register("get_pod_events", "Events")
        async def mock_events() -> Dict[str, Any]:
            return {"events": ["BackOff"]}

        mock_tc = MagicMock()
        mock_tc.function.name = "get_pod_events"
        mock_tc.function.arguments = {}
        mock_resp = MagicMock()
        mock_resp.message.tool_calls = [mock_tc]

        agent = DummyLoopAgent(
            decisions=[
                mock_resp,
                {"action": "final_answer", "report": {"summary": "BackOff event found"}},
            ]
        )
        loop = self.make_loop()
        res = await loop.run_agent_loop(agent, self.bundle)

        self.assertEqual(res["summary"], "BackOff event found")
        self.assertEqual(loop.turn_history[0]["tool"], "get_pod_events")

    async def test_call_tool_alias(self) -> None:
        """Verify compatibility with 'call_tool' action alias."""
        @self.registry.register("get_pod_events", "Events")
        async def mock_events() -> Dict[str, Any]:
            return {"events": ["OOMKilled"]}

        agent = DummyLoopAgent(
            decisions=[
                {"action": "call_tool", "tool": "get_pod_events", "args": {}},
                {"action": "final_answer", "report": {"summary": "Alias handled"}},
            ]
        )
        loop = self.make_loop()
        res = await loop.run_agent_loop(agent, self.bundle)

        self.assertEqual(res["summary"], "Alias handled")


class TestProgressiveLoopResilience(BaseLoopTestCase):
    """Tests covering error propagation and fallback behaviors."""

    async def test_tool_failure_feedback(self) -> None:
        """Verify tool error is preserved in history so agent can pivot."""
        @self.registry.register("failing_tool", "Throws")
        async def mock_fail() -> Dict[str, Any]:
            raise RuntimeError("API timeout")

        history_captured: List[Dict[str, Any]] = []

        def on_step(turn: int, history: List[Dict[str, Any]]) -> None:
            if turn == 1:
                history_captured.extend(history)

        agent = DummyLoopAgent(
            decisions=[
                {"action": "call", "tool": "failing_tool", "args": {}},
                {"action": "final_answer", "report": {"summary": "Pivoted after timeout"}},
            ],
            on_evaluate=on_step,
        )
        loop = self.make_loop()
        res = await loop.run_agent_loop(agent, self.bundle)

        self.assertEqual(res["summary"], "Pivoted after timeout")
        self.assertEqual(len(history_captured), 1)
        self.assertIn("error", history_captured[0]["result"])
        self.assertIn("API timeout", history_captured[0]["result"]["error"])

    async def test_agent_without_evaluate_step(self) -> None:
        """Verify fallback when agent only defines run_investigation."""
        class LegacyAgent:
            role = "legacy"
            def run_investigation(self, bundle: Any) -> Dict[str, Any]:
                return {"summary": "Legacy report", "confidence": "high"}

        loop = self.make_loop()
        res = await loop.run_agent_loop(LegacyAgent(), self.bundle)
        self.assertEqual(res["summary"], "Legacy report")

    async def test_agent_without_force_synthesis(self) -> None:
        """Verify fallback when agent exhausts turns without force_synthesis."""
        @self.registry.register("ping", "Ping")
        async def ping() -> Dict[str, Any]:
            return {"status": "ok"}

        class NoSynthAgent:
            role = "nosynth"
            async def evaluate_next_step(self, bundle: Any, history: Any) -> Dict[str, Any]:
                return {"action": "call", "tool": "ping", "args": {}}
            def run_investigation(self, bundle: Any) -> Dict[str, Any]:
                return {"summary": "Fallback investigation"}

        loop = self.make_loop(max_turns=1)
        res = await loop.run_agent_loop(NoSynthAgent(), self.bundle)
        self.assertEqual(res["summary"], "Fallback investigation")

    async def test_none_evidence_bundle(self) -> None:
        """Verify loop operates safely when bundle is None."""
        agent = DummyLoopAgent(decisions=[{"action": "final_answer", "report": {"summary": "Handled None"}}])
        loop = self.make_loop()
        res = await loop.run_agent_loop(agent, None)
        self.assertEqual(res["summary"], "Handled None")


if __name__ == "__main__":
    unittest.main()
