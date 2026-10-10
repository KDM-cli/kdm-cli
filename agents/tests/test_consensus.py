"""
Unit Tests — Consensus Diagnosis Schema & Generator (Phase 10)
==============================================================
Tests cover:
  - Task 10.1: BestSolution and ConsensusDiagnosis dataclasses, defaults,
    validation, and camelCase to_dict() / from_dict() serialization.
  - Task 10.2: Numerical and categorical confidence scoring mapping
    (>= 0.8 -> high, >= 0.5 -> medium, < 0.5 -> low).
  - Task 10.3: TypeScript schema compliance verification, JSON serialization,
    and end-to-end consensus generation across varied incident conditions.
"""

from __future__ import annotations

import json
import os
import sys
import unittest

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.synthesis.consensus import (
        CONFIDENCE_HIGH,
        CONFIDENCE_LOW,
        CONFIDENCE_MEDIUM,
        BestSolution,
        ConsensusDiagnosis,
        ConsensusGenerator,
        generate_consensus_diagnosis,
        map_confidence_score,
        normalize_risk_level,
    )
    from agents.synthesis.hypotheses import Hypothesis
    from agents.validation.validator import ValidationResult
except ImportError:
    from synthesis.consensus import (  # type: ignore[no-redef]
        CONFIDENCE_HIGH,
        CONFIDENCE_LOW,
        CONFIDENCE_MEDIUM,
        BestSolution,
        ConsensusDiagnosis,
        ConsensusGenerator,
        generate_consensus_diagnosis,
        map_confidence_score,
        normalize_risk_level,
    )
    from synthesis.hypotheses import Hypothesis  # type: ignore[no-redef]
    from validation.validator import ValidationResult  # type: ignore[no-redef]


class TestConfidenceScoring(unittest.TestCase):
    """Validate Task 10.2: Numerical and categorical confidence score mapping."""

    def test_high_confidence_boundary(self) -> None:
        """Scores >= 0.8 must map strictly to 'high'."""
        self.assertEqual(map_confidence_score(0.8), CONFIDENCE_HIGH)
        self.assertEqual(map_confidence_score(0.8000), CONFIDENCE_HIGH)
        self.assertEqual(map_confidence_score(0.85), CONFIDENCE_HIGH)
        self.assertEqual(map_confidence_score(0.99), CONFIDENCE_HIGH)
        self.assertEqual(map_confidence_score(1.0), CONFIDENCE_HIGH)

    def test_medium_confidence_boundary(self) -> None:
        """Scores >= 0.5 and < 0.8 must map strictly to 'medium'."""
        self.assertEqual(map_confidence_score(0.5), CONFIDENCE_MEDIUM)
        self.assertEqual(map_confidence_score(0.5001), CONFIDENCE_MEDIUM)
        self.assertEqual(map_confidence_score(0.65), CONFIDENCE_MEDIUM)
        self.assertEqual(map_confidence_score(0.7999), CONFIDENCE_MEDIUM)

    def test_low_confidence_boundary(self) -> None:
        """Scores < 0.5 must map strictly to 'low'."""
        self.assertEqual(map_confidence_score(0.4999), CONFIDENCE_LOW)
        self.assertEqual(map_confidence_score(0.4), CONFIDENCE_LOW)
        self.assertEqual(map_confidence_score(0.1), CONFIDENCE_LOW)
        self.assertEqual(map_confidence_score(0.0), CONFIDENCE_LOW)
        self.assertEqual(map_confidence_score(-0.5), CONFIDENCE_LOW)

    def test_string_inputs(self) -> None:
        """Recognize string tier values and parse numeric string values."""
        self.assertEqual(map_confidence_score("high"), CONFIDENCE_HIGH)
        self.assertEqual(map_confidence_score("HIGH"), CONFIDENCE_HIGH)
        self.assertEqual(map_confidence_score("medium"), CONFIDENCE_MEDIUM)
        self.assertEqual(map_confidence_score("Medium"), CONFIDENCE_MEDIUM)
        self.assertEqual(map_confidence_score("low"), CONFIDENCE_LOW)
        self.assertEqual(map_confidence_score("0.92"), CONFIDENCE_HIGH)
        self.assertEqual(map_confidence_score("0.6"), CONFIDENCE_MEDIUM)
        self.assertEqual(map_confidence_score("0.3"), CONFIDENCE_LOW)

    def test_invalid_and_edge_inputs(self) -> None:
        """Gracefully handle None, NaN, infinity, and malformed strings."""
        self.assertEqual(map_confidence_score(None), CONFIDENCE_LOW)
        self.assertEqual(map_confidence_score(float("nan")), CONFIDENCE_LOW)
        self.assertEqual(map_confidence_score(float("inf")), CONFIDENCE_LOW)
        self.assertEqual(map_confidence_score("invalid_tier"), CONFIDENCE_LOW)
        self.assertEqual(map_confidence_score([]), CONFIDENCE_LOW)


class TestRiskLevelNormalization(unittest.TestCase):
    """Validate remediation risk level categorization."""

    def test_valid_risk_levels(self) -> None:
        """Standardize low, medium, and high risk labels."""
        self.assertEqual(normalize_risk_level("low"), "low")
        self.assertEqual(normalize_risk_level("LOW"), "low")
        self.assertEqual(normalize_risk_level("medium"), "medium")
        self.assertEqual(normalize_risk_level("high"), "high")

    def test_invalid_fallback(self) -> None:
        """Fallback to 'low' when risk is unknown or missing."""
        self.assertEqual(normalize_risk_level("extreme"), "low")
        self.assertEqual(normalize_risk_level(None), "low")
        self.assertEqual(normalize_risk_level(""), "low")


class TestBestSolution(unittest.TestCase):
    """Validate Task 10.1: BestSolution dataclass and serialization."""

    def test_dataclass_construction_and_fields(self) -> None:
        """Verify field values, post-init sanitization, and defaults."""
        solution = BestSolution(
            action_title="Increase Container Memory Limit",
            steps=[
                "Increase limits.memory from 256Mi to 512Mi in deployment manifest",
                "Rollout restart deployment",
            ],
            command_to_run="kubectl set resources deployment checkout-api --limits=memory=512Mi",
            risk_level="low",
        )
        self.assertEqual(solution.action_title, "Increase Container Memory Limit")
        self.assertEqual(len(solution.steps), 2)
        self.assertEqual(
            solution.command_to_run,
            "kubectl set resources deployment checkout-api --limits=memory=512Mi",
        )
        self.assertEqual(solution.risk_level, "low")

    def test_to_dict_camel_case(self) -> None:
        """to_dict must produce camelCase keys matching src/agent/types.ts."""
        solution = BestSolution(
            action_title="Create Missing Secret",
            steps=["kubectl create secret generic app-sec"],
            command_to_run="kubectl create secret generic app-sec",
            risk_level="medium",
        )
        d = solution.to_dict()
        self.assertIn("actionTitle", d)
        self.assertIn("steps", d)
        self.assertIn("commandToRun", d)
        self.assertIn("riskLevel", d)
        self.assertEqual(d["actionTitle"], "Create Missing Secret")
        self.assertEqual(d["commandToRun"], "kubectl create secret generic app-sec")
        self.assertEqual(d["riskLevel"], "medium")

    def test_from_dict_camel_case(self) -> None:
        """from_dict must parse camelCase dictionaries."""
        payload = {
            "actionTitle": "Restart Pod",
            "steps": ["kubectl delete pod test-pod"],
            "commandToRun": "kubectl delete pod test-pod",
            "riskLevel": "low",
        }
        obj = BestSolution.from_dict(payload)
        self.assertEqual(obj.action_title, "Restart Pod")
        self.assertEqual(obj.command_to_run, "kubectl delete pod test-pod")
        self.assertEqual(obj.risk_level, "low")

    def test_from_dict_snake_case(self) -> None:
        """from_dict must parse snake_case dictionaries."""
        payload = {
            "action_title": "Scale Deployment",
            "steps": ["kubectl scale deployment app --replicas=3"],
            "command_to_run": "kubectl scale deployment app --replicas=3",
            "risk_level": "high",
        }
        obj = BestSolution.from_dict(payload)
        self.assertEqual(obj.action_title, "Scale Deployment")
        self.assertEqual(
            obj.command_to_run, "kubectl scale deployment app --replicas=3"
        )
        self.assertEqual(obj.risk_level, "high")

    def test_empty_and_default_handling(self) -> None:
        """Verify robust fallbacks when empty inputs are provided."""
        obj = BestSolution(action_title="", steps=[])
        self.assertEqual(obj.action_title, "Apply Recommended Fix")
        self.assertTrue(len(obj.steps) > 0)
        self.assertIsNone(obj.command_to_run)
        self.assertEqual(obj.risk_level, "low")


class TestConsensusDiagnosis(unittest.TestCase):
    """Validate Task 10.1 & Task 10.3: ConsensusDiagnosis schema and JSON compatibility."""

    def test_exact_issue_specification_schema(self) -> None:
        """Validate camelCase dictionary output against the exact Issue #281 blueprint."""
        diagnosis = ConsensusDiagnosis(
            root_cause="Container exceeded 256Mi memory limit under peak load",
            confidence="high",
            findings=[
                {
                    "role": "runtime",
                    "summary": "Exit code 137 detected",
                    "evidence": ["status.exitCode == 137"],
                },
                {
                    "role": "config",
                    "summary": "Memory limit set to 256Mi",
                    "evidence": ["spec.resources.limits.memory"],
                },
            ],
            best_solution=BestSolution(
                action_title="Increase Container Memory Limit",
                steps=[
                    "Increase limits.memory from 256Mi to 512Mi in deployment manifest",
                    "Rollout restart deployment",
                ],
                command_to_run="kubectl set resources deployment checkout-api --limits=memory=512Mi",
                risk_level="low",
            ),
            evidence_citations=["ev.pod.container.status", "ev.resources.limits"],
        )

        output = diagnosis.to_dict()

        # Strict root level keys
        self.assertEqual(
            output["rootCause"],
            "Container exceeded 256Mi memory limit under peak load",
        )
        self.assertEqual(output["confidence"], "high")
        self.assertEqual(len(output["findings"]), 2)
        self.assertEqual(output["findings"][0]["role"], "runtime")
        self.assertEqual(output["findings"][1]["role"], "config")

        # Strict bestSolution keys
        best_sol = output["bestSolution"]
        self.assertEqual(best_sol["actionTitle"], "Increase Container Memory Limit")
        self.assertEqual(len(best_sol["steps"]), 2)
        self.assertEqual(
            best_sol["commandToRun"],
            "kubectl set resources deployment checkout-api --limits=memory=512Mi",
        )
        self.assertEqual(best_sol["riskLevel"], "low")

        # Strict evidenceCitations key
        self.assertEqual(
            output["evidenceCitations"],
            ["ev.pod.container.status", "ev.resources.limits"],
        )

        # JSON serialization validation
        encoded = json.dumps(output)
        decoded = json.loads(encoded)
        self.assertEqual(decoded["rootCause"], output["rootCause"])
        self.assertEqual(
            decoded["bestSolution"]["actionTitle"],
            output["bestSolution"]["actionTitle"],
        )

    def test_from_dict_and_to_dict_roundtrip(self) -> None:
        """Verify lossless roundtrip serialization through from_dict and to_dict."""
        raw_dict = {
            "rootCause": "ConfigMap auth-cfg missing",
            "confidence": "medium",
            "findings": [{"role": "config", "summary": "404 not found"}],
            "bestSolution": {
                "actionTitle": "Create ConfigMap",
                "steps": ["kubectl create configmap auth-cfg"],
                "commandToRun": "kubectl create configmap auth-cfg",
                "riskLevel": "low",
            },
            "evidenceCitations": ["ev.pod.configmap"],
        }
        diagnosis = ConsensusDiagnosis.from_dict(raw_dict)
        self.assertEqual(diagnosis.root_cause, "ConfigMap auth-cfg missing")
        self.assertEqual(diagnosis.confidence, "medium")
        self.assertEqual(diagnosis.best_solution.action_title, "Create ConfigMap")
        self.assertEqual(diagnosis.evidence_citations, ["ev.pod.configmap"])

        result = diagnosis.to_dict()
        self.assertEqual(result, raw_dict)

    def test_snake_case_deserialization(self) -> None:
        """Verify from_dict correctly parses snake_case inputs."""
        raw_snake = {
            "root_cause": "OOMKilled node eviction",
            "confidence": "low",
            "findings": [],
            "best_solution": {
                "action_title": "Drain node",
                "steps": ["kubectl drain node-1"],
                "command_to_run": "kubectl drain node-1",
                "risk_level": "high",
            },
            "evidence_citations": ["ev.node.conditions"],
        }
        obj = ConsensusDiagnosis.from_dict(raw_snake)
        self.assertEqual(obj.root_cause, "OOMKilled node eviction")
        self.assertEqual(obj.best_solution.risk_level, "high")
        self.assertEqual(obj.evidence_citations, ["ev.node.conditions"])


class TestConsensusGenerator(unittest.TestCase):
    """Validate end-to-end consensus synthesis via ConsensusGenerator."""

    def test_generate_from_hypothesis_object(self) -> None:
        """Synthesize diagnosis directly from a Phase 8 Hypothesis instance."""
        hyp = Hypothesis(
            id="hyp-01",
            description="Container exceeded memory limit of 256Mi under traffic surge.",
            likelihood=0.91,
            supporting_evidence=["Exit code 137", "ev.pod.container.status"],
            contradicting_evidence=[],
        )
        findings = [
            {
                "role": "runtime",
                "summary": "Exit code 137 OOMKilled",
                "evidence": ["ev.pod.exit_code_137"],
            }
        ]

        diagnosis = generate_consensus_diagnosis(
            hypothesis=hyp,
            findings=findings,
            target_name="payment-svc",
        )

        self.assertIn("memory limit", diagnosis.root_cause.lower())
        self.assertEqual(diagnosis.confidence, CONFIDENCE_HIGH)
        self.assertIn("payment-svc", diagnosis.best_solution.command_to_run or "")
        self.assertIn("ev.pod.container.status", diagnosis.evidence_citations)
        self.assertIn("ev.pod.exit_code_137", diagnosis.evidence_citations)

    def test_generate_with_validation_contradiction(self) -> None:
        """When validation result rejects the hypothesis, confidence drops to low."""
        hyp = Hypothesis(
            id="hyp-02",
            description="Node MemoryPressure caused pod eviction.",
            likelihood=0.88,
            supporting_evidence=["ev.node.pressure"],
        )
        val_result = ValidationResult(
            approved=False,
            confidence_score=0.15,
            reason="Node explicitly reports MemoryPressure=False.",
        )

        diagnosis = ConsensusGenerator.generate(
            hypothesis=hyp,
            validation_result=val_result,
        )

        self.assertEqual(diagnosis.confidence, CONFIDENCE_LOW)

    def test_generate_with_validation_approval(self) -> None:
        """When validation result approves with score, confidence maps accordingly."""
        hyp = Hypothesis(
            id="hyp-01",
            description="Missing Secret database-credentials.",
            likelihood=0.75,
            supporting_evidence=["ev.k8s.secret"],
        )
        val_result = ValidationResult(
            approved=True,
            confidence_score=0.84,
            reason="Verified Secret database-credentials does not exist in cluster.",
        )

        diagnosis = generate_consensus_diagnosis(
            hypothesis=hyp,
            validation_result=val_result,
        )

        self.assertEqual(diagnosis.confidence, CONFIDENCE_HIGH)

    def test_explicit_citations_override(self) -> None:
        """Explicitly passed evidence citations take precedence."""
        explicit = ["ev.explicit.one", "ev.explicit.two"]
        diagnosis = generate_consensus_diagnosis(
            hypothesis="Workload failed to initialize.",
            evidence_citations=explicit,
        )
        self.assertEqual(diagnosis.evidence_citations, explicit)

    def test_deterministic_remediation_synthesizers(self) -> None:
        """Verify specific remediation blueprints for major failure modes."""
        # Missing Secret
        diag_secret = generate_consensus_diagnosis(
            hypothesis="Pod failed because Secret 'redis-auth' not found.",
            target_name="redis-auth",
        )
        self.assertIn("Secret", diag_secret.best_solution.action_title)
        self.assertIn(
            "kubectl create secret", diag_secret.best_solution.command_to_run or ""
        )

        # Missing ConfigMap
        diag_cm = generate_consensus_diagnosis(
            hypothesis="Pod failed because ConfigMap 'app-config' not found.",
            target_name="app-config",
        )
        self.assertIn("ConfigMap", diag_cm.best_solution.action_title)
        self.assertIn(
            "kubectl create configmap", diag_cm.best_solution.command_to_run or ""
        )

        # Image Pull
        diag_img = generate_consensus_diagnosis(
            hypothesis="ImagePullBackOff for repository image web:v2.1.",
            target_name="web:v2.1",
        )
        self.assertIn("Image", diag_img.best_solution.action_title)

        # Node Resource Pressure
        diag_res = generate_consensus_diagnosis(
            hypothesis="0/5 nodes available: insufficient memory to schedule pod.",
        )
        self.assertIn("Node", diag_res.best_solution.action_title)


if __name__ == "__main__":
    unittest.main()
