"""
Consensus Diagnosis Schema & Generator — KDM v4.0.0
====================================================
Synthesizes the final Consensus Diagnosis and confidence scoring combining
verified top hypotheses, specialist findings, evidence citations, and
recommended remediation into a standardized serializable object.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.synthesis.hypotheses import Hypothesis
except ImportError:
    try:
        from synthesis.hypotheses import Hypothesis  # type: ignore[no-redef]
    except ImportError:
        Hypothesis = None  # type: ignore[assignment,misc]

CONFIDENCE_HIGH: str = "high"
CONFIDENCE_MEDIUM: str = "medium"
CONFIDENCE_LOW: str = "low"
VALID_CONFIDENCE_LEVELS: Tuple[str, ...] = (
    CONFIDENCE_HIGH,
    CONFIDENCE_MEDIUM,
    CONFIDENCE_LOW,
)
VALID_RISK_LEVELS: Tuple[str, ...] = ("low", "medium", "high")


def _parse_score_float(score: Any) -> Optional[float]:
    """Extract a finite float value from numeric or string inputs."""
    try:
        val = float(score)
        return val if math.isfinite(val) else None
    except (ValueError, TypeError):
        return None


def _score_to_tier(val: float) -> str:
    """Map a finite float score to a categorical confidence tier."""
    if val >= 0.8:
        return CONFIDENCE_HIGH
    if val >= 0.5:
        return CONFIDENCE_MEDIUM
    return CONFIDENCE_LOW


def map_confidence_score(score: Any) -> str:
    """Map a numerical confidence score or tier string to a standardized tier.

    Threshold mapping:
      - score >= 0.8 -> 'high'
      - score >= 0.5 -> 'medium'
      - score < 0.5  -> 'low'

    :param score: Numeric score, tier string, or None.
    :return: Standardized confidence tier ('high', 'medium', or 'low').
    """
    if isinstance(score, str):
        cleaned = score.strip().lower()
        if cleaned in VALID_CONFIDENCE_LEVELS:
            return cleaned

    val = _parse_score_float(score)
    return _score_to_tier(val) if val is not None else CONFIDENCE_LOW


def normalize_risk_level(risk: Any) -> str:
    """Normalize and validate a remediation risk level string.

    :param risk: Raw risk level value.
    :return: Normalized risk string ('low', 'medium', or 'high').
    """
    if isinstance(risk, str):
        cleaned = risk.strip().lower()
        if cleaned in VALID_RISK_LEVELS:
            return cleaned
    return "low"


def _sanitize_steps(raw_steps: Any) -> List[str]:
    """Sanitize steps into a non-empty list of string instructions."""
    if isinstance(raw_steps, list):
        cleaned = [str(s).strip() for s in raw_steps if str(s).strip()]
        if cleaned:
            return cleaned
    elif raw_steps:
        cleaned_single = str(raw_steps).strip()
        if cleaned_single:
            return [cleaned_single]
    return ["Review workload status and logs."]


@dataclass
class BestSolution:
    """Remediation solution recommendation synthesized for the incident.

    Attributes:
        action_title: Human-readable headline action for remediation.
        steps: Step-by-step remediation commands and instructions.
        command_to_run: Optional single CLI command or manifest command to execute.
        risk_level: Estimated operational risk ('low', 'medium', 'high').
    """

    action_title: str
    steps: List[str]
    command_to_run: Optional[str] = None
    risk_level: str = "low"

    def __post_init__(self) -> None:
        """Validate, sanitize, and format solution fields."""
        title = str(self.action_title or "").strip()
        self.action_title = title if title else "Apply Recommended Fix"
        self.steps = _sanitize_steps(self.steps)
        cmd = str(self.command_to_run).strip() if self.command_to_run else None
        self.command_to_run = cmd if cmd else None
        self.risk_level = normalize_risk_level(self.risk_level)

    def to_dict(self) -> Dict[str, Any]:
        """Convert BestSolution to a camelCase dictionary for Node/TypeScript compatibility.

        :return: CamelCase dictionary matching src/agent/types.ts BestSolution.
        """
        return {
            "actionTitle": self.action_title,
            "steps": list(self.steps),
            "commandToRun": self.command_to_run,
            "riskLevel": self.risk_level,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> BestSolution:
        """Construct BestSolution from either camelCase or snake_case dictionary.

        :param data: Dictionary containing solution fields.
        :return: Validated BestSolution dataclass instance.
        """
        if not isinstance(data, dict):
            return cls(
                action_title="Apply Recommended Fix",
                steps=["Review workload status and logs."],
            )

        title = data.get("actionTitle") or data.get("action_title")
        raw_steps = data.get("steps", [])
        cmd = data.get("commandToRun", data.get("command_to_run"))
        risk = data.get("riskLevel", data.get("risk_level"))

        return cls(
            action_title=str(title or "Apply Recommended Fix"),
            steps=list(raw_steps) if isinstance(raw_steps, list) else [str(raw_steps)],
            command_to_run=cmd,
            risk_level=str(risk or "low"),
        )


def _resolve_solution_instance(solution: Any) -> BestSolution:
    """Normalize input into a validated BestSolution instance."""
    if isinstance(solution, BestSolution):
        return solution
    if isinstance(solution, dict):
        return BestSolution.from_dict(solution)
    return BestSolution(
        action_title="Apply Recommended Fix",
        steps=["Review workload status and logs."],
    )


@dataclass
class ConsensusDiagnosis:
    """Standardized multi-agent consensus diagnosis for workload failures.

    Complies with the Node.js TypeScript interface in src/agent/types.ts.

    Attributes:
        root_cause: Primary identified root cause of the incident.
        confidence: Categorical confidence level ('high', 'medium', 'low').
        findings: Specialist agent findings contributing to the conclusion.
        best_solution: Synthesized best remediation solution.
        evidence_citations: Canonical evidence keys cited in support.
    """

    root_cause: str
    confidence: str
    findings: List[Dict[str, Any]]
    best_solution: BestSolution
    evidence_citations: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        """Validate and normalize fields upon initialization."""
        cause = str(self.root_cause or "").strip()
        self.root_cause = (
            cause if cause else "Root cause identified from agent consensus."
        )
        self.confidence = map_confidence_score(self.confidence)
        self.findings = list(self.findings) if isinstance(self.findings, list) else []
        self.best_solution = _resolve_solution_instance(self.best_solution)
        self.evidence_citations = _dedup_citations(self.evidence_citations)

    def to_dict(self) -> Dict[str, Any]:
        """Convert ConsensusDiagnosis to a camelCase dictionary for Node/TypeScript compatibility.

        :return: CamelCase dictionary matching src/agent/types.ts ConsensusDiagnosis.
        """
        return {
            "rootCause": self.root_cause,
            "confidence": self.confidence,
            "findings": self.findings,
            "bestSolution": {
                "actionTitle": self.best_solution.action_title,
                "steps": list(self.best_solution.steps),
                "commandToRun": self.best_solution.command_to_run,
                "riskLevel": self.best_solution.risk_level,
            },
            "evidenceCitations": list(self.evidence_citations),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ConsensusDiagnosis:
        """Construct ConsensusDiagnosis from either camelCase or snake_case dictionary.

        :param data: Dictionary containing diagnosis fields.
        :return: Validated ConsensusDiagnosis dataclass instance.
        """
        if not isinstance(data, dict):
            return cls(
                root_cause="Root cause identified from agent consensus.",
                confidence=CONFIDENCE_LOW,
                findings=[],
                best_solution=BestSolution(
                    "Apply Recommended Fix", ["Review workload logs."]
                ),
                evidence_citations=[],
            )

        cause = data.get("rootCause") or data.get("root_cause")
        conf = data.get("confidence", CONFIDENCE_LOW)
        findings = data.get("findings", [])
        solution_data = data.get("bestSolution") or data.get("best_solution")
        citations = data.get("evidenceCitations") or data.get("evidence_citations")

        return cls(
            root_cause=str(cause or "Root cause identified from agent consensus."),
            confidence=str(conf),
            findings=list(findings) if isinstance(findings, list) else [],
            best_solution=_resolve_solution_instance(solution_data),
            evidence_citations=list(citations) if isinstance(citations, list) else [],
        )


def _build_oom_remediation(target: str) -> BestSolution:
    """Build remediation solution for out-of-memory container events."""
    name = target or "workload"
    return BestSolution(
        action_title=f"Increase Container Memory Limit for {name}",
        steps=[
            "Inspect container memory usage and peak consumption.",
            "Increase limits.memory in deployment manifest (e.g. from 256Mi to 512Mi).",
            "Rollout restart workload to apply updated resource boundaries.",
        ],
        command_to_run=f"kubectl set resources deployment {name} --limits=memory=512Mi",
        risk_level="low",
    )


def _build_secret_remediation(target: str) -> BestSolution:
    """Build remediation solution for missing Secret dependencies."""
    name = target or "app-secret"
    return BestSolution(
        action_title=f"Create Missing Secret '{name}'",
        steps=[
            "Inspect available namespace secrets with 'kubectl get secrets'.",
            f"Create the required secret: kubectl create secret generic {name} --from-literal=key=value",
            "Verify workload volume mount or secretKeyRef binds successfully.",
        ],
        command_to_run=f"kubectl create secret generic {name} --from-literal=key=value",
        risk_level="low",
    )


def _build_configmap_remediation(target: str) -> BestSolution:
    """Build remediation solution for missing ConfigMap dependencies."""
    name = target or "app-config"
    return BestSolution(
        action_title=f"Create Missing ConfigMap '{name}'",
        steps=[
            "Inspect available namespace ConfigMaps with 'kubectl get configmaps'.",
            f"Create the required ConfigMap: kubectl create configmap {name} --from-literal=KEY=VALUE",
            "Workload pod will automatically bind once the ConfigMap is present.",
        ],
        command_to_run=f"kubectl create configmap {name} --from-literal=KEY=VALUE",
        risk_level="low",
    )


def _build_image_remediation(target: str) -> BestSolution:
    """Build remediation solution for ImagePullBackOff / ErrImagePull errors."""
    name = target or "container-image"
    return BestSolution(
        action_title="Correct Container Image Tag or Configure ImagePullSecrets",
        steps=[
            "Inspect exact image pull error via 'kubectl describe pod'.",
            f"Verify image '{name}' exists in target container registry.",
            "Configure imagePullSecrets if accessing a private registry.",
        ],
        command_to_run="kubectl describe pod",
        risk_level="low",
    )


def _build_resource_remediation(target: str) -> BestSolution:
    """Build remediation solution for node pressure and scheduling failures."""
    return BestSolution(
        action_title="Scale Node Pool Capacity or Reduce Workload Requests",
        steps=[
            "Inspect node resource allocation via 'kubectl top nodes' and 'kubectl describe nodes'.",
            "Reduce pod resource requests to allow scheduling on existing nodes.",
            "Scale the cluster node pool or trigger autoscaler expansion.",
        ],
        command_to_run="kubectl get nodes",
        risk_level="medium",
    )


def _build_default_remediation(target: str) -> BestSolution:
    """Build fallback diagnostic remediation solution."""
    return BestSolution(
        action_title="Inspect Workload Diagnostics and Events",
        steps=[
            "Review workload status and recent warning events using 'kubectl describe'.",
            "Inspect container standard output and error logs.",
            "Apply recommended configuration adjustment and redeploy.",
        ],
        command_to_run="kubectl describe pod",
        risk_level="low",
    )


_REMEDIATION_BUILDERS: Tuple[Tuple[Tuple[str, ...], Any], ...] = (
    (
        ("137", "oomkilled", "memory limit", "out of memory", "oom"),
        _build_oom_remediation,
    ),
    (("secret", "missing secret", "secret not found"), _build_secret_remediation),
    (
        ("configmap", "missing configmap", "configmap not found"),
        _build_configmap_remediation,
    ),
    (("imagepullbackoff", "errimagepull", "image"), _build_image_remediation),
    (
        ("memorypressure", "insufficient memory", "insufficient cpu", "node"),
        _build_resource_remediation,
    ),
)


def _extract_target_name(cause_text: str, fallback_target: str) -> str:
    """Extract target resource name from explicit input or quoted substrings."""
    if fallback_target:
        return fallback_target
    match = re.search(r"['\"]([a-zA-Z0-9_\-\.]+)['\"]", str(cause_text or ""))
    return match.group(1) if match else ""


def _synthesize_remediation(cause_text: str, target: str = "") -> BestSolution:
    """Select the best matching remediation builder based on cause keywords.

    :param cause_text: Diagnostic text or root cause description.
    :param target: Optional workload or resource name.
    :return: Concrete BestSolution instance.
    """
    resolved_target = _extract_target_name(cause_text, target)
    lowered = str(cause_text or "").lower()
    for keywords, builder in _REMEDIATION_BUILDERS:
        if any(k in lowered for k in keywords):
            return builder(resolved_target)
    return _build_default_remediation(resolved_target)


def _dedup_citations(sources: Any) -> List[str]:
    """De-duplicate citation string items preserving original order."""
    if not isinstance(sources, (list, tuple, set)):
        if sources:
            cleaned = str(sources).strip()
            return [cleaned] if cleaned else []
        return []

    seen: set[str] = set()
    result: List[str] = []
    for s in sources:
        cleaned = str(s).strip()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            result.append(cleaned)
    return result


def _extract_finding_evidence(findings: List[Dict[str, Any]]) -> List[str]:
    """Extract evidence items from findings without deep indentation nesting."""
    items: List[str] = []
    for f in findings:
        ev = f.get("evidence")
        if isinstance(ev, list):
            items.extend(ev)
    return items


def _collect_citations(
    explicit: Optional[List[str]],
    findings: List[Dict[str, Any]],
    hypothesis_evidence: Optional[List[str]],
) -> List[str]:
    """Aggregate unique citations preserving discovery order.

    :param explicit: Explicitly supplied citation strings.
    :param findings: Specialist findings containing evidence.
    :param hypothesis_evidence: Supporting evidence from the top hypothesis.
    :return: De-duplicated list of evidence citation strings.
    """
    if explicit:
        return _dedup_citations(explicit)

    sources = list(hypothesis_evidence or [])
    sources.extend(_extract_finding_evidence(findings))
    return _dedup_citations(sources)


def _parse_dict_hypothesis(
    data: Dict[str, Any],
) -> Tuple[str, Optional[float], List[str]]:
    """Extract hypothesis fields from dictionary structure."""
    desc = str(
        data.get("description")
        or data.get("root_cause")
        or data.get("rootCause")
        or "Root cause identified from agent consensus."
    )
    raw_prob = data.get("likelihood", data.get("confidence_score"))
    prob = _parse_score_float(raw_prob)
    ev = data.get("supporting_evidence", data.get("evidence", []))
    evidence_list = list(ev) if isinstance(ev, list) else []
    return (desc, prob, evidence_list)


def _parse_obj_hypothesis(hyp: Any) -> Tuple[str, Optional[float], List[str]]:
    """Extract hypothesis fields from object instance."""
    desc = str(
        getattr(hyp, "description", "Root cause identified from agent consensus.")
    )
    prob = _parse_score_float(getattr(hyp, "likelihood", None))
    ev = getattr(hyp, "supporting_evidence", [])
    evidence_list = list(ev) if isinstance(ev, list) else []
    return (desc, prob, evidence_list)


def _extract_hypothesis_text(hypothesis: Any) -> Tuple[str, Optional[float], List[str]]:
    """Extract description, likelihood, and supporting evidence from a hypothesis.

    :param hypothesis: Hypothesis instance, dict, or string.
    :return: Tuple of (description, likelihood, supporting_evidence).
    """
    if hypothesis is None:
        return ("Root cause identified from agent consensus.", None, [])
    if isinstance(hypothesis, str):
        return (hypothesis.strip(), None, [])
    if isinstance(hypothesis, dict):
        return _parse_dict_hypothesis(hypothesis)
    if hasattr(hypothesis, "description"):
        return _parse_obj_hypothesis(hypothesis)
    return (str(hypothesis), None, [])


def _resolve_confidence_tier(
    validation_result: Any,
    score: Optional[float],
    hyp_likelihood: Optional[float],
) -> str:
    """Determine the final confidence tier evaluating validation outcomes and scores.

    :param validation_result: Optional ValidationResult from cross-agent validator.
    :param score: Explicitly passed confidence score float.
    :param hyp_likelihood: Likelihood extracted from top hypothesis.
    :return: Standardized confidence tier ('high', 'medium', or 'low').
    """
    if validation_result is not None:
        if not getattr(validation_result, "approved", True):
            return CONFIDENCE_LOW
        val_score = getattr(validation_result, "confidence_score", None)
        if val_score is not None:
            return map_confidence_score(val_score)

    effective_score = score if score is not None else hyp_likelihood
    if effective_score is not None:
        return map_confidence_score(effective_score)

    return CONFIDENCE_HIGH


class ConsensusGenerator:
    """Engine that synthesizes specialist findings and top hypotheses into a ConsensusDiagnosis."""

    @classmethod
    def generate(
        cls,
        hypothesis: Optional[Any] = None,
        findings: Optional[List[Dict[str, Any]]] = None,
        best_solution: Optional[Any] = None,
        evidence_citations: Optional[List[str]] = None,
        validation_result: Optional[Any] = None,
        confidence_score: Optional[float] = None,
        target_name: str = "",
    ) -> ConsensusDiagnosis:
        """Synthesize a complete validated ConsensusDiagnosis object.

        :param hypothesis: Top hypothesis instance, dictionary, or description string.
        :param findings: Diagnostic reports from domain specialists.
        :param best_solution: Optional pre-constructed BestSolution or dictionary.
        :param evidence_citations: Optional list of explicit evidence identifiers.
        :param validation_result: Optional outcome from CrossAgentValidator.
        :param confidence_score: Optional override numerical confidence score.
        :param target_name: Optional target workload name for command formatting.
        :return: Standardized ConsensusDiagnosis instance.
        """
        clean_findings = list(findings) if isinstance(findings, list) else []
        desc, hyp_likelihood, hyp_evidence = _extract_hypothesis_text(hypothesis)

        confidence_tier = _resolve_confidence_tier(
            validation_result=validation_result,
            score=confidence_score,
            hyp_likelihood=hyp_likelihood,
        )

        if best_solution is not None:
            solution = _resolve_solution_instance(best_solution)
        else:
            solution = _synthesize_remediation(desc, target=target_name)

        citations = _collect_citations(
            explicit=evidence_citations,
            findings=clean_findings,
            hypothesis_evidence=hyp_evidence,
        )

        return ConsensusDiagnosis(
            root_cause=desc,
            confidence=confidence_tier,
            findings=clean_findings,
            best_solution=solution,
            evidence_citations=citations,
        )


def generate_consensus_diagnosis(
    hypothesis: Optional[Any] = None,
    findings: Optional[List[Dict[str, Any]]] = None,
    best_solution: Optional[Any] = None,
    evidence_citations: Optional[List[str]] = None,
    validation_result: Optional[Any] = None,
    confidence_score: Optional[float] = None,
    target_name: str = "",
) -> ConsensusDiagnosis:
    """Convenience functional interface for generating a ConsensusDiagnosis.

    :param hypothesis: Top hypothesis instance, dictionary, or description string.
    :param findings: Diagnostic reports from domain specialists.
    :param best_solution: Optional pre-constructed BestSolution or dictionary.
    :param evidence_citations: Optional list of explicit evidence identifiers.
    :param validation_result: Optional outcome from CrossAgentValidator.
    :param confidence_score: Optional override numerical confidence score.
    :param target_name: Optional target workload name for command formatting.
    :return: Standardized ConsensusDiagnosis instance.
    """
    return ConsensusGenerator.generate(
        hypothesis=hypothesis,
        findings=findings,
        best_solution=best_solution,
        evidence_citations=evidence_citations,
        validation_result=validation_result,
        confidence_score=confidence_score,
        target_name=target_name,
    )
