"""
Unit & Benchmark Tests — KDM v4.0.0 Phase 21: Concurrency, Latency & Resource Tuning
====================================================================================
Tests cover:
  - Task 21.1: Log Head/Tail Bounding & Clipping in tools/kubernetes.py.
  - Task 21.2: Ollama Chat Parameters optimization (num_ctx=4096, temperature=0.1, num_predict=512).
  - Task 21.3: Specialist system prompt minification (>= 40% reduction) and token budgeting.
  - End-to-end multi-agent council execution duration (< 30 seconds).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from typing import Dict
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

import ollama  # noqa: E402

from core.evidence import (  # noqa: E402
    CollectionStatus,
    EvidenceBundle,
    EvidenceItem,
    Target,
)
from council import AgentCouncil  # noqa: E402
from specialists.base import (  # noqa: E402
    DEFAULT_OLLAMA_OPTIONS,
    BaseSpecialistAgent,
    minify_system_prompt,
)
from specialists.config import ConfigDependencyAgent  # noqa: E402
from specialists.resource import ClusterResourceAgent  # noqa: E402
from specialists.runtime import RuntimeLogAgent  # noqa: E402
from tools.kubernetes import clip_log_lines, get_container_logs  # noqa: E402


# Baseline character counts from Phase 20 prompts (prior to Phase 21 minification)
BASELINE_PROMPT_LENGTHS: Dict[str, int] = {
    "runtime": 1044,
    "config": 1089,
    "resource": 1070,
}

# Maximum allowed tokens (estimated at 4 characters per token) for minified system prompts
MAX_SYSTEM_PROMPT_TOKENS: int = 150


class MockChatResponse:
    """Mock response object mimicking Ollama Python SDK chat response."""

    def __init__(self, content: str) -> None:
        self.message = MagicMock(content=content)


class DummySpecialist(BaseSpecialistAgent):
    """Minimal concrete specialist for testing BaseSpecialistAgent behavior."""

    role = "dummy"
    display_name = "Dummy Agent"
    icon = "⚡"

    def build_prompt(self, bundle: EvidenceBundle) -> str:
        return "Dummy prompt"


class TestLogHeadTailBounding(unittest.TestCase):
    """Task 21.1: Verification of Log Head/Tail Bounding and Clipping."""

    def test_unclipped_when_lines_within_threshold(self) -> None:
        """Logs with <= 100 lines must be returned unmodified without omission marker."""
        small_logs = [f"line {i}" for i in range(1, 51)]
        clipped = clip_log_lines(small_logs)
        self.assertEqual(clipped, small_logs)
        self.assertEqual(len(clipped), 50)

    def test_unclipped_at_exact_boundary(self) -> None:
        """Logs with exactly 100 lines must not be clipped."""
        boundary_logs = [f"log line {i}" for i in range(1, 101)]
        clipped = clip_log_lines(boundary_logs)
        self.assertEqual(clipped, boundary_logs)
        self.assertEqual(len(clipped), 100)

    def test_clipped_when_exceeding_threshold(self) -> None:
        """Logs > 100 lines must preserve first 20 lines, last 80 lines, and indicate omitted count."""
        total_lines = 150
        raw_logs = [f"log line {i}" for i in range(1, total_lines + 1)]

        clipped = clip_log_lines(raw_logs)

        # Expected: 20 head + 1 omitted marker + 80 tail = 101 lines
        self.assertEqual(len(clipped), 101)
        self.assertEqual(clipped[:20], raw_logs[:20])
        self.assertEqual(clipped[20], "... [50 lines omitted] ...")
        self.assertEqual(clipped[21:], raw_logs[-80:])

    def test_clipped_large_tail_log(self) -> None:
        """A 500-line log stream should omit exactly 400 middle lines."""
        raw_logs = [f"entry-{i:03d}" for i in range(1, 501)]

        clipped = clip_log_lines(raw_logs)

        self.assertEqual(len(clipped), 101)
        self.assertEqual(clipped[0], "entry-001")
        self.assertEqual(clipped[19], "entry-020")
        self.assertEqual(clipped[20], "... [400 lines omitted] ...")
        self.assertEqual(clipped[21], "entry-421")
        self.assertEqual(clipped[-1], "entry-500")

    def test_get_container_logs_applies_clipping(self) -> None:
        """get_container_logs tool must apply head/tail bounding to raw stdout."""
        raw_text = "\n".join([f"line-{i}" for i in range(1, 201)])
        proc_mock = MagicMock()
        proc_mock.returncode = 0
        proc_mock.communicate = AsyncMock(return_value=(raw_text.encode(), b""))

        with patch("asyncio.create_subprocess_exec", return_value=proc_mock):
            result = asyncio.run(
                get_container_logs("prod", "api-pod", "api-container", tail_lines=500)
            )

        lines = result.get("lines", [])
        self.assertEqual(len(lines), 101)
        self.assertEqual(lines[:20], [f"line-{i}" for i in range(1, 21)])
        self.assertEqual(lines[20], "... [100 lines omitted] ...")
        self.assertEqual(lines[-80:], [f"line-{i}" for i in range(121, 201)])

    def test_invalid_clipping_parameters_raise_value_error(self) -> None:
        """Negative counts or head + tail exceeding max_lines must raise ValueError."""
        with self.assertRaises(ValueError):
            clip_log_lines([], head=-1)

        with self.assertRaises(ValueError):
            clip_log_lines([], tail=-1)

        with self.assertRaises(ValueError):
            clip_log_lines([], max_lines=-1)

        with self.assertRaises(ValueError):
            clip_log_lines([], head=60, tail=50, max_lines=100)

    def test_clipping_with_zero_tail(self) -> None:
        """When tail=0, clipping must return only head lines and the omission marker without full log."""
        raw_logs = [f"line {i}" for i in range(1, 31)]
        clipped = clip_log_lines(raw_logs, head=10, tail=0, max_lines=20)
        self.assertEqual(len(clipped), 11)
        self.assertEqual(clipped[:10], raw_logs[:10])
        self.assertEqual(clipped[10], "... [20 lines omitted] ...")


class TestOllamaOptionsConfiguration(unittest.TestCase):
    """Task 21.2: Verification of Ollama Chat Options Optimization."""

    def setUp(self) -> None:
        self.mock_client = MagicMock()

    def test_default_ollama_options_values(self) -> None:
        """Verify DEFAULT_OLLAMA_OPTIONS has num_ctx=4096, temperature=0.1, num_predict=512."""
        expected = {
            "num_ctx": 4096,
            "temperature": 0.1,
            "num_predict": 512,
        }
        self.assertEqual(DEFAULT_OLLAMA_OPTIONS, expected)
        self.assertEqual(BaseSpecialistAgent.DEFAULT_OPTIONS, expected)

    def test_specialist_passes_num_ctx_options_to_chat(self) -> None:
        """run_investigation must pass options with num_ctx=4096, temperature=0.1, num_predict=512."""
        agent = DummySpecialist(self.mock_client, model="llama3.1:8b")
        payload = {
            "summary": "Sample diagnosis",
            "evidence": ["Ev 1"],
            "hypotheses": ["Hyp 1"],
            "confidence": "high",
        }
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps(payload)}
        }

        bundle = EvidenceBundle(target=Target("Pod", "test-pod", "default"))
        report = agent.run_investigation(bundle)

        self.assertEqual(report["summary"], "Sample diagnosis")
        self.mock_client.chat.assert_called_once()
        call_kwargs = self.mock_client.chat.call_args[1]

        self.assertEqual(call_kwargs["format"], "json")
        self.assertEqual(
            call_kwargs["options"],
            {"num_ctx": 4096, "temperature": 0.1, "num_predict": 512},
        )

    def test_custom_options_override(self) -> None:
        """Custom options provided during initialization must override defaults."""
        custom_opts = {"num_ctx": 2048, "temperature": 0.2, "num_predict": 256}
        agent = DummySpecialist(
            self.mock_client, model="llama3.1:8b", options=custom_opts
        )
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps({"summary": "ok"})}
        }

        bundle = EvidenceBundle(target=Target("Pod", "test-pod", "default"))
        agent.run_investigation(bundle)

        call_kwargs = self.mock_client.chat.call_args[1]
        self.assertEqual(call_kwargs["options"], custom_opts)

    def test_evaluate_next_step_and_force_synthesis_use_options(self) -> None:
        """Async evaluate_next_step and force_synthesis methods must use configured options."""
        agent = DummySpecialist(self.mock_client, model="llama3.1:8b")
        resp_payload = {
            "action": "final_answer",
            "report": {"summary": "Done", "confidence": "high"},
        }
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps(resp_payload)}
        }

        bundle = EvidenceBundle(target=Target("Pod", "test-pod", "default"))
        step_res = asyncio.run(agent.evaluate_next_step(bundle, []))
        self.assertEqual(step_res["action"], "final_answer")

        call_kwargs = self.mock_client.chat.call_args[1]
        self.assertEqual(
            call_kwargs["options"],
            {"num_ctx": 4096, "temperature": 0.1, "num_predict": 512},
        )

        synth_payload = {
            "summary": "Forced synthesis report",
            "confidence": "high",
            "evidence": ["ev1"],
        }
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps(synth_payload)}
        }
        synth_res = asyncio.run(agent.force_synthesis(bundle, []))
        self.assertEqual(synth_res["summary"], "Forced synthesis report")

        synth_call_kwargs = self.mock_client.chat.call_args[1]
        self.assertEqual(
            synth_call_kwargs["options"],
            {"num_ctx": 4096, "temperature": 0.1, "num_predict": 512},
        )


class TestPromptTokenBudget(unittest.TestCase):
    """Task 21.3: Token Budget and System Prompt Minification Assertions."""

    def setUp(self) -> None:
        self.mock_client = MagicMock()
        self.agents: Dict[str, BaseSpecialistAgent] = {
            "runtime": RuntimeLogAgent(self.mock_client, model="llama3.1:8b"),
            "config": ConfigDependencyAgent(self.mock_client, model="llama3.1:8b"),
            "resource": ClusterResourceAgent(self.mock_client, model="llama3.1:8b"),
        }

    def test_system_prompts_minified_by_at_least_forty_percent(self) -> None:
        """Specialist system prompts must be reduced in character length by >= 40%."""
        for role, agent in self.agents.items():
            baseline_len = BASELINE_PROMPT_LENGTHS[role]
            minified_prompt = agent.get_system_prompt()
            current_len = len(minified_prompt)

            reduction_ratio = (baseline_len - current_len) / baseline_len
            self.assertGreaterEqual(
                reduction_ratio,
                0.40,
                f"{role} specialist prompt reduced by {reduction_ratio:.1%}, which is under 40% target.",
            )

    def test_system_prompts_within_token_budget(self) -> None:
        """Each specialist system prompt must stay under MAX_SYSTEM_PROMPT_TOKENS budget."""
        for role, agent in self.agents.items():
            prompt = agent.get_system_prompt()
            # 1 token is approximately 4 characters in standard subword tokenization
            estimated_tokens = len(prompt) // 4
            self.assertLessEqual(
                estimated_tokens,
                MAX_SYSTEM_PROMPT_TOKENS,
                f"{role} specialist prompt has ~{estimated_tokens} tokens, exceeding budget of {MAX_SYSTEM_PROMPT_TOKENS}.",
            )

    def test_minify_system_prompt_utility(self) -> None:
        """minify_system_prompt utility should strip blank lines and trailing whitespaces."""
        padded_prompt = "\n\n  Line 1   \n\n   Line 2  \n\n"
        minified = minify_system_prompt(padded_prompt)
        self.assertEqual(minified, "Line 1\nLine 2")

    def test_full_prompt_fits_in_context_window(self) -> None:
        """Full user prompt assembled from clipped logs and metadata must easily fit in 4096 context."""
        agent = self.agents["runtime"]
        bundle = EvidenceBundle(
            target=Target("Pod", "cart-service-xyz", "production", "cart")
        )

        # 500 lines of logs clipped using clip_log_lines
        raw_logs = [f"2026-10-17 12:00:{i:02d} INFO processing cart request" for i in range(500)]
        clipped_logs = clip_log_lines(raw_logs)

        bundle.add(
            EvidenceItem(
                id="ev.pod.logs.previous",
                source="kubernetes",
                status=CollectionStatus.AVAILABLE,
                data="\n".join(clipped_logs),
            )
        )
        bundle.add(
            EvidenceItem(
                id="ev.pod.container.status",
                source="kubernetes",
                status=CollectionStatus.AVAILABLE,
                data={"restartCount": 5, "lastState": {"terminated": {"exitCode": 137, "reason": "OOMKilled"}}},
            )
        )

        user_prompt = agent.build_prompt(bundle)
        system_prompt = agent.get_system_prompt()

        total_text = f"{system_prompt}\n{user_prompt}"
        total_tokens = len(total_text) // 4

        # Assert total prompt is safely below 4096 context buffer limit (e.g. < 2500 tokens)
        self.assertLess(
            total_tokens,
            2500,
            f"Total combined prompt ({total_tokens} tokens) exceeds safe budget.",
        )


class TestCouncilExecutionSpeedBenchmark(unittest.TestCase):
    """End-to-End Latency Benchmark: Council analysis completes in < 30 seconds."""

    def test_council_execution_under_thirty_seconds(self) -> None:
        """Multi-agent council pipeline execution must complete in < 30 seconds."""
        mock_client = MagicMock()
        mock_payload = {
            "rootCause": "Container memory limit 256Mi was exceeded under peak load.",
            "confidence": "high",
            "bestSolution": {
                "actionTitle": "Increase Memory Limits",
                "steps": ["Increase memory limits to 512Mi", "Redeploy pod"],
                "commandToRun": "kubectl set resources deployment order-api --limits=memory=512Mi",
                "riskLevel": "low",
            },
        }
        mock_client.chat.return_value = MockChatResponse(json.dumps(mock_payload))

        council = AgentCouncil(client=mock_client, model="llama3.1:8b")

        start = time.perf_counter()
        diagnosis = council.run(
            failure_text="Back-off restarting failed container\nExit Code: 137 (OOMKilled)",
            context={"namespace": "default", "kind": "Pod", "name": "order-api"},
        )
        duration = time.perf_counter() - start

        self.assertLess(
            duration,
            30.0,
            f"Council execution took {duration:.2f}s, exceeding 30s threshold.",
        )
        self.assertIsNotNone(diagnosis)
        self.assertIn("memory limit", diagnosis.root_cause.lower())

    def test_live_ollama_council_execution_under_thirty_seconds(self) -> None:
        """Opt-in live model benchmark: verify real multi-agent council latency < 30s.

        Skipped unless KDM_RUN_LIVE_BENCHMARKS=1 is set and Ollama daemon is reachable.
        """
        if os.getenv("KDM_RUN_LIVE_BENCHMARKS") != "1":
            self.skipTest(
                "Live Ollama benchmarks disabled. Set KDM_RUN_LIVE_BENCHMARKS=1 to enable."
            )

        model = os.getenv("KDM_BENCHMARK_MODEL", "llama3.1:8b")
        client = ollama.Client()
        try:
            client.show(model)
        except Exception as exc:
            self.skipTest(f"Live Ollama model '{model}' not reachable or available: {exc}")

        council = AgentCouncil(client=client, model=model)
        start = time.perf_counter()
        diagnosis = council.run(
            failure_text="Back-off restarting failed container\nExit Code: 137 (OOMKilled)",
            context={"namespace": "default", "kind": "Pod", "name": "order-api"},
        )
        duration = time.perf_counter() - start
        self.assertLess(
            duration,
            30.0,
            f"Live council execution took {duration:.2f}s, exceeding 30s requirement.",
        )
        self.assertIsNotNone(diagnosis)


if __name__ == "__main__":
    unittest.main()
