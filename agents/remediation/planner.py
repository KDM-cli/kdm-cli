"""
Remediation Planner Engine — KDM v4.0.0
=======================================
Synthesizes verified consensus diagnoses into auditable, minimal remediation
plans equipped with discrete ordered steps, manifest diff previews, risk
classifications, and safe kubectl rollback commands.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.remediation.types import RemediationPlan, RemediationStep, normalize_risk_level
except ImportError:
    from .types import RemediationPlan, RemediationStep, normalize_risk_level  # type: ignore[no-redef]


@dataclass
class WorkloadTargetInfo:
    """Encapsulates target workload coordinates for safe command generation.

    Attributes:
        workload_kind: Kubernetes workload kind (e.g. 'deployment', 'statefulset').
        workload_name: Name of the workload resource.
        namespace: Namespace the workload resides in.
        container_name: Optional target container name.
    """

    workload_kind: str = "deployment"
    workload_name: str = "workload"
    namespace: str = "default"
    container_name: Optional[str] = None


@dataclass
class PlanContext:
    """Carries context and workload facts throughout plan synthesis.

    Attributes:
        info: Target workload coordinates and naming.
        plan_id: Unique identifier assigned to the plan.
        consensus: Verified ConsensusDiagnosis object or raw diagnosis text.
        bundle: Optional evidence bundle containing observable cluster facts.
    """

    info: WorkloadTargetInfo
    plan_id: str
    consensus: Any = None
    bundle: Optional[Any] = None


def extract_workload_info(bundle: Optional[Any] = None, consensus: Optional[Any] = None) -> WorkloadTargetInfo:
    """Extract workload identity, kind, and namespace from evidence bundle or consensus.

    :param bundle: EvidenceBundle or dict containing target facts.
    :param consensus: ConsensusDiagnosis or dict for fallback discovery.
    :return: WorkloadTargetInfo with verified or sensible defaults.
    """
    if bundle is not None and hasattr(bundle, "target") and bundle.target is not None:
        target = bundle.target
        kind = getattr(target, "workload_kind", None) or "deployment"
        name = getattr(target, "workload_name", None) or "workload"
        ns = getattr(target, "namespace", None) or "default"
        c_name = getattr(target, "container_name", None)
        return WorkloadTargetInfo(
            workload_kind=str(kind).strip().lower(),
            workload_name=str(name).strip(),
            namespace=str(ns).strip(),
            container_name=str(c_name).strip() if c_name else None,
        )

    if isinstance(bundle, dict) and "target" in bundle:
        td = bundle["target"]
        if isinstance(td, dict):
            kind = td.get("workload_kind", td.get("workloadKind", "deployment"))
            name = td.get("workload_name", td.get("workloadName", "workload"))
            ns = td.get("namespace", "default")
            c_name = td.get("container_name", td.get("containerName"))
            return WorkloadTargetInfo(
                workload_kind=str(kind).strip().lower(),
                workload_name=str(name).strip(),
                namespace=str(ns).strip(),
                container_name=str(c_name).strip() if c_name else None,
            )

    return _fallback_workload_from_consensus(consensus)


def _fallback_workload_from_consensus(consensus: Optional[Any]) -> WorkloadTargetInfo:
    """Fallback extraction of workload identity from consensus text."""
    if consensus is None:
        return WorkloadTargetInfo()

    raw_text = ""
    if isinstance(consensus, dict):
        raw_text = str(consensus.get("root_cause") or consensus.get("rootCause") or "")
    elif hasattr(consensus, "root_cause"):
        raw_text = str(getattr(consensus, "root_cause", "") or "")
    elif isinstance(consensus, str):
        raw_text = consensus

    match = re.search(r"deployment[s]?/([a-zA-Z0-9_\-]+)", raw_text, re.IGNORECASE)
    workload_name = match.group(1) if match else "workload"
    return WorkloadTargetInfo(workload_name=workload_name)


def calculate_memory_bump(
    current_limit: Optional[str] = None,
    factor: float = 2.0,
    default_base: str = "256Mi",
) -> Tuple[str, str]:
    """Calculate safe conservative memory limit increase (e.g. 256Mi -> 512Mi).

    :param current_limit: Original memory limit string (e.g. '256Mi', '1Gi').
    :param factor: Scaling factor to apply (defaults to 2.0x).
    :param default_base: Fallback limit string if missing or unparseable.
    :return: Tuple containing (sanitized_original_limit, bumped_limit).
    """
    if not current_limit or not isinstance(current_limit, str) or not current_limit.strip():
        current_limit = default_base

    match = re.match(r"^(\d+(?:\.\d+)?)\s*([A-Za-z]*)$", current_limit.strip())
    if not match:
        return default_base, "512Mi"

    num_str, unit = match.groups()
    try:
        num = float(num_str)
    except ValueError:
        return default_base, "512Mi"

    unit = unit if unit else "Mi"
    bumped = num * factor

    orig_val = int(num) if num.is_integer() else round(num, 1)
    bumped_val = int(bumped) if bumped.is_integer() else round(bumped, 1)

    return f"{orig_val}{unit}", f"{bumped_val}{unit}"


def generate_rollback_command(info: WorkloadTargetInfo) -> str:
    """Generate safe, auditable kubectl rollback command.

    :param info: Workload coordinates.
    :return: Formatted kubectl rollout undo command string.
    """
    kind = (info.workload_kind or "deployment").strip().lower()
    name = (info.workload_name or "workload").strip()
    ns = info.namespace.strip() if info.namespace and info.namespace.strip() else None

    resource_kind = kind if kind in ("deployment", "statefulset", "daemonset") else "deployment"
    cmd = f"kubectl rollout undo {resource_kind}/{name}"
    if ns:
        cmd += f" -n {ns}"
    return cmd


class RemediationPlanner:
    """Converts verified consensus diagnoses into actionable remediation plans."""

    def __init__(self) -> None:
        """Initialize plan counter registry for deterministic plan IDs."""
        self._counters: Dict[str, int] = {}

    def _next_plan_id(self, category: str) -> str:
        """Generate predictable sequential plan identifier.

        :param category: Short failure identifier (e.g. 'oom', 'crashloop').
        :return: Formatted plan ID (e.g. 'plan-oom-001').
        """
        self._counters[category] = self._counters.get(category, 0) + 1
        return f"plan-{category}-{self._counters[category]:03d}"

    def create_plan(
        self,
        consensus: Any,
        bundle: Optional[Any] = None,
        plan_id: Optional[str] = None,
    ) -> RemediationPlan:
        """Generate a complete structured remediation plan with rollback instructions.

        :param consensus: Verified ConsensusDiagnosis object, dictionary, or string.
        :param bundle: Optional EvidenceBundle containing cluster facts.
        :param plan_id: Optional custom plan identifier.
        :return: RemediationPlan instance.
        """
        info = extract_workload_info(bundle, consensus)
        category = self._classify_failure(consensus, bundle)
        pid = plan_id or self._next_plan_id(category)
        ctx = PlanContext(info=info, plan_id=pid, consensus=consensus, bundle=bundle)

        handlers = {
            "oom": self._plan_oom_killed,
            "crashloop": self._plan_crashloop,
            "imagepull": self._plan_image_pull,
        }
        planner_func = handlers.get(category, self._plan_generic)
        plan = planner_func(ctx)

        if not plan.rollback_command:
            plan.rollback_command = generate_rollback_command(info)

        return plan

    def _classify_failure(self, consensus: Any, bundle: Optional[Any]) -> str:
        """Classify root cause category from consensus or evidence bundle.

        :param consensus: Consensus diagnosis or text.
        :param bundle: Evidence bundle.
        :return: One of 'oom', 'crashloop', 'imagepull', or 'generic'.
        """
        text = self._gather_diagnostic_text(consensus, bundle).lower()

        if any(k in text for k in ("oomkilled", "137", "out-of-memory", "memory limit", "oom_killed")):
            return "oom"
        if any(k in text for k in ("crashloopbackoff", "crashloop", "exit code 1", "crashloop_backoff")):
            return "crashloop"
        if any(k in text for k in ("imagepullbackoff", "errimagepull", "image_pull", "image pull")):
            return "imagepull"
        return "generic"

    def _gather_diagnostic_text(self, consensus: Any, bundle: Optional[Any]) -> str:
        """Concatenate diagnostic context strings for signature matching."""
        parts: List[str] = []
        if isinstance(consensus, str):
            parts.append(consensus)
        elif isinstance(consensus, dict):
            parts.append(str(consensus.get("root_cause") or consensus.get("rootCause") or ""))
        elif hasattr(consensus, "root_cause"):
            parts.append(str(getattr(consensus, "root_cause", "") or ""))

        if bundle is not None and hasattr(bundle, "get"):
            status_item = bundle.get("ev.pod.container.status")
            if status_item and status_item.data:
                parts.append(str(status_item.data))

        return " ".join(parts)

    def _find_memory_limit(self, bundle: Optional[Any], consensus: Any) -> Optional[str]:
        """Locate current memory limit from evidence bundle or consensus root cause."""
        if bundle is not None and hasattr(bundle, "get"):
            limits_item = bundle.get("ev.resources.limits")
            if limits_item and isinstance(limits_item.data, dict):
                mem = limits_item.data.get("memory")
                if mem:
                    return str(mem)

        raw_text = self._gather_diagnostic_text(consensus, bundle)
        match = re.search(r"\b(\d+(?:\.\d+)?\s*(?:[KMGT]i|[KMGT]))\b", raw_text)
        return match.group(1) if match else None

    def _plan_oom_killed(self, ctx: PlanContext) -> RemediationPlan:
        """Plan resource adjustment for OOMKilled workload."""
        curr_mem = self._find_memory_limit(ctx.bundle, ctx.consensus)
        old_limit, new_limit = calculate_memory_bump(curr_mem, factor=2.0)

        ns_arg = f" -n {ctx.info.namespace}" if ctx.info.namespace else ""
        command = (
            f"kubectl set resources {ctx.info.workload_kind} {ctx.info.workload_name} "
            f"--limits=memory={new_limit}{ns_arg}"
        )
        diff = f"- memory: {old_limit}\n+ memory: {new_limit}"

        step = RemediationStep(
            order=1,
            title="Update container memory limit",
            command=command,
            diff_preview=diff,
            is_destructive=False,
        )
        summary = f"Bump memory limit to {new_limit} to prevent OOMKill restarts."
        rollback = generate_rollback_command(ctx.info)

        return RemediationPlan(
            plan_id=ctx.plan_id,
            target_workload=ctx.info.workload_name,
            summary=summary,
            risk_level="low",
            steps=[step],
            rollback_command=rollback,
        )

    def _plan_crashloop(self, ctx: PlanContext) -> RemediationPlan:
        """Plan diagnostic inspection and restart for CrashLoopBackOff workload."""
        ns_arg = f" -n {ctx.info.namespace}" if ctx.info.namespace else ""

        step1 = RemediationStep(
            order=1,
            title="Inspect previous container crash logs",
            command=f"kubectl logs {ctx.info.workload_kind}/{ctx.info.workload_name} --previous{ns_arg}",
            diff_preview=None,
            is_destructive=False,
        )
        step2 = RemediationStep(
            order=2,
            title="Update workload environment configuration",
            command=f"kubectl set env {ctx.info.workload_kind}/{ctx.info.workload_name} --list{ns_arg}",
            diff_preview="- CONFIG_VAR=invalid_value\n+ CONFIG_VAR=corrected_value",
            is_destructive=False,
        )
        step3 = RemediationStep(
            order=3,
            title="Restart workload pods",
            command=f"kubectl rollout restart {ctx.info.workload_kind}/{ctx.info.workload_name}{ns_arg}",
            diff_preview=None,
            is_destructive=True,
        )
        summary = f"Update configuration/environment variables and restart {ctx.info.workload_name}."
        rollback = generate_rollback_command(ctx.info)

        return RemediationPlan(
            plan_id=ctx.plan_id,
            target_workload=ctx.info.workload_name,
            summary=summary,
            risk_level="medium",
            steps=[step1, step2, step3],
            rollback_command=rollback,
        )

    def _plan_image_pull(self, ctx: PlanContext) -> RemediationPlan:
        """Plan image tag update and secret creation for ImagePullBackOff workload."""
        ns_arg = f" -n {ctx.info.namespace}" if ctx.info.namespace else ""
        c_name = ctx.info.container_name or ctx.info.workload_name
        old_image = f"{ctx.info.workload_name}:invalid-tag"
        new_image = f"{ctx.info.workload_name}:latest"

        step1 = RemediationStep(
            order=1,
            title="Update container image reference",
            command=f"kubectl set image {ctx.info.workload_kind}/{ctx.info.workload_name} {c_name}={new_image}{ns_arg}",
            diff_preview=f"- image: {old_image}\n+ image: {new_image}",
            is_destructive=False,
        )
        step2 = RemediationStep(
            order=2,
            title="Create container registry pull secret",
            command=(
                f"kubectl create secret docker-registry regcred "
                f"--docker-server=https://index.docker.io/v1/ "
                f"--docker-username=<user> --docker-password=<token>{ns_arg}"
            ),
            diff_preview=None,
            is_destructive=False,
        )
        summary = f"Fix image tag and configure registry pull secret for {ctx.info.workload_name}."
        rollback = generate_rollback_command(ctx.info)

        return RemediationPlan(
            plan_id=ctx.plan_id,
            target_workload=ctx.info.workload_name,
            summary=summary,
            risk_level="low",
            steps=[step1, step2],
            rollback_command=rollback,
        )

    def _plan_generic(self, ctx: PlanContext) -> RemediationPlan:
        """Fallback planner utilizing consensus BestSolution or standard diagnostics."""
        solution = self._get_best_solution(ctx.consensus)

        if solution is not None:
            return self._build_plan_from_solution(solution, ctx)

        ns_arg = f" -n {ctx.info.namespace}" if ctx.info.namespace else ""
        step1 = RemediationStep(
            order=1,
            title="Describe workload status and events",
            command=f"kubectl describe {ctx.info.workload_kind}/{ctx.info.workload_name}{ns_arg}",
            is_destructive=False,
        )
        step2 = RemediationStep(
            order=2,
            title="Fetch recent workload logs",
            command=f"kubectl logs {ctx.info.workload_kind}/{ctx.info.workload_name}{ns_arg}",
            is_destructive=False,
        )
        return RemediationPlan(
            plan_id=ctx.plan_id,
            target_workload=ctx.info.workload_name,
            summary=f"Investigate and remediate failure in {ctx.info.workload_name}.",
            risk_level="low",
            steps=[step1, step2],
            rollback_command=generate_rollback_command(ctx.info),
        )

    def _get_best_solution(self, consensus: Any) -> Optional[Any]:
        """Extract BestSolution from consensus if present."""
        if hasattr(consensus, "best_solution") and consensus.best_solution:
            return consensus.best_solution
        if isinstance(consensus, dict):
            return consensus.get("best_solution") or consensus.get("bestSolution")
        return None

    def _build_plan_from_solution(self, solution: Any, ctx: PlanContext) -> RemediationPlan:
        """Convert a pre-synthesized BestSolution into a RemediationPlan."""
        title = (
            getattr(solution, "action_title", None)
            or getattr(solution, "actionTitle", None)
            or "Apply Recommended Fix"
        )
        raw_steps = getattr(solution, "steps", None) or ["Review workload status."]
        command = getattr(solution, "command_to_run", None) or getattr(solution, "commandToRun", None)
        risk = getattr(solution, "risk_level", None) or getattr(solution, "riskLevel", "low")

        ns_arg = f" -n {ctx.info.namespace}" if ctx.info.namespace else ""
        steps: List[RemediationStep] = []
        for idx, s_text in enumerate(raw_steps, start=1):
            if idx == 1 and command:
                step_cmd = str(command)
            else:
                step_cmd = f"kubectl describe {ctx.info.workload_kind}/{ctx.info.workload_name}{ns_arg}"

            steps.append(
                RemediationStep(
                    order=idx,
                    title=str(s_text),
                    command=step_cmd,
                    is_destructive=False,
                )
            )

        return RemediationPlan(
            plan_id=ctx.plan_id,
            target_workload=ctx.info.workload_name,
            summary=str(title),
            risk_level=normalize_risk_level(risk),
            steps=steps,
            rollback_command=generate_rollback_command(ctx.info),
        )
