"""
Cross-Agent Validator and Disagreement Resolution — KDM v4.0.0
==============================================================
Acts as an adversarial verification engine that cross-checks proposed hypotheses
from the Lead SRE Investigator against ground-truth cluster facts in the
EvidenceBundle to detect hallucinations, confirmation bias, and false positives.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem
    from agents.synthesis.hypotheses import Hypothesis
except ImportError:
    from core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem  # type: ignore[no-redef]
    from synthesis.hypotheses import Hypothesis  # type: ignore[no-redef]


@dataclass
class ValidationResult:
    """Outcome of adversarial cross-validation against cluster facts.

    Attributes:
        approved: True if verified against cluster facts, False if contradicted.
        confidence_score: Calibrated confidence score (downgraded upon contradiction).
        reason: Explanation of the verification outcome or detailed contradiction rationale.
    """

    approved: bool
    confidence_score: float
    reason: str

    def __post_init__(self) -> None:
        """Validate, sanitize, and clamp confidence score to [0.0, 1.0]."""
        try:
            val = float(self.confidence_score)
            is_valid = math.isfinite(val)
            self.confidence_score = round(max(0.0, min(1.0, val)) if is_valid else 0.2, 4)
        except (ValueError, TypeError):
            self.confidence_score = 0.2
        self.approved = bool(self.approved)
        self.reason = str(self.reason or "")

    def to_dict(self) -> Dict[str, Any]:
        """Convert result to a standard dictionary suitable for JSON serialization.

        :return: Standardized dictionary representation of the validation result.
        """
        return {
            "approved": self.approved,
            "confidence_score": round(float(self.confidence_score), 4),
            "reason": self.reason,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ValidationResult:
        """Construct a ValidationResult instance from a dictionary.

        :param data: Dictionary containing validation fields.
        :return: Validated ValidationResult dataclass instance.
        """
        return cls(
            approved=bool(data.get("approved", False)),
            confidence_score=data.get("confidence_score", 0.0),
            reason=str(data.get("reason", "")),
        )


def _safe_int(val: Any) -> Optional[int]:
    """Safely convert a value to int if possible.

    :param val: Candidate value to convert.
    :return: Integer value or None if conversion fails.
    """
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def _find_container_in_list(
    containers: List[Any], target_name: Optional[str]
) -> Optional[Dict[str, Any]]:
    """Find a named container in a list of container dictionaries.

    :param containers: List of container objects or dictionaries.
    :param target_name: Optional target container name to match.
    :return: Matched container status dictionary, or first valid entry.
    """
    if not containers:
        return None
    valid_dicts = [c for c in containers if isinstance(c, dict)]
    if target_name:
        for c in valid_dicts:
            if c.get("name") == target_name:
                return c
    return valid_dicts[0] if valid_dicts else None


def _extract_container_dict(
    data: Any, target_name: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Extract a matching container status dictionary from raw status data.

    :param data: Raw status payload from EvidenceBundle.
    :param target_name: Optional name of the container to prioritize.
    :return: Normalized container status dictionary or None.
    """
    if isinstance(data, dict):
        statuses = data.get("containerStatuses")
        if isinstance(statuses, list):
            return _find_container_in_list(statuses, target_name)
        return data
    if isinstance(data, list):
        return _find_container_in_list(data, target_name)
    return None


def _extract_exit_code(c_dict: Dict[str, Any]) -> Optional[int]:
    """Extract container termination exit code from container status dictionary.

    :param c_dict: Container status dictionary.
    :return: Container termination exit code integer or None.
    """
    for state_key in ("lastState", "state"):
        state_obj = c_dict.get(state_key)
        if isinstance(state_obj, dict):
            terminated = state_obj.get("terminated")
            if isinstance(terminated, dict) and "exitCode" in terminated:
                return _safe_int(terminated.get("exitCode"))
    terminated = c_dict.get("terminated")
    if isinstance(terminated, dict) and "exitCode" in terminated:
        return _safe_int(terminated.get("exitCode"))
    if "exitCode" in c_dict:
        return _safe_int(c_dict.get("exitCode"))
    return None


def _extract_restart_count(c_dict: Dict[str, Any]) -> Optional[int]:
    """Extract restart count integer from container status dictionary.

    :param c_dict: Container status dictionary.
    :return: Integer restart count or None.
    """
    if "restartCount" in c_dict:
        return _safe_int(c_dict.get("restartCount"))
    if "restart_count" in c_dict:
        return _safe_int(c_dict.get("restart_count"))
    return None


def _is_container_ready(c_dict: Dict[str, Any]) -> bool:
    """Check if container status reports ready is True.

    :param c_dict: Container status dictionary.
    :return: True if container reports ready, False otherwise.
    """
    return c_dict.get("ready") is True


def _is_container_running(c_dict: Dict[str, Any]) -> bool:
    """Check if container state indicates it is actively running.

    :param c_dict: Container status dictionary.
    :return: True if container state is running, False otherwise.
    """
    state = c_dict.get("state")
    if isinstance(state, dict) and "running" in state:
        return True
    return c_dict.get("running") is True


def _check_oom_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle, downgrade_score: float
) -> Optional[ValidationResult]:
    """Detect contradiction when hypothesis claims OOMKilled but exit code != 137.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :param downgrade_score: Calibrated score to assign upon contradiction.
    :return: Contradicted ValidationResult if refuted, None otherwise.
    """
    desc = hyp.description
    is_oom = "OOMKilled" in desc or "oomkilled" in desc.lower() or "out of memory" in desc.lower()
    if not is_oom:
        return None

    status_item = bundle.get("ev.pod.container.status")
    if not status_item or not status_item.data:
        return None

    target_name = bundle.target.container_name if bundle.target else None
    c_dict = _extract_container_dict(status_item.data, target_name)
    if not c_dict:
        return None

    exit_code = _extract_exit_code(c_dict)
    if exit_code is not None and exit_code != 137:
        if exit_code == 1:
            reason = (
                "Hypothesis claims OOMKilled, but container exit code was 1 "
                "(application panic), not 137."
            )
        else:
            reason = f"Hypothesis claims OOMKilled but container exit code was {exit_code}, not 137."
        return ValidationResult(
            approved=False,
            confidence_score=downgrade_score,
            reason=reason,
        )
    return None


def _is_dns_service_healthy(data: Any) -> bool:
    """Evaluate whether DNS data represents a 100% healthy DNS infrastructure.

    :param data: Raw DNS status payload.
    :return: True if DNS service is confirmed healthy.
    """
    if isinstance(data, dict):
        if data.get("healthy") is True or data.get("status") in (
            "Running",
            "Healthy",
            "100% healthy",
        ):
            return True
        if data.get("healthy_percent") == 100 or str(data.get("health", "")).lower() == "healthy":
            return True
        replicas = data.get("replicas")
        ready = data.get("readyReplicas", data.get("ready_replicas"))
        if replicas and ready and replicas == ready:
            return True
    if isinstance(data, str) and ("100% healthy" in data.lower() or "healthy" in data.lower()):
        return True
    return False


def _check_dns_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle, downgrade_score: float
) -> Optional[ValidationResult]:
    """Detect contradiction when hypothesis claims DNS failure but CoreDNS is healthy.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :param downgrade_score: Calibrated score to assign upon contradiction.
    :return: Contradicted ValidationResult if refuted, None otherwise.
    """
    desc_lower = hyp.description.lower()
    if "dns" not in desc_lower and "coredns" not in desc_lower:
        return None

    dns_item = (
        bundle.get("ev.cluster.dns.status")
        or bundle.get("ev.dns.status")
        or bundle.get("ev.coredns.status")
        or bundle.get("ev.cluster.dns")
    )
    if not dns_item or dns_item.status != CollectionStatus.AVAILABLE or not dns_item.data:
        return None

    if _is_dns_service_healthy(dns_item.data):
        return ValidationResult(
            approved=False,
            confidence_score=downgrade_score,
            reason="Hypothesis claims DNS failure, but CoreDNS is 100% healthy with no resolution errors.",
        )
    return None


def _check_crash_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle, downgrade_score: float
) -> Optional[ValidationResult]:
    """Detect contradiction when hypothesis claims process crash but exit code was 0.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :param downgrade_score: Calibrated score to assign upon contradiction.
    :return: Contradicted ValidationResult if refuted, None otherwise.
    """
    desc_lower = hyp.description.lower()
    is_crash = "crash" in desc_lower or "panic" in desc_lower or "crashloop" in desc_lower
    if not is_crash:
        return None

    status_item = bundle.get("ev.pod.container.status")
    if not status_item or not status_item.data:
        return None

    target_name = bundle.target.container_name if bundle.target else None
    c_dict = _extract_container_dict(status_item.data, target_name)
    if not c_dict:
        return None

    exit_code = _extract_exit_code(c_dict)
    restarts = _extract_restart_count(c_dict)
    if exit_code == 0 and (restarts is None or restarts == 0):
        return ValidationResult(
            approved=False,
            confidence_score=downgrade_score,
            reason="Hypothesis claims process crash, but container exited cleanly with exit code 0.",
        )
    if "repeated" in desc_lower and restarts == 0:
        return ValidationResult(
            approved=False,
            confidence_score=downgrade_score,
            reason="Hypothesis claims repeated crash restarts, but container restart count is 0.",
        )
    return None


def _has_no_probes_configured(spec_data: Dict[str, Any]) -> bool:
    """Check whether pod specification lacks liveness and readiness probes.

    :param spec_data: Pod specification dictionary.
    :return: True if neither liveness nor readiness probes are configured.
    """
    containers = spec_data.get("containers")
    if isinstance(containers, list) and containers:
        first = containers[0]
        if isinstance(first, dict):
            return "livenessProbe" not in first and "readinessProbe" not in first
    return "livenessProbe" not in spec_data and "readinessProbe" not in spec_data


def _is_probe_passing(
    events_item: Optional[EvidenceItem], status_item: Optional[EvidenceItem]
) -> bool:
    """Determine whether probes are passing based on events and status.

    :param events_item: Pod events evidence item.
    :param status_item: Pod container status evidence item.
    :return: True if container reports ready and no probe warning events exist.
    """
    if not status_item or not status_item.data:
        return False
    c_dict = _extract_container_dict(status_item.data)
    if not c_dict or not _is_container_ready(c_dict):
        return False

    if events_item and events_item.data:
        ev_list = events_item.data if isinstance(events_item.data, list) else []
        for ev in ev_list:
            if isinstance(ev, dict):
                msg = str(ev.get("message", "")).lower()
                if "probe failed" in msg or "unhealthy" in msg:
                    return False
    return True


def _check_probe_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle, downgrade_score: float
) -> Optional[ValidationResult]:
    """Detect contradiction when hypothesis claims probe failure without failing probes.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :param downgrade_score: Calibrated score to assign upon contradiction.
    :return: Contradicted ValidationResult if refuted, None otherwise.
    """
    desc_lower = hyp.description.lower()
    is_probe = "probe" in desc_lower and (
        "fail" in desc_lower
        or "timeout" in desc_lower
        or "liveness" in desc_lower
        or "readiness" in desc_lower
    )
    if not is_probe:
        return None

    spec_item = bundle.get("ev.pod.spec") or bundle.get("ev.pod.manifest")
    if (
        spec_item
        and spec_item.status == CollectionStatus.AVAILABLE
        and isinstance(spec_item.data, dict)
    ):
        if _has_no_probes_configured(spec_item.data):
            return ValidationResult(
                approved=False,
                confidence_score=downgrade_score,
                reason=(
                    "Hypothesis claims probe failure, but container specification "
                    "has no health probes configured."
                ),
            )

    events_item = bundle.get("ev.pod.events")
    status_item = bundle.get("ev.pod.container.status")
    if _is_probe_passing(events_item, status_item):
        return ValidationResult(
            approved=False,
            confidence_score=downgrade_score,
            reason=(
                "Hypothesis claims probe failure, but container health probes "
                "are passing and container is ready."
            ),
        )
    return None


def _extract_node_conditions_map(data: Any) -> Dict[str, str]:
    """Map condition types to status strings from node condition evidence.

    :param data: Raw node conditions payload.
    :return: Mapping of condition type strings to status strings.
    """
    conditions = data.get("conditions", data) if isinstance(data, dict) else data
    if not isinstance(conditions, list):
        return {}
    res: Dict[str, str] = {}
    for c in conditions:
        if isinstance(c, dict) and "type" in c and "status" in c:
            res[str(c["type"])] = str(c["status"])
    return res


def _check_node_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle, downgrade_score: float
) -> Optional[ValidationResult]:
    """Detect contradiction when hypothesis claims node pressure refuted by node conditions.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :param downgrade_score: Calibrated score to assign upon contradiction.
    :return: Contradicted ValidationResult if refuted, None otherwise.
    """
    desc_lower = hyp.description.lower()
    node_item = bundle.get("ev.node.conditions") or bundle.get("ev.node.status")
    if not node_item or node_item.status != CollectionStatus.AVAILABLE or not node_item.data:
        return None

    cond_map = _extract_node_conditions_map(node_item.data)
    if not cond_map:
        return None

    if ("memorypressure" in desc_lower or "memory pressure" in desc_lower) and cond_map.get(
        "MemoryPressure"
    ) == "False":
        return ValidationResult(
            approved=False,
            confidence_score=downgrade_score,
            reason=(
                "Hypothesis claims Node MemoryPressure, but node conditions "
                "explicitly report MemoryPressure=False."
            ),
        )
    if ("diskpressure" in desc_lower or "disk pressure" in desc_lower) and cond_map.get(
        "DiskPressure"
    ) == "False":
        return ValidationResult(
            approved=False,
            confidence_score=downgrade_score,
            reason=(
                "Hypothesis claims Node DiskPressure, but node conditions "
                "explicitly report DiskPressure=False."
            ),
        )
    if (
        "node not ready" in desc_lower or "node is not ready" in desc_lower
    ) and cond_map.get("Ready") == "True":
        return ValidationResult(
            approved=False,
            confidence_score=downgrade_score,
            reason=(
                "Hypothesis claims Node is not ready, but node conditions "
                "explicitly report Ready=True."
            ),
        )
    return None


def _check_image_pull_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle, downgrade_score: float
) -> Optional[ValidationResult]:
    """Detect contradiction when hypothesis claims image pull failure but container is running.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :param downgrade_score: Calibrated score to assign upon contradiction.
    :return: Contradicted ValidationResult if refuted, None otherwise.
    """
    desc_lower = hyp.description.lower()
    if "imagepull" not in desc_lower and "errimagepull" not in desc_lower:
        return None

    status_item = bundle.get("ev.pod.container.status")
    if not status_item or not status_item.data:
        return None

    target_name = bundle.target.container_name if bundle.target else None
    c_dict = _extract_container_dict(status_item.data, target_name)
    if c_dict and _is_container_running(c_dict):
        return ValidationResult(
            approved=False,
            confidence_score=downgrade_score,
            reason=(
                "Hypothesis claims image pull failure, but container image "
                "was pulled successfully and container is running."
            ),
        )
    return None


class CrossAgentValidator:
    """Adversarial validator cross-checking diagnostic hypotheses against cluster facts."""

    def __init__(self, default_downgrade_score: float = 0.2) -> None:
        """Initialize validator with calibrated downgrade score for contradicted hypotheses.

        :param default_downgrade_score: Likelihood score assigned when a hypothesis is contradicted.
        """
        self.default_downgrade_score = default_downgrade_score

    def validate(
        self, top_hypothesis: Optional[Hypothesis], bundle: Optional[EvidenceBundle]
    ) -> ValidationResult:
        """Cross-check a hypothesis against cluster facts in the EvidenceBundle.

        :param top_hypothesis: Diagnostic hypothesis to validate.
        :param bundle: EvidenceBundle containing collected cluster facts.
        :return: ValidationResult with approval status, calibrated score, and explanation.
        """
        if top_hypothesis is None:
            return ValidationResult(
                approved=False,
                confidence_score=0.0,
                reason="No hypothesis provided for validation.",
            )
        if bundle is None:
            return ValidationResult(
                approved=True,
                confidence_score=top_hypothesis.likelihood,
                reason="No evidence bundle provided; hypothesis accepted with unverified confidence.",
            )

        contradiction_checks = (
            _check_oom_contradiction,
            _check_dns_contradiction,
            _check_crash_contradiction,
            _check_probe_contradiction,
            _check_node_contradiction,
            _check_image_pull_contradiction,
        )
        for check_fn in contradiction_checks:
            result = check_fn(top_hypothesis, bundle, self.default_downgrade_score)
            if result is not None:
                return result

        return ValidationResult(
            approved=True,
            confidence_score=top_hypothesis.likelihood,
            reason="No contradictions found.",
        )

    def validate_hypotheses(
        self, hypotheses: List[Hypothesis], bundle: Optional[EvidenceBundle]
    ) -> List[Tuple[Hypothesis, ValidationResult]]:
        """Validate multiple hypotheses against the EvidenceBundle.

        :param hypotheses: List of candidate hypotheses to validate.
        :param bundle: EvidenceBundle containing cluster facts.
        :return: List of tuples pairing each hypothesis with its ValidationResult.
        """
        return [(hyp, self.validate(hyp, bundle)) for hyp in hypotheses]

    def resolve_disagreements(
        self, hypotheses: List[Hypothesis], bundle: Optional[EvidenceBundle]
    ) -> List[Hypothesis]:
        """Cross-validate candidate hypotheses, penalize contradicted ones, and re-rank.

        :param hypotheses: List of candidate hypotheses from Lead Investigator.
        :param bundle: Collected EvidenceBundle containing cluster facts.
        :return: Re-ranked list of hypotheses with calibrated likelihoods and attached contradictions.
        """
        resolved: List[Hypothesis] = []
        for hyp in hypotheses:
            val_result = self.validate(hyp, bundle)
            if not val_result.approved:
                contra = list(hyp.contradicting_evidence)
                if val_result.reason and val_result.reason not in contra:
                    contra.append(val_result.reason)
                updated_hyp = Hypothesis(
                    id=hyp.id,
                    description=hyp.description,
                    likelihood=val_result.confidence_score,
                    supporting_evidence=list(hyp.supporting_evidence),
                    contradicting_evidence=contra,
                )
                resolved.append(updated_hyp)
            else:
                resolved.append(hyp)

        resolved.sort(key=lambda h: h.likelihood, reverse=True)
        return resolved
