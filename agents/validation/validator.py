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

_NODE_CHECKS: Tuple[Tuple[Tuple[str, ...], str, str, str], ...] = (
    (
        ("memorypressure", "memory pressure"),
        "MemoryPressure",
        "False",
        (
            "Hypothesis claims Node MemoryPressure, but node conditions "
            "explicitly report MemoryPressure=False."
        ),
    ),
    (
        ("diskpressure", "disk pressure"),
        "DiskPressure",
        "False",
        (
            "Hypothesis claims Node DiskPressure, but node conditions "
            "explicitly report DiskPressure=False."
        ),
    ),
    (
        ("node not ready", "node is not ready"),
        "Ready",
        "True",
        (
            "Hypothesis claims Node is not ready, but node conditions "
            "explicitly report Ready=True."
        ),
    ),
)


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


def _match_container(c: Any, target_name: Optional[str]) -> bool:
    """Check if candidate dictionary matches target name.

    :param c: Candidate container item.
    :param target_name: Optional target container name.
    :return: True if item matches target container.
    """
    if not isinstance(c, dict):
        return False
    if not target_name:
        return True
    return c.get("name") == target_name


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
    for c in containers:
        if _match_container(c, target_name):
            return c
    valid = [c for c in containers if isinstance(c, dict)]
    return valid[0] if valid else None


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


def _extract_terminated_block(c_dict: Dict[str, Any], key: str) -> Optional[Dict[str, Any]]:
    """Extract terminated dictionary from a state key.

    :param c_dict: Container status dictionary.
    :param key: State attribute name ('lastState' or 'state').
    :return: Terminated dictionary if present.
    """
    sub = c_dict.get(key)
    if not isinstance(sub, dict):
        return None
    term = sub.get("terminated")
    return term if isinstance(term, dict) else None


def _get_exit_from_dict(d: Optional[Dict[str, Any]]) -> Optional[int]:
    """Extract integer exitCode from a dictionary.

    :param d: Candidate dictionary containing exitCode.
    :return: Integer exitCode or None.
    """
    if not isinstance(d, dict):
        return None
    return _safe_int(d.get("exitCode"))


def _extract_exit_code(c_dict: Dict[str, Any]) -> Optional[int]:
    """Extract container termination exit code from container status dictionary.

    :param c_dict: Container status dictionary.
    :return: Container termination exit code integer or None.
    """
    exit_last = _get_exit_from_dict(_extract_terminated_block(c_dict, "lastState"))
    if exit_last is not None:
        return exit_last

    exit_curr = _get_exit_from_dict(_extract_terminated_block(c_dict, "state"))
    if exit_curr is not None:
        return exit_curr

    term_direct = c_dict.get("terminated")
    if isinstance(term_direct, dict):
        return _get_exit_from_dict(term_direct)

    return _safe_int(c_dict.get("exitCode"))


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


def _build_oom_contradiction_reason(exit_code: int) -> str:
    """Build standardized contradiction rationale for OOMKilled mismatches.

    :param exit_code: Detected non-137 container exit code.
    :return: Explanation of the exit code discrepancy.
    """
    if exit_code == 1:
        return (
            "Hypothesis claims OOMKilled, but container exit code was 1 "
            "(application panic), not 137."
        )
    return f"Hypothesis claims OOMKilled but container exit code was {exit_code}, not 137."


def _check_oom_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle
) -> Optional[str]:
    """Detect contradiction when hypothesis claims OOMKilled but exit code != 137.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :return: Contradiction reason if refuted, None otherwise.
    """
    desc = hyp.description
    is_oom = "OOMKilled" in desc or any(
        k in desc.lower() for k in ("oomkilled", "out of memory")
    )
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
    if exit_code is None or exit_code == 137:
        return None

    return _build_oom_contradiction_reason(exit_code)


def _is_dns_replicas_ready(data: Dict[str, Any]) -> bool:
    """Check if DNS replicas match readyReplicas.

    :param data: DNS status dictionary.
    :return: True if replica counts are non-zero and match.
    """
    replicas = data.get("replicas")
    ready = data.get("readyReplicas", data.get("ready_replicas"))
    if replicas is None or ready is None:
        return False
    return replicas > 0 and replicas == ready


def _is_dns_status_healthy(data: Dict[str, Any]) -> bool:
    """Check if DNS status flags indicate healthy operation.

    :param data: DNS status dictionary.
    :return: True if status indicates healthy state.
    """
    if data.get("healthy") is True:
        return True
    status = str(data.get("status", "")).lower()
    if status in ("running", "healthy", "100% healthy"):
        return True
    return data.get("healthy_percent") == 100


def _is_dns_service_healthy(data: Any) -> bool:
    """Evaluate whether DNS data represents a 100% healthy DNS infrastructure.

    :param data: Raw DNS status payload.
    :return: True if DNS service is confirmed healthy.
    """
    if isinstance(data, dict):
        if _is_dns_status_healthy(data):
            return True
        return _is_dns_replicas_ready(data)
    if isinstance(data, str):
        lowered = data.lower()
        return "100% healthy" in lowered or "healthy" in lowered
    return False


def _check_dns_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle
) -> Optional[str]:
    """Detect contradiction when hypothesis claims DNS failure but CoreDNS is healthy.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :return: Contradiction reason if refuted, None otherwise.
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
        return (
            "Hypothesis claims DNS failure, but CoreDNS is 100% healthy "
            "with no resolution errors."
        )
    return None


def _check_crash_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle
) -> Optional[str]:
    """Detect contradiction when hypothesis claims process crash but exit code was 0.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :return: Contradiction reason if refuted, None otherwise.
    """
    desc_lower = hyp.description.lower()
    is_crash = any(k in desc_lower for k in ("crash", "panic", "crashloop"))
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
        return (
            "Hypothesis claims process crash, but container exited cleanly "
            "with exit code 0."
        )
    if "repeated" in desc_lower and restarts == 0:
        return (
            "Hypothesis claims repeated crash restarts, but container "
            "restart count is 0."
        )
    return None


def _container_has_no_probes(c_spec: Any) -> bool:
    """Check if container dictionary lacks probe definitions.

    :param c_spec: Container specification item.
    :return: True if both livenessProbe and readinessProbe are absent.
    """
    if not isinstance(c_spec, dict):
        return False
    return "livenessProbe" not in c_spec and "readinessProbe" not in c_spec


def _spec_has_no_probes(spec_data: Dict[str, Any]) -> bool:
    """Check whether pod specification lacks all health probes.

    :param spec_data: Pod specification dictionary.
    :return: True if neither liveness nor readiness probes are configured.
    """
    containers = spec_data.get("containers")
    if isinstance(containers, list) and containers:
        return _container_has_no_probes(containers[0])
    return "livenessProbe" not in spec_data and "readinessProbe" not in spec_data


def _event_has_probe_failure(ev: Any) -> bool:
    """Check if a single event reports probe failure.

    :param ev: Event dictionary.
    :return: True if message mentions probe failure or unhealthy condition.
    """
    if not isinstance(ev, dict):
        return False
    msg = str(ev.get("message", "")).lower()
    return "probe failed" in msg or "unhealthy" in msg


def _events_have_probe_failure(events_item: Optional[EvidenceItem]) -> bool:
    """Check if any event reports probe failures.

    :param events_item: Events evidence item.
    :return: True if any recorded warning indicates probe failures.
    """
    if not events_item or not events_item.data:
        return False
    ev_list = events_item.data if isinstance(events_item.data, list) else []
    return any(_event_has_probe_failure(ev) for ev in ev_list)


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
    return not _events_have_probe_failure(events_item)


def _spec_contradicts_probe(bundle: EvidenceBundle) -> bool:
    """Check if pod specification contradicts probe failure claim by lacking probes.

    :param bundle: EvidenceBundle containing cluster facts.
    :return: True if specification lacks health probes.
    """
    spec_item = bundle.get("ev.pod.spec") or bundle.get("ev.pod.manifest")
    if not spec_item or spec_item.status != CollectionStatus.AVAILABLE:
        return False
    if not isinstance(spec_item.data, dict):
        return False
    return _spec_has_no_probes(spec_item.data)


def _status_contradicts_probe(bundle: EvidenceBundle) -> bool:
    """Check if container status and events contradict probe failure claim.

    :param bundle: EvidenceBundle containing cluster facts.
    :return: True if probes are confirmed passing.
    """
    events_item = bundle.get("ev.pod.events")
    status_item = bundle.get("ev.pod.container.status")
    return _is_probe_passing(events_item, status_item)


def _check_probe_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle
) -> Optional[str]:
    """Detect contradiction when hypothesis claims probe failure without failing probes.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :return: Contradiction reason if refuted, None otherwise.
    """
    desc = hyp.description.lower()
    is_probe = "probe" in desc and any(
        k in desc for k in ("fail", "timeout", "liveness", "readiness")
    )
    if not is_probe:
        return None

    if _spec_contradicts_probe(bundle):
        return (
            "Hypothesis claims probe failure, but container specification "
            "has no health probes configured."
        )

    if _status_contradicts_probe(bundle):
        return (
            "Hypothesis claims probe failure, but container health probes "
            "are passing and container is ready."
        )

    return None


def _parse_single_condition(c: Any) -> Optional[Tuple[str, str]]:
    """Extract condition type and status tuple from candidate dictionary.

    :param c: Candidate condition item.
    :return: Condition type and status tuple or None.
    """
    if not isinstance(c, dict):
        return None
    c_type = c.get("type")
    c_status = c.get("status")
    if c_type is None or c_status is None:
        return None
    return (str(c_type), str(c_status))


def _extract_node_conditions_map(data: Any) -> Dict[str, str]:
    """Map condition types to status strings from node condition evidence.

    :param data: Raw node conditions payload.
    :return: Mapping of condition type strings to status strings.
    """
    conditions = data.get("conditions", data) if isinstance(data, dict) else data
    if not isinstance(conditions, list):
        return {}
    parsed = (_parse_single_condition(c) for c in conditions)
    return {k: v for pair in parsed if pair is not None for k, v in [pair]}


def _check_node_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle
) -> Optional[str]:
    """Detect contradiction when hypothesis claims node pressure refuted by node conditions.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :return: Contradiction reason if refuted, None otherwise.
    """
    desc = hyp.description.lower()
    node_item = bundle.get("ev.node.conditions") or bundle.get("ev.node.status")
    if not node_item or node_item.status != CollectionStatus.AVAILABLE or not node_item.data:
        return None

    cond_map = _extract_node_conditions_map(node_item.data)
    for keywords, cond_type, expected_status, reason in _NODE_CHECKS:
        if any(k in desc for k in keywords) and cond_map.get(cond_type) == expected_status:
            return reason

    return None


def _check_image_pull_contradiction(
    hyp: Hypothesis, bundle: EvidenceBundle
) -> Optional[str]:
    """Detect contradiction when hypothesis claims image pull failure but container is running.

    :param hyp: Candidate hypothesis to cross-check.
    :param bundle: EvidenceBundle containing cluster facts.
    :return: Contradiction reason if refuted, None otherwise.
    """
    desc = hyp.description.lower()
    if "imagepull" not in desc and "errimagepull" not in desc:
        return None

    status_item = bundle.get("ev.pod.container.status")
    if not status_item or not status_item.data:
        return None

    target_name = bundle.target.container_name if bundle.target else None
    c_dict = _extract_container_dict(status_item.data, target_name)
    if not c_dict or not _is_container_running(c_dict):
        return None

    return (
        "Hypothesis claims image pull failure, but container image "
        "was pulled successfully and container is running."
    )


def _penalize_hypothesis(
    hyp: Hypothesis, val_result: ValidationResult
) -> Hypothesis:
    """Return an updated hypothesis copy penalized with contradiction evidence.

    :param hyp: Original hypothesis dataclass instance.
    :param val_result: Disproving validation outcome.
    :return: Updated Hypothesis with penalized likelihood and contradiction reason.
    """
    contra = list(hyp.contradicting_evidence)
    if val_result.reason and val_result.reason not in contra:
        contra.append(val_result.reason)
    return Hypothesis(
        id=hyp.id,
        description=hyp.description,
        likelihood=val_result.confidence_score,
        supporting_evidence=list(hyp.supporting_evidence),
        contradicting_evidence=contra,
    )


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

        checks = (
            _check_oom_contradiction,
            _check_dns_contradiction,
            _check_crash_contradiction,
            _check_probe_contradiction,
            _check_node_contradiction,
            _check_image_pull_contradiction,
        )
        for check_fn in checks:
            reason = check_fn(top_hypothesis, bundle)
            if reason is not None:
                return ValidationResult(
                    approved=False,
                    confidence_score=self.default_downgrade_score,
                    reason=reason,
                )

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
                resolved.append(_penalize_hypothesis(hyp, val_result))
            else:
                resolved.append(hyp)

        resolved.sort(key=lambda h: h.likelihood, reverse=True)
        return resolved
