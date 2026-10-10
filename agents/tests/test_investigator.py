"""
Unit Tests — Lead SRE Investigator Agent & Hypothesis Engine (Phase 8)
======================================================================
Tests cover:
  - Task 8.1: Hypothesis dataclass model, defaults, validation, and serialization.
  - Task 8.2: LeadInvestigatorAgent system prompt, prompt building, and LLM calls.
  - Task 8.3: Cross-specialist synthesis:
      * Complementary findings (e.g. Runtime OOM + Resource limit).
      * Conflicting findings with contradicting evidence.
      * Secondary cascade symptom elimination (e.g. probe failure vs OOM).
      * Low confidence / inconclusive evidence (likelihood < 0.5).
      * Robust JSON parsing: arrays, objects, markdown fences, malformed responses.
      * Async synthesis execution via formulate_hypotheses_async.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any, Dict, List
import unittest
from unittest.mock import MagicMock

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.synthesis.hypotheses import Hypothesis
    from agents.synthesis.investigator import LeadInvestigatorAgent
except ImportError:
    from synthesis.hypotheses import Hypothesis  # type: ignore[no-redef]
    from synthesis.investigator import LeadInvestigatorAgent  # type: ignore[no-redef]


class MockChatResponse:
    """Mock container representing an Ollama chat response object."""

    def __init__(self, content: str) -> None:
        self.message = MagicMock(content=content)

    def __getitem__(self, item: str) -> Any:
        if item == "message":
            return {"content": self.message.content}
        raise KeyError(item)


class TestHypothesisModel(unittest.TestCase):
    """Tests for :class:`~agents.synthesis.hypotheses.Hypothesis` dataclass."""

    def test_hypothesis_initialization_and_defaults(self) -> None:
        """Verify Hypothesis fields and default contradicting_evidence list."""
        hyp = Hypothesis(
            id="hyp-01",
            description="Process crashed with exit code 1",
            likelihood=0.85,
            supporting_evidence=["Exit code 1", "Panic log"],
        )
        self.assertEqual(hyp.id, "hyp-01")
        self.assertEqual(hyp.description, "Process crashed with exit code 1")
        self.assertEqual(hyp.likelihood, 0.85)
        self.assertEqual(hyp.supporting_evidence, ["Exit code 1", "Panic log"])
        self.assertEqual(hyp.contradicting_evidence, [])

    def test_hypothesis_to_dict_serialization(self) -> None:
        """Verify to_dict returns serializable dictionary with rounded likelihood."""
        hyp = Hypothesis(
            id="hyp-02",
            description="Memory leak in application",
            likelihood=0.45678,
            supporting_evidence=["Memory growth"],
            contradicting_evidence=["No OOMKill"],
        )
        data = hyp.to_dict()
        self.assertEqual(data["id"], "hyp-02")
        self.assertEqual(data["likelihood"], 0.4568)
        self.assertEqual(data["supporting_evidence"], ["Memory growth"])
        self.assertEqual(data["contradicting_evidence"], ["No OOMKill"])

    def test_hypothesis_from_dict_deserialization(self) -> None:
        """Verify from_dict sanitizes fields, clamps probability, and handles edge types."""
        cases = [
            ({"id": "h1", "description": "d1", "likelihood": 1.5, "supporting_evidence": ["e1"]}, 1.0),
            ({"id": "h2", "description": "d2", "likelihood": -0.2, "supporting_evidence": "e2"}, 0.0),
            ({"id": "h3", "description": "d3", "likelihood": "invalid", "supporting_evidence": []}, 0.5),
        ]
        for payload, expected_likelihood in cases:
            with self.subTest(payload=payload):
                instance = Hypothesis.from_dict(payload)
                self.assertEqual(instance.likelihood, expected_likelihood)
                self.assertIsInstance(instance.supporting_evidence, list)
                self.assertIsInstance(instance.contradicting_evidence, list)


class TestLeadInvestigatorSynthesis(unittest.TestCase):
    """Tests for :class:`~agents.synthesis.investigator.LeadInvestigatorAgent`."""

    def setUp(self) -> None:
        self.mock_client = MagicMock()
        self.agent = LeadInvestigatorAgent(self.mock_client, model="llama3.1")

    def make_finding(self, role: str, summary: str, evidence: List[str], conf: str = "high") -> Dict[str, Any]:
        """Create standard specialist finding dictionary."""
        return {
            "role": role,
            "summary": summary,
            "evidence": evidence,
            "hypotheses": [summary],
            "confidence": conf,
        }

    def test_agent_metadata_and_system_prompt(self) -> None:
        """Verify agent role, display properties, and Incident Commander instructions."""
        self.assertEqual(self.agent.role, "lead_investigator")
        self.assertEqual(self.agent.display_name, "Lead SRE Investigator")
        self.assertEqual(self.agent.icon, "🎯")

        prompt = self.agent.get_system_prompt()
        self.assertIn("Principal SRE Incident Commander", prompt)
        self.assertIn("Discard secondary cascade symptoms", prompt)
        self.assertIn("likelihood < 0.5", prompt)
        self.assertIn("ranked competing hypotheses", prompt)

    def test_synthesis_with_complementary_findings(self) -> None:
        """Verify synthesis when Runtime and Resource specialists provide complementary facts."""
        runtime_finding = self.make_finding(
            "runtime",
            "Container terminated with exit code 137",
            ["Exit code 137", "Reason: OOMKilled", "lastState.terminated"],
        )
        resource_finding = self.make_finding(
            "resource",
            "Node memory limits constrained",
            ["Memory limit 256Mi", "cgroup memory limit reached"],
        )

        llm_hypotheses = [
            {
                "id": "hyp-01",
                "description": "Application OOMKilled due to 256Mi memory limit under peak load.",
                "likelihood": 0.92,
                "supporting_evidence": ["Exit code 137", "Memory limit 256Mi", "OOMKilled reason"],
                "contradicting_evidence": [],
            },
            {
                "id": "hyp-02",
                "description": "Slow memory leak triggered by database reconnection loop.",
                "likelihood": 0.45,
                "supporting_evidence": ["Container restarted repeatedly"],
                "contradicting_evidence": ["Node MemoryPressure is False"],
            },
        ]
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps(llm_hypotheses)}
        }

        results = self.agent.formulate_hypotheses([runtime_finding, resource_finding])

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].id, "hyp-01")
        self.assertEqual(results[0].likelihood, 0.92)
        self.assertEqual(len(results[0].supporting_evidence), 3)
        self.assertEqual(results[0].contradicting_evidence, [])

        self.assertEqual(results[1].id, "hyp-02")
        self.assertEqual(results[1].likelihood, 0.45)
        self.assertEqual(results[1].contradicting_evidence, ["Node MemoryPressure is False"])

        # Check call options
        self.mock_client.chat.assert_called_once()
        call_kwargs = self.mock_client.chat.call_args[1]
        self.assertEqual(call_kwargs["format"], "json")
        self.assertEqual(call_kwargs["options"], {"temperature": 0.1})

    def test_synthesis_with_conflicting_findings(self) -> None:
        """Verify synthesis handles conflicting findings and ranks competing hypotheses."""
        runtime_finding = self.make_finding(
            "runtime",
            "Application crash in database connection loop",
            ["Database connection timeout in stderr", "Exit code 1"],
        )
        config_finding = self.make_finding(
            "config",
            "ConfigMap and Secret verified valid",
            ["ConfigMap 'app-cfg' exists", "Secret 'db-pass' present"],
        )
        resource_finding = self.make_finding(
            "resource",
            "Node resources healthy",
            ["Node MemoryPressure is False", "CPU usage normal"],
        )

        competing_hypotheses = [
            {
                "id": "hyp-01",
                "description": "External database unreachable or network partition.",
                "likelihood": 0.78,
                "supporting_evidence": ["Database connection timeout in stderr", "Exit code 1"],
                "contradicting_evidence": ["Secret db-pass present"],
            },
            {
                "id": "hyp-02",
                "description": "Database credential invalid despite Secret presence.",
                "likelihood": 0.42,
                "supporting_evidence": ["Repeated crash on DB init"],
                "contradicting_evidence": ["ConfigMap and Secret verified valid"],
            },
        ]
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps(competing_hypotheses)}
        }

        results = self.agent.formulate_hypotheses([runtime_finding, config_finding, resource_finding])

        self.assertEqual(len(results), 2)
        self.assertGreater(results[0].likelihood, results[1].likelihood)
        self.assertIn("Secret db-pass present", results[0].contradicting_evidence)
        self.assertIn("ConfigMap and Secret verified valid", results[1].contradicting_evidence)

    def test_low_confidence_inconclusive_findings(self) -> None:
        """Verify that inconclusive evidence assigns likelihood < 0.5."""
        ambiguous_finding = self.make_finding(
            "runtime",
            "Transient container restart observed",
            ["Process restart count 1"],
            conf="low",
        )
        inconclusive_hypotheses = [
            {
                "id": "hyp-01",
                "description": "Transient node network jitter or momentary container hiccup.",
                "likelihood": 0.38,
                "supporting_evidence": ["Restart count 1"],
                "contradicting_evidence": ["No error logs recorded"],
            },
            {
                "id": "hyp-02",
                "description": "Flaky liveness probe timing during startup.",
                "likelihood": 0.22,
                "supporting_evidence": ["Pod in Running state"],
                "contradicting_evidence": ["Probe status healthy"],
            },
        ]
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps(inconclusive_hypotheses)}
        }

        results = self.agent.formulate_hypotheses([ambiguous_finding])

        self.assertEqual(len(results), 2)
        for h in results:
            self.assertLess(h.likelihood, 0.5)

    def test_response_parsing_formats_and_fences(self) -> None:
        """Verify handling of markdown fences, nested dicts, and chat object responses."""
        hyp_data = [
            {
                "id": "hyp-01",
                "description": "Fenced hypothesis test",
                "likelihood": 0.88,
                "supporting_evidence": ["Evidence A"],
                "contradicting_evidence": [],
            }
        ]
        fenced_payload = f"```json\n{json.dumps(hyp_data)}\n```"

        # Fenced response
        self.mock_client.chat.return_value = {"message": {"content": fenced_payload}}
        res1 = self.agent.formulate_hypotheses([self.make_finding("runtime", "Crash", ["Crash"])])
        self.assertEqual(res1[0].id, "hyp-01")

        # Object with 'hypotheses' key
        nested_payload = json.dumps({"hypotheses": hyp_data})
        self.mock_client.chat.return_value = MockChatResponse(nested_payload)
        res2 = self.agent.formulate_hypotheses([self.make_finding("runtime", "Crash", ["Crash"])])
        self.assertEqual(res2[0].id, "hyp-01")

    def test_empty_findings_and_fallback_recovery(self) -> None:
        """Verify graceful fallback when findings are empty or client raises an error."""
        # Empty findings
        empty_res = self.agent.formulate_hypotheses([])
        self.assertGreater(len(empty_res), 0)
        self.assertLess(empty_res[0].likelihood, 0.5)

        # Exception recovery
        self.mock_client.chat.side_effect = RuntimeError("Ollama connection failed")
        fallback_res = self.agent.formulate_hypotheses([
            self.make_finding("runtime", "OOMKilled", ["Exit code 137", "Reason: OOMKilled"])
        ])
        self.assertGreater(len(fallback_res), 0)
        self.assertEqual(fallback_res[0].id, "hyp-01")
        self.assertGreaterEqual(fallback_res[0].likelihood, 0.8)

    def test_async_formulate_hypotheses(self) -> None:
        """Verify async wrapper formulate_hypotheses_async executes cleanly."""
        hyp_data = [
            {
                "id": "hyp-01",
                "description": "Async hypothesis execution",
                "likelihood": 0.90,
                "supporting_evidence": ["Async evidence"],
                "contradicting_evidence": [],
            }
        ]
        self.mock_client.chat.return_value = {"message": {"content": json.dumps(hyp_data)}}

        async def run_test() -> List[Hypothesis]:
            return await self.agent.formulate_hypotheses_async([
                self.make_finding("runtime", "Async test", ["Async evidence"])
            ])

        results = asyncio.run(run_test())
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].id, "hyp-01")
        self.assertEqual(results[0].likelihood, 0.90)


if __name__ == "__main__":
    unittest.main()
