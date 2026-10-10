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
from typing import Any, Dict, List
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


def _build_sample_solution_payload(camel: bool = True) -> Dict[str, Any]:
    """Helper creating standardized test solution payload."""
    if camel:
        return {
            "actionTitle": "Increase Container Memory Limit",
            "steps": ["Bump memory to 512Mi", "Restart workload"],
            "commandToRun": "kubectl set resources deployment api --limits=memory=512Mi",
            "riskLevel": "low",
        }
    return {
        "action_title": "Increase Container Memory Limit",
        "steps": ["Bump memory to 512Mi", "Restart workload"],
        "command_to_run": "kubectl set resources deployment api --limits=memory=512Mi",
        "risk_level": "low",
    }


def _build_sample_diagnosis_payload(camel: bool = True) -> Dict[str, Any]:
    """Helper creating standardized test diagnosis payload matching TypeScript schema."""
    sol = _build_sample_solution_payload(camel=camel)
    if camel:
        return {
            "rootCause": "Container exceeded 256Mi memory limit under peak load",
            "confidence": "high",
            "findings": [
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
            "bestSolution": sol,
            "evidenceCitations": ["ev.pod.container.status", "ev.resources.limits"],
        }
    return {
        "root_cause": "Container exceeded 256Mi memory limit under peak load",
        "confidence": "high",
        "findings": [],
        "best_solution": sol,
        "evidence_citations": ["ev.pod.container.status"],
    }


class TestConfidenceScoring(unittest.TestCase):
    """Validate Task 10.2: Numerical and categorical confidence score mapping."""

    def test_score_mapping_table(self) -> None:
        """Verify boundary scores against expected categorical confidence tiers."""
        matrix: List[tuple[Any, str]] = [
            (0.8, CONFIDENCE_HIGH),
            (0.8000, CONFIDENCE_HIGH),
            (0.85, CONFIDENCE_HIGH),
            (1.0, CONFIDENCE_HIGH),
            (0.5, CONFIDENCE_MEDIUM),
            (0.65, CONFIDENCE_MEDIUM),
            (0.7999, CONFIDENCE_MEDIUM),
            (0.4999, CONFIDENCE_LOW),
            (0.2, CONFIDENCE_LOW),
            (0.0, CONFIDENCE_LOW),
            (-0.1, CONFIDENCE_LOW),
            ("high", CONFIDENCE_HIGH),
            ("HIGH", CONFIDENCE_HIGH),
            ("medium", CONFIDENCE_MEDIUM),
            ("low", CONFIDENCE_LOW),
            ("0.95", CONFIDENCE_HIGH),
            ("0.60", CONFIDENCE_MEDIUM),
            ("0.25", CONFIDENCE_LOW),
            (None, CONFIDENCE_LOW),
            (float("nan"), CONFIDENCE_LOW),
            (float("inf"), CONFIDENCE_LOW),
            ("invalid_value", CONFIDENCE_LOW),
        ]
        for val, expected in matrix:
            with self.subTest(val=val, expected=expected):
                self.assertEqual(map_confidence_score(val), expected)


class TestRiskLevelNormalization(unittest.TestCase):
    """Validate remediation risk level categorization."""

    def test_risk_normalization_matrix(self) -> None:
        """Verify risk inputs normalize to low, medium, or high."""
        cases = [
            ("low", "low"),
            ("LOW", "low"),
            ("medium", "medium"),
            ("high", "high"),
            ("HIGH", "high"),
            ("extreme", "low"),
            (None, "low"),
            ("", "low"),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_risk_level(raw), expected)


class TestBestSolution(unittest.TestCase):
    """Validate Task 10.1: BestSolution dataclass and serialization."""

    def test_dataclass_fields(self) -> None:
        """Verify field values, post-init sanitization, and defaults."""
        payload = _build_sample_solution_payload(camel=True)
        sol = BestSolution(
            action_title=payload["actionTitle"],
            steps=payload["steps"],
            command_to_run=payload["commandToRun"],
            risk_level=payload["riskLevel"],
        )
        self.assertEqual(sol.action_title, payload["actionTitle"])
        self.assertEqual(sol.steps, payload["steps"])
        self.assertEqual(sol.command_to_run, payload["commandToRun"])
        self.assertEqual(sol.risk_level, payload["riskLevel"])

    def test_camel_and_snake_serialization(self) -> None:
        """Validate both camelCase and snake_case roundtrip parsing."""
        camel_data = _build_sample_solution_payload(camel=True)
        from_camel = BestSolution.from_dict(camel_data)
        self.assertEqual(from_camel.to_dict(), camel_data)

        snake_data = _build_sample_solution_payload(camel=False)
        from_snake = BestSolution.from_dict(snake_data)
        self.assertEqual(from_snake.action_title, snake_data["action_title"])
        self.assertEqual(from_snake.risk_level, snake_data["risk_level"])

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
        raw = _build_sample_diagnosis_payload(camel=True)
        diagnosis = ConsensusDiagnosis.from_dict(raw)
        output = diagnosis.to_dict()

        self.assertEqual(output["rootCause"], raw["rootCause"])
        self.assertEqual(output["confidence"], raw["confidence"])
        self.assertEqual(len(output["findings"]), 2)
        self.assertEqual(output["bestSolution"], raw["bestSolution"])
        self.assertEqual(output["evidenceCitations"], raw["evidenceCitations"])

        encoded = json.dumps(output)
        decoded = json.loads(encoded)
        self.assertEqual(decoded["rootCause"], output["rootCause"])
        self.assertEqual(
            decoded["bestSolution"]["actionTitle"],
            output["bestSolution"]["actionTitle"],
        )

    def test_snake_case_deserialization(self) -> None:
        """Verify from_dict correctly parses snake_case inputs."""
        snake_dict = _build_sample_diagnosis_payload(camel=False)
        obj = ConsensusDiagnosis.from_dict(snake_dict)
        self.assertEqual(obj.root_cause, snake_dict["root_cause"])
        self.assertEqual(obj.best_solution.risk_level, "low")
        self.assertEqual(obj.evidence_citations, snake_dict["evidence_citations"])


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
            hypothesis=hyp, findings=findings, target_name="payment-svc"
        )
        self.assertIn("memory limit", diagnosis.root_cause.lower())
        self.assertEqual(diagnosis.confidence, CONFIDENCE_HIGH)
        self.assertIn("payment-svc", diagnosis.best_solution.command_to_run or "")
        self.assertIn("ev.pod.container.status", diagnosis.evidence_citations)
        self.assertIn("ev.pod.exit_code_137", diagnosis.evidence_citations)

    def test_generate_with_validation_outcomes(self) -> None:
        """Verify validation contradiction downgrades to low and approval adopts score."""
        hyp = Hypothesis(
            id="hyp-02",
            description="Node MemoryPressure eviction",
            likelihood=0.88,
            supporting_evidence=["ev.node.pressure"],
        )

        # Contradicted
        contradicted = ValidationResult(
            approved=False, confidence_score=0.15, reason="MemoryPressure=False"
        )
        diag_contra = ConsensusGenerator.generate(
            hypothesis=hyp, validation_result=contradicted
        )
        self.assertEqual(diag_contra.confidence, CONFIDENCE_LOW)

        # Approved
        approved = ValidationResult(
            approved=True, confidence_score=0.85, reason="Confirmed OOM"
        )
        diag_appr = ConsensusGenerator.generate(
            hypothesis=hyp, validation_result=approved
        )
        self.assertEqual(diag_appr.confidence, CONFIDENCE_HIGH)

    def test_explicit_citations_override(self) -> None:
        """Explicitly passed evidence citations take precedence."""
        explicit = ["ev.custom.first", "ev.custom.second"]
        diagnosis = generate_consensus_diagnosis(
            hypothesis="General fault", evidence_citations=explicit
        )
        self.assertEqual(diagnosis.evidence_citations, explicit)

    def test_table_driven_remediations(self) -> None:
        """Verify specific remediation blueprints across failure categories using data table."""
        patterns = [
            (
                "Pod failed because Secret 'redis-auth' not found.",
                "redis-auth",
                "Secret",
                "kubectl create secret",
            ),
            (
                "Pod failed because ConfigMap 'app-config' not found.",
                "app-config",
                "ConfigMap",
                "kubectl create configmap",
            ),
            (
                "ImagePullBackOff for repository image web:v2.1.",
                "web:v2.1",
                "Image",
                "kubectl describe pod",
            ),
            (
                "0/5 nodes available: insufficient memory to schedule pod.",
                "",
                "Node",
                "kubectl get nodes",
            ),
        ]
        for hyp_text, target, expected_title, expected_cmd in patterns:
            with self.subTest(pattern=expected_title):
                diag = generate_consensus_diagnosis(
                    hypothesis=hyp_text, target_name=target
                )
                self.assertIn(expected_title, diag.best_solution.action_title)
                self.assertIn(expected_cmd, diag.best_solution.command_to_run or "")


if __name__ == "__main__":
    unittest.main()
