"""
End-to-End Evaluation Test Suite — KDM v4.0.0 (Phase 20)
=========================================================
Offline benchmark suite verifying deterministic RuleEngine evaluation,
multi-agent AgentCouncil deliberation (mocked Ollama), and consensus
root-cause accuracy across 5 canonical real-world Kubernetes failure scenarios:
  1. OOMKill (exit code 137, 256Mi memory limit breached)
  2. CrashLoop (exit code 1, restartCount 10, application panic traceback)
  3. Missing Secret (CreateContainerConfigError, secretKeyRef not found)
  4. Node Pressure (MemoryPressure=True, pod eviction)
  5. Probe Failure (Liveness probe failed 3 times causing container kill)
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import time
from typing import Any
import unittest
from unittest.mock import MagicMock

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_REPO_ROOT = os.path.abspath(os.path.join(_AGENTS_DIR, ".."))
for _p in (_REPO_ROOT, _AGENTS_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from agents.council import AgentCouncil
    from agents.core.evidence import EvidenceBundle
    from agents.rules.engine import RuleEngine
    from agents.synthesis.consensus import CONFIDENCE_HIGH, ConsensusDiagnosis
except ImportError:
    from council import AgentCouncil  # type: ignore[no-redef]
    from core.evidence import EvidenceBundle  # type: ignore[no-redef]
    from rules.engine import RuleEngine  # type: ignore[no-redef]
    from synthesis.consensus import CONFIDENCE_HIGH, ConsensusDiagnosis  # type: ignore[no-redef]

FIXTURES_DIR = Path(__file__).parent / "fixtures"
CANONICAL_SCENARIOS = ("oomkill", "crashloop", "missing_secret", "node_pressure", "probe_failure")


class MockChatResponse:
    """Mock container representing Ollama SDK chat response object."""

    def __init__(self, content: str) -> None:
        self.message = MagicMock()
        self.message.content = content

    def __getitem__(self, item: str) -> Any:
        if item == "message":
            return {"content": self.message.content}
        raise KeyError(item)


def load_fixture_bundle(scenario_name: str) -> EvidenceBundle:
    """Load and deserialize an EvidenceBundle fixture from disk."""
    bundle_path = FIXTURES_DIR / scenario_name / "bundle.json"
    if not bundle_path.exists():
        raise FileNotFoundError(f"Fixture not found at {bundle_path}")
    data = json.loads(bundle_path.read_text(encoding="utf-8"))
    return EvidenceBundle.from_dict(data)


class TestE2EScenarios(unittest.TestCase):
    """Evaluation test runner verifying canonical SRE scenarios 100% offline."""

    def setUp(self) -> None:
        """Initialize mock client and rule engine for each test."""
        self.mock_client = MagicMock()
        self.rule_engine = RuleEngine()
        self.council = AgentCouncil(client=self.mock_client, rule_engine=self.rule_engine)

    def _verify_bypass_rule(self, bundle: EvidenceBundle, expected_rule_id: str) -> None:
        """Assert rule matches deterministically with high confidence and triggers LLM bypass."""
        primary_match = self.rule_engine.get_primary_match(bundle)
        self.assertIsNotNone(primary_match)
        self.assertEqual(primary_match.rule_id, expected_rule_id)
        self.assertEqual(primary_match.confidence, 1.0)
        self.assertTrue(self.rule_engine.should_bypass_llm(primary_match))

    def _verify_council_diagnosis(
        self,
        bundle: EvidenceBundle,
        expected_keywords: list[str],
        target_in_cause: str | None = None,
    ) -> ConsensusDiagnosis:
        """Assert diagnosis is valid ConsensusDiagnosis with high confidence and expected keywords."""
        diagnosis = self.council.diagnose(bundle)
        self.assertIsInstance(diagnosis, ConsensusDiagnosis)
        self.assertEqual(diagnosis.confidence, CONFIDENCE_HIGH)
        cause_lower = diagnosis.root_cause.lower()
        self.assertTrue(
            any(kw.lower() in cause_lower for kw in expected_keywords),
            f"Expected one of {expected_keywords} in root cause, got: {diagnosis.root_cause}",
        )
        if target_in_cause:
            self.assertIn(target_in_cause, diagnosis.root_cause)
        self.assertGreaterEqual(len(diagnosis.best_solution.steps), 2)
        return diagnosis

    def _run_bypass_scenario(
        self,
        scenario_name: str,
        rule_id: str,
        expected_keywords: list[str],
        target_in_cause: str,
    ) -> None:
        """Execute a deterministic rule bypass scenario end-to-end."""
        bundle = load_fixture_bundle(scenario_name)
        self._verify_bypass_rule(bundle, rule_id)
        self._verify_council_diagnosis(bundle, expected_keywords, target_in_cause)

    def _run_mocked_llm_scenario(
        self,
        scenario_name: str,
        mock_payload: dict[str, Any],
        expected_keywords: list[str],
        expected_cmd_substr: str,
    ) -> None:
        """Execute scenario verifying LLM consultation and consensus synthesis."""
        bundle = load_fixture_bundle(scenario_name)
        primary_match = self.rule_engine.get_primary_match(bundle)
        self.assertFalse(self.rule_engine.should_bypass_llm(primary_match))
        self.mock_client.chat.return_value = MockChatResponse(json.dumps(mock_payload))

        diagnosis = self._verify_council_diagnosis(bundle, expected_keywords)
        self.assertIn(expected_cmd_substr, diagnosis.best_solution.command_to_run)

    def _run_offline_fallback_scenario(
        self,
        scenario_name: str,
        expected_keywords: list[str],
        expected_cmd_substr: str,
    ) -> None:
        """Execute scenario verifying offline heuristic fallback when Ollama is unreachable."""
        bundle = load_fixture_bundle(scenario_name)
        self.mock_client.chat.side_effect = RuntimeError("Ollama daemon unavailable")

        diagnosis = self._verify_council_diagnosis(bundle, expected_keywords)
        self.assertIn(expected_cmd_substr, diagnosis.best_solution.command_to_run)

    def test_oomkill_scenario_rule_engine_and_council(self) -> None:
        """Scenario 1: Pod terminated with exit code 137 and OOMKilled."""
        self._run_bypass_scenario(
            "oomkill",
            "rule.kubernetes.oom_killed",
            ["137", "oomkilled", "memory limit"],
            "payment-api",
        )

    def test_crashloop_scenario_rule_engine_and_council(self) -> None:
        """Scenario 2: Pod in CrashLoopBackOff with application panic logs."""
        self._run_bypass_scenario(
            "crashloop",
            "rule.kubernetes.crashloop_backoff",
            ["crashloop", "crashed", "exitcode: 1"],
            "auth-server",
        )

    def test_missing_secret_scenario_rule_engine_and_council(self) -> None:
        """Scenario 3: Pod in CreateContainerConfigError due to missing Secret."""
        payload = {
            "rootCause": "Pod 'billing-worker' cannot start because referenced Secret 'stripe-api-key' is missing in namespace 'production'.",
            "confidence": "high",
            "bestSolution": {
                "actionTitle": "Create Missing Secret 'stripe-api-key'",
                "steps": [
                    "Check namespace secrets: kubectl get secrets -n production",
                    "Create required secret: kubectl create secret generic stripe-api-key -n production --from-literal=api_key=sk_live_123",
                    "Pod will mount the volume and progress to Running",
                ],
                "commandToRun": "kubectl create secret generic stripe-api-key -n production --from-literal=api_key=sk_live_123",
                "riskLevel": "low",
            },
        }
        self._run_mocked_llm_scenario(
            "missing_secret",
            payload,
            ["stripe-api-key", "secret"],
            "kubectl create secret generic stripe-api-key",
        )

    def test_missing_secret_fallback_heuristic_mode(self) -> None:
        """Scenario 3 Fallback: Verifies deterministic heuristic fallback when Ollama is offline."""
        self._run_offline_fallback_scenario(
            "missing_secret",
            ["stripe-api-key"],
            "kubectl create secret generic stripe-api-key",
        )

    def test_node_pressure_scenario_rule_engine_and_council(self) -> None:
        """Scenario 4: Node condition MemoryPressure=True causing pod eviction."""
        payload = {
            "rootCause": "Pod 'analytics-batch' was evicted due to cluster node MemoryPressure condition.",
            "confidence": "high",
            "bestSolution": {
                "actionTitle": "Relieve Node Memory Pressure or Reschedule Workload",
                "steps": [
                    "Inspect node memory conditions: kubectl describe nodes",
                    "Check node allocatable capacity and evictions: kubectl top nodes",
                    "Scale cluster worker pool to expand allocatable memory capacity",
                ],
                "commandToRun": "kubectl describe nodes",
                "riskLevel": "medium",
            },
        }
        self._run_mocked_llm_scenario(
            "node_pressure",
            payload,
            ["memorypressure", "evicted", "node"],
            "describe nodes",
        )

    def test_node_pressure_fallback_heuristic_mode(self) -> None:
        """Scenario 4 Fallback: Verifies heuristic fallback when Ollama is offline."""
        self._run_offline_fallback_scenario(
            "node_pressure",
            ["memorypressure", "evicted"],
            "describe nodes",
        )

    def test_probe_failure_scenario_rule_engine_and_council(self) -> None:
        """Scenario 5: Liveness probe failed 3 times causing container kill."""
        self._run_bypass_scenario(
            "probe_failure",
            "rule.kubernetes.probe_failure",
            ["probe", "liveness"],
            "portal-web",
        )

    def test_all_five_scenarios_pass_end_to_end(self) -> None:
        """Verify all 5 canonical scenarios produce valid ConsensusDiagnosis with high confidence."""
        self.mock_client.chat.side_effect = RuntimeError("Run in deterministic offline heuristic mode")

        for scenario in CANONICAL_SCENARIOS:
            with self.subTest(scenario=scenario):
                bundle = load_fixture_bundle(scenario)
                self.assertIsNotNone(bundle.target)
                self.assertGreaterEqual(len(bundle.items), 3)

                diagnosis = self.council.diagnose(bundle)
                self.assertIsInstance(diagnosis, ConsensusDiagnosis)
                self.assertEqual(diagnosis.confidence, CONFIDENCE_HIGH)
                self.assertGreater(len(diagnosis.root_cause), 10)
                self.assertGreater(len(diagnosis.best_solution.action_title), 5)
                self.assertGreaterEqual(len(diagnosis.best_solution.steps), 2)

                # Ensure serializable to dict matching TypeScript schema
                serial = diagnosis.to_dict()
                self.assertIn("rootCause", serial)
                self.assertIn("confidence", serial)
                self.assertIn("bestSolution", serial)
                self.assertIn("actionTitle", serial["bestSolution"])

    def test_benchmark_execution_speed_under_three_seconds(self) -> None:
        """Performance assertion: all 5 scenarios must evaluate in < 3.0s in CI."""
        self.mock_client.chat.side_effect = RuntimeError("Offline benchmark mode")

        start_time = time.perf_counter()
        for scenario in CANONICAL_SCENARIOS:
            bundle = load_fixture_bundle(scenario)
            diag = self.council.diagnose(bundle)
            self.assertEqual(diag.confidence, CONFIDENCE_HIGH)
        elapsed = time.perf_counter() - start_time

        self.assertLess(
            elapsed,
            3.0,
            f"Evaluation of 5 scenarios took {elapsed:.3f}s, exceeding 3.0s CI budget",
        )


if __name__ == "__main__":
    unittest.main()
