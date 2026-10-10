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


class TestProgressiveInvestigationLoop(unittest.IsolatedAsyncioTestCase):
    """Unit tests for ProgressiveInvestigationLoop execution and bounds."""

    def setUp(self) -> None:
        """Create clean ToolRegistry and EvidenceStore instances for each test."""
        self.store = EvidenceStore()
        self.registry = ToolRegistry(store=self.store)
        self.bundle = _build_test_bundle()

    def test_default_initialization(self) -> None:
        """Verify default and custom parameter initialization."""
        loop = ProgressiveInvestigationLoop()
        self.assertEqual(loop.max_turns, 3)
        self.assertIsInstance(loop.tools, ToolRegistry)
        self.assertIsInstance(loop.store, EvidenceStore)
        self.assertEqual(loop.turn_history, [])

        custom_store = EvidenceStore()
        custom_registry = ToolRegistry(store=custom_store)
        custom_loop = ProgressiveInvestigationLoop(
            tool_registry=custom_registry,
            evidence_store=custom_store,
            max_turns=5,
        )
        self.assertEqual(custom_loop.max_turns, 5)
        self.assertIs(custom_loop.tools, custom_registry)
        self.assertIs(custom_loop.store, custom_store)

    async def test_single_turn_final_answer(self) -> None:
        """Verify that agent returning final_answer on turn 1 terminates immediately."""
        expected_report = {
            "summary": "Pod is healthy with zero restarts",
            "evidence": ["restarts: 0"],
            "hypotheses": [],
            "confidence": "high",
        }
        agent = DummyLoopAgent(
            decisions=[{"action": "final_answer", "report": expected_report}]
        )
        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=3,
        )

        result = await loop.run_agent_loop(agent, self.bundle)
        self.assertEqual(result, expected_report)
        self.assertEqual(agent.evaluate_call_count, 1)
        self.assertFalse(agent.force_synthesis_called)
        self.assertEqual(len(loop.turn_history), 0)

    async def test_multiturn_flow_calling_tool_then_final_diagnosis(self) -> None:
        """Test multi-turn flow where agent calls get_container_logs and produces final diagnosis."""
        @self.registry.register(
            "get_container_logs", "Inspect container stdout and stderr logs"
        )
        async def mock_get_logs(tail_lines: int = 50, previous: bool = False) -> Dict[str, Any]:
            return {
                "logs": "panic: runtime error: invalid memory address or nil pointer dereference",
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
                        "summary": "Nil pointer dereference in cart service main loop",
                        "evidence": ["panic: runtime error: invalid memory address"],
                        "hypotheses": ["Uninitialized pointer access"],
                        "confidence": "high",
                    },
                },
            ]
        )
        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=3,
        )

        result = await loop.run_agent_loop(agent, self.bundle)
        self.assertEqual(agent.evaluate_call_count, 2)
        self.assertFalse(agent.force_synthesis_called)
        self.assertIn("Nil pointer dereference", result["summary"])
        self.assertEqual(len(loop.turn_history), 1)
        self.assertEqual(loop.turn_history[0]["tool"], "get_container_logs")
        self.assertEqual(loop.turn_history[0]["args"]["tail_lines"], 50)
        self.assertIn("nil pointer dereference", loop.turn_history[0]["result"]["logs"])

        # Check that tool execution was recorded in EvidenceStore
        tool_calls = self.store.get_tool_calls()
        self.assertEqual(len(tool_calls), 1)
        self.assertEqual(tool_calls[0].tool_name, "get_container_logs")
        self.assertEqual(tool_calls[0].status, "success")

    async def test_max_turns_bounded_execution(self) -> None:
        """Verify hard termination at max_turns=3 and invocation of force_synthesis."""
        @self.registry.register("get_pod_status", "Return pod phase and container states")
        async def mock_get_status() -> Dict[str, Any]:
            return {"phase": "Running", "ready": True}

        # Agent continually requests tool calls forever
        agent = DummyLoopAgent(
            decisions=[
                {"action": "call", "tool": "get_pod_status", "args": {}},
                {"action": "call", "tool": "get_pod_status", "args": {}},
                {"action": "call", "tool": "get_pod_status", "args": {}},
                {"action": "call", "tool": "get_pod_status", "args": {}},
            ],
            synthesis_report={
                "summary": "Forced synthesis at max investigation depth",
                "evidence": ["phase: Running"],
                "hypotheses": ["Transient flap"],
                "confidence": "medium",
            },
        )
        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=3,
        )

        result = await loop.run_agent_loop(agent, self.bundle)
        self.assertEqual(agent.evaluate_call_count, 3)
        self.assertTrue(agent.force_synthesis_called)
        self.assertEqual(agent.last_instruction_received, MAX_DEPTH_INSTRUCTION)
        self.assertEqual(result["summary"], "Forced synthesis at max investigation depth")
        self.assertEqual(len(loop.turn_history), 3)

    async def test_custom_max_turns_bound(self) -> None:
        """Verify loop respects custom max_turns=1 constraint."""
        @self.registry.register("dummy_tool", "Dummy tool")
        async def dummy_tool() -> Dict[str, Any]:
            return {"status": "ok"}

        agent = DummyLoopAgent(
            decisions=[{"action": "call", "tool": "dummy_tool", "args": {}}],
            synthesis_report={"summary": "Terminated at 1 turn", "confidence": "low"},
        )
        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=1,
        )

        result = await loop.run_agent_loop(agent, self.bundle)
        self.assertEqual(agent.evaluate_call_count, 1)
        self.assertTrue(agent.force_synthesis_called)
        self.assertEqual(result["summary"], "Terminated at 1 turn")
        self.assertEqual(len(loop.turn_history), 1)

    async def test_tool_failure_feedback_in_loop(self) -> None:
        """Verify that tool failures are fed back to the agent in history to allow pivoting."""
        @self.registry.register("failing_tool", "Tool that raises an error")
        async def failing_tool() -> Dict[str, Any]:
            raise RuntimeError("Connection refused by Kubernetes API server")

        @self.registry.register("fallback_tool", "Alternative tool")
        async def fallback_tool() -> Dict[str, Any]:
            return {"node": "worker-1", "ready": True}

        observed_histories: List[List[Dict[str, Any]]] = []

        def on_evaluate(turn: int, history: List[Dict[str, Any]]) -> None:
            observed_histories.append([dict(h) for h in history])

        agent = DummyLoopAgent(
            decisions=[
                {"action": "call", "tool": "failing_tool", "args": {}},
                {"action": "call", "tool": "fallback_tool", "args": {}},
                {
                    "action": "final_answer",
                    "report": {
                        "summary": "Pivoted after API connection failure",
                        "evidence": ["API failed", "node ready"],
                        "hypotheses": ["API server network partition"],
                        "confidence": "medium",
                    },
                },
            ],
            on_evaluate=on_evaluate,
        )
        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=3,
        )

        result = await loop.run_agent_loop(agent, self.bundle)
        self.assertEqual(agent.evaluate_call_count, 3)
        self.assertEqual(result["summary"], "Pivoted after API connection failure")

        # In turn 2 (index 1 of observed_histories), history contains the error from failing_tool
        turn_2_history = observed_histories[1]
        self.assertEqual(len(turn_2_history), 1)
        self.assertEqual(turn_2_history[0]["tool"], "failing_tool")
        self.assertIn("error", turn_2_history[0]["result"])
        self.assertIn("Connection refused", str(turn_2_history[0]["result"]["error"]))

    async def test_ollama_native_function_calling_dict(self) -> None:
        """Verify handling of Ollama native function calling format in dictionary form."""
        @self.registry.register("get_container_logs", "Inspect logs")
        async def mock_logs(tail_lines: int = 50) -> Dict[str, Any]:
            return {"logs": "OOMKilled exit code 137"}

        agent = DummyLoopAgent(
            decisions=[
                {
                    "tool_calls": [
                        {
                            "function": {
                                "name": "get_container_logs",
                                "arguments": {"tail_lines": 25},
                            }
                        }
                    ]
                },
                {
                    "action": "final_answer",
                    "report": {
                        "summary": "Container was killed due to out of memory",
                        "confidence": "high",
                    },
                },
            ]
        )
        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=3,
        )

        result = await loop.run_agent_loop(agent, self.bundle)
        self.assertEqual(result["summary"], "Container was killed due to out of memory")
        self.assertEqual(len(loop.turn_history), 1)
        self.assertEqual(loop.turn_history[0]["args"]["tail_lines"], 25)

    async def test_ollama_native_function_calling_stringified_json_args(self) -> None:
        """Verify handling of Ollama native function calling with stringified JSON arguments."""
        @self.registry.register("get_deployment_spec", "Inspect deployment")
        async def mock_spec(replicas: int = 1) -> Dict[str, Any]:
            return {"replicas": replicas}

        agent = DummyLoopAgent(
            decisions=[
                {
                    "tool_calls": [
                        {
                            "function": {
                                "name": "get_deployment_spec",
                                "arguments": '{"replicas": 3}',
                            }
                        }
                    ]
                },
                {
                    "action": "final_answer",
                    "report": {"summary": "Deployment replica mismatch", "confidence": "high"},
                },
            ]
        )
        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=3,
        )

        result = await loop.run_agent_loop(agent, self.bundle)
        self.assertEqual(result["summary"], "Deployment replica mismatch")
        self.assertEqual(loop.turn_history[0]["args"], {"replicas": 3})

    async def test_ollama_response_object_with_message_tool_calls(self) -> None:
        """Verify handling of Ollama ChatResponse-like objects with message.tool_calls."""
        @self.registry.register("get_pod_events", "Get events")
        async def mock_events() -> Dict[str, Any]:
            return {"events": ["BackOff: ImagePullBackOff"]}

        mock_call = MagicMock()
        mock_call.function.name = "get_pod_events"
        mock_call.function.arguments = {}

        mock_response = MagicMock()
        mock_response.message.tool_calls = [mock_call]

        agent = DummyLoopAgent(
            decisions=[
                mock_response,
                {
                    "action": "final_answer",
                    "report": {"summary": "Image pull failure detected", "confidence": "high"},
                },
            ]
        )
        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=3,
        )

        result = await loop.run_agent_loop(agent, self.bundle)
        self.assertEqual(result["summary"], "Image pull failure detected")
        self.assertEqual(len(loop.turn_history), 1)
        self.assertEqual(loop.turn_history[0]["tool"], "get_pod_events")

    async def test_structured_json_call_tool_alias(self) -> None:
        """Verify support for 'call_tool' action alias."""
        @self.registry.register("get_pod_events", "Get events")
        async def mock_events() -> Dict[str, Any]:
            return {"events": ["OOMKilled"]}

        agent = DummyLoopAgent(
            decisions=[
                {"action": "call_tool", "tool": "get_pod_events", "args": {}},
                {"action": "final_answer", "report": {"summary": "OOMKilled event confirmed"}},
            ]
        )
        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=3,
        )

        result = await loop.run_agent_loop(agent, self.bundle)
        self.assertEqual(result["summary"], "OOMKilled event confirmed")
        self.assertEqual(len(loop.turn_history), 1)

    async def test_agent_lacking_evaluate_next_step(self) -> None:
        """Verify backward compatibility when agent only provides run_investigation."""
        class LegacyAgent:
            role = "legacy"
            def run_investigation(self, bundle: Optional[EvidenceBundle]) -> Dict[str, Any]:
                return {"summary": "Legacy report output", "confidence": "medium"}

        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=3,
        )
        result = await loop.run_agent_loop(LegacyAgent(), self.bundle)
        self.assertEqual(result["summary"], "Legacy report output")

    async def test_agent_lacking_force_synthesis(self) -> None:
        """Verify fallback when agent exhausts max turns but lacks force_synthesis."""
        @self.registry.register("sample_tool", "Sample tool")
        async def sample_tool() -> Dict[str, Any]:
            return {"val": 1}

        class NoSynthAgent:
            role = "nosynth"
            async def evaluate_next_step(self, bundle: Any, history: Any) -> Dict[str, Any]:
                return {"action": "call", "tool": "sample_tool", "args": {}}
            def run_investigation(self, bundle: Any) -> Dict[str, Any]:
                return {"summary": "Fallback investigation output", "confidence": "low"}

        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=2,
        )
        result = await loop.run_agent_loop(NoSynthAgent(), self.bundle)
        self.assertEqual(result["summary"], "Fallback investigation output")

    async def test_none_evidence_bundle_handling(self) -> None:
        """Verify progressive loop runs cleanly when bundle is None."""
        agent = DummyLoopAgent(
            decisions=[{"action": "final_answer", "report": {"summary": "None bundle handled"}}]
        )
        loop = ProgressiveInvestigationLoop(
            tool_registry=self.registry,
            evidence_store=self.store,
            max_turns=3,
        )
        result = await loop.run_agent_loop(agent, None)
        self.assertEqual(result["summary"], "None bundle handled")


if __name__ == "__main__":
    unittest.main()
