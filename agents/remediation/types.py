"""
Remediation Plan Data Models — KDM v4.0.0
=========================================
Defines immutable data structures representing actionable remediation plans,
discrete execution steps, diff previews, and rollback commands synthesized
from consensus diagnoses.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

VALID_RISK_LEVELS: Tuple[str, ...] = ("low", "medium", "high")


def normalize_risk_level(risk: Any) -> str:
    """Normalize and validate a remediation risk level string.

    :param risk: Raw risk level value.
    :return: Normalized risk string ('low', 'medium', or 'high').
    """
    if isinstance(risk, str) and risk.strip().lower() in VALID_RISK_LEVELS:
        return risk.strip().lower()
    return "low"


@dataclass
class RemediationStep:
    """A single discrete step within an automated remediation plan.

    Attributes:
        order: Execution sequence index (1-based).
        title: Human-readable title describing the remediation action.
        command: Exact CLI / kubectl command to execute.
        diff_preview: Optional unified diff showing proposed resource modifications.
        is_destructive: Whether this step causes pod restarts, data loss, or downtime.
    """

    order: int
    title: str
    command: str
    diff_preview: Optional[str] = None
    is_destructive: bool = False

    def __post_init__(self) -> None:
        """Validate and sanitize step fields."""
        self.order = int(self.order)
        self.title = str(self.title or "").strip()
        self.command = str(self.command or "").strip()
        diff = self.diff_preview
        self.diff_preview = str(diff).strip() if diff is not None and str(diff).strip() else None
        self.is_destructive = bool(self.is_destructive)

    def to_dict(self) -> Dict[str, Any]:
        """Convert step to dictionary representation.

        :return: Dictionary representation of the step.
        """
        return {
            "order": self.order,
            "title": self.title,
            "command": self.command,
            "diff_preview": self.diff_preview,
            "is_destructive": self.is_destructive,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RemediationStep":
        """Construct a RemediationStep from a dictionary.

        :param data: Dictionary containing step attributes.
        :return: RemediationStep instance.
        """
        if not isinstance(data, dict):
            return cls(order=1, title="Execute Step", command="echo 'No-op'")

        diff = data.get("diff_preview", data.get("diffPreview"))
        destructive = data.get("is_destructive", data.get("isDestructive", False))
        return cls(
            order=int(data.get("order", 1)),
            title=str(data.get("title", "")),
            command=str(data.get("command", "")),
            diff_preview=str(diff).strip() if diff is not None and str(diff).strip() else None,
            is_destructive=bool(destructive),
        )


@dataclass
class RemediationPlan:
    """Complete structured remediation plan for an incident.

    Attributes:
        plan_id: Unique identifier for tracking and auditing this plan.
        target_workload: Name or identifier of the workload being remediated.
        summary: High-level overview of the proposed remediation strategy.
        risk_level: Assessed risk level ('low', 'medium', or 'high').
        steps: Ordered sequence of discrete execution steps.
        rollback_command: Safe rollback command to undo all applied changes.
    """

    plan_id: str
    target_workload: str
    summary: str
    risk_level: str
    steps: List[RemediationStep]
    rollback_command: Optional[str] = None

    def __post_init__(self) -> None:
        """Validate and normalize plan fields."""
        self.plan_id = str(self.plan_id or "").strip()
        self.target_workload = str(self.target_workload or "").strip()
        self.summary = str(self.summary or "").strip()
        self.risk_level = normalize_risk_level(self.risk_level)
        self.steps = [
            s if isinstance(s, RemediationStep) else RemediationStep.from_dict(s)
            for s in (self.steps or [])
        ]
        cmd = self.rollback_command
        self.rollback_command = str(cmd).strip() if cmd is not None and str(cmd).strip() else None

    def to_dict(self) -> Dict[str, Any]:
        """Convert plan to dictionary representation.

        :return: Dictionary representation of the plan.
        """
        return {
            "plan_id": self.plan_id,
            "target_workload": self.target_workload,
            "summary": self.summary,
            "risk_level": self.risk_level,
            "steps": [step.to_dict() for step in self.steps],
            "rollback_command": self.rollback_command,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RemediationPlan":
        """Construct a RemediationPlan from a dictionary.

        :param data: Dictionary containing plan attributes.
        :return: RemediationPlan instance.
        """
        if not isinstance(data, dict):
            return cls(
                plan_id="plan-unknown-001",
                target_workload="workload",
                summary="Review workload status.",
                risk_level="low",
                steps=[],
            )

        pid = data.get("plan_id", data.get("planId", "plan-001"))
        workload = data.get("target_workload", data.get("targetWorkload", "workload"))
        raw_steps = data.get("steps", [])
        steps = [
            RemediationStep.from_dict(s) if isinstance(s, dict) else s
            for s in raw_steps
        ]
        rollback = data.get("rollback_command", data.get("rollbackCommand"))
        return cls(
            plan_id=str(pid),
            target_workload=str(workload),
            summary=str(data.get("summary", "")),
            risk_level=str(data.get("risk_level", data.get("riskLevel", "low"))),
            steps=steps,
            rollback_command=str(rollback).strip() if rollback else None,
        )
