"""
Cluster Resource Specialist Agent — KDM v4.0.0
================================================
Domain-specialized SRE agent diagnosing node resource pressure,
cgroups memory limits, CPU throttling, and Pod QoS classes.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import CollectionStatus, EvidenceBundle
    from agents.specialists.base import BaseSpecialistAgent
except ImportError:
    from core.evidence import CollectionStatus, EvidenceBundle  # type: ignore[no-redef]
    from specialists.base import BaseSpecialistAgent  # type: ignore[no-redef]


class ClusterResourceAgent(BaseSpecialistAgent):
    """Diagnoses cluster capacity constraints, node pressure, cgroups limits, and QoS classes."""

    role: str = "resource"
    display_name: str = "Cluster & Resource Agent"
    icon: str = "🛡️"

    ROLE: str = "resource"
    NAME: str = "Cluster & Resource Agent"
    ICON: str = "🛡️"

    def get_system_prompt(self) -> str:
        """Establish the persona, boundaries, and JSON output schema for the resource specialist."""
        return (
            "You are a Cluster Capacity & Linux Cgroups Specialist.\n"
            "Your expertise is in Kubernetes node resource pressure (MemoryPressure, DiskPressure, PIDPressure), "
            "Pod Quality of Service (QoS) classes (Guaranteed, Burstable, BestEffort), cgroup memory limits, "
            "CPU throttling, and cluster capacity scheduling constraints.\n\n"
            "Diagnostic Guidelines:\n"
            "1. Focus strictly on node capacity, pressure conditions, pod requests vs limits, cgroups, and QoS classes.\n"
            "2. Inspect node pressure flags (MemoryPressure=True, DiskPressure=True) and pod eviction / OOM events.\n"
            "3. If no resource exhaustion, node pressure, or capacity limits are breached, report healthy with confidence 'low' "
            "and empty hypotheses.\n"
            "4. Return ONLY a valid JSON object adhering strictly to the schema:\n"
            "{\n"
            '  "summary": "<Concise diagnosis sentence naming the exact resource bottleneck or healthy summary>",\n'
            '  "evidence": ["<Technical fact 1>", "<Technical fact 2>"],\n'
            '  "hypotheses": ["<Potential root cause 1>"],\n'
            '  "confidence": "high" | "medium" | "low"\n'
            "}\n"
            "Do NOT wrap in markdown fences or include explanatory text outside the JSON."
        )

    def build_prompt(self, bundle: EvidenceBundle) -> str:
        """Assemble domain-specific resource and capacity evidence for the model prompt."""
        target_info = self._extract_target(bundle)
        qos_info = self._extract_pod_resources_and_qos(bundle)
        node_info = self._extract_node_conditions(bundle)
        oom_info = self._extract_oom_cgroup_status(bundle)
        events_info = self._extract_resource_events(bundle)

        return (
            f"=== TARGET WORKLOAD ===\n{target_info}\n\n"
            f"=== POD RESOURCES & QOS CLASS ===\n{qos_info}\n\n"
            f"=== NODE CONDITIONS & PRESSURE ===\n{node_info}\n\n"
            f"=== CONTAINER CGROUP / OOM STATUS ===\n{oom_info}\n\n"
            f"=== CAPACITY & SCHEDULING WARNING EVENTS ===\n{events_info}\n\n"
            "Analyze the above evidence strictly within your cluster resource domain. Output valid JSON adhering to the SpecialistReport schema."
        )

    @staticmethod
    def _extract_target(bundle: EvidenceBundle) -> str:
        """Format target identity from evidence bundle."""
        if not bundle.target:
            return "Unknown target"
        t = bundle.target
        target_str = f"Kind: {t.workload_kind}, Name: {t.workload_name}, Namespace: {t.namespace}"
        if t.container_name:
            target_str += f", Container: {t.container_name}"
        return target_str

    @classmethod
    def _extract_pod_resources_and_qos(cls, bundle: EvidenceBundle) -> str:
        """Extract resource requests, limits, and determine pod QoS class."""
        spec_item = (
            bundle.get("ev.pod.spec")
            or bundle.get("ev.pod.resources")
            or bundle.get("ev.pod.manifest")
        )
        if (
            spec_item is None
            or spec_item.status != CollectionStatus.AVAILABLE
            or not spec_item.data
        ):
            return "Pod resource specification evidence unavailable."

        containers = cls._extract_container_list(spec_item.data)
        if not containers:
            return "No container resource definitions found."

        res_lines, flags = cls._process_container_resources(containers)
        qos = cls._compute_qos_class(*flags)
        res_lines.insert(0, f"Inferred QoS Class: {qos}")
        return "\n".join(res_lines)

    @classmethod
    def _process_container_resources(
        cls, containers: List[Dict[str, Any]]
    ) -> Tuple[List[str], Tuple[bool, bool, bool]]:
        """Process all container resource blocks and return lines and QoS indicators."""
        res_lines = []
        has_requests, has_limits, all_match = True, True, True

        for c in containers:
            if not isinstance(c, dict):
                continue
            line, c_req, c_lim, c_match = cls._inspect_container_resources(c)
            res_lines.append(line)
            has_requests = has_requests and c_req
            has_limits = has_limits and c_lim
            all_match = all_match and c_match

        return res_lines, (has_requests, has_limits, all_match)

    @staticmethod
    def _inspect_container_resources(c: Dict[str, Any]) -> Tuple[str, bool, bool, bool]:
        """Inspect single container resources returning description and boolean flags."""
        name = c.get("name", "container")
        res = c.get("resources", {})
        req = res.get("requests", {})
        lim = res.get("limits", {})

        line = f"- Container '{name}': Requests={json.dumps(req)}, Limits={json.dumps(lim)}"
        has_req = bool(req)
        has_lim = bool(lim)
        match = bool(req and lim and req == lim)
        return line, has_req, has_lim, match

    @staticmethod
    def _extract_container_list(data: Any) -> List[Dict[str, Any]]:
        """Safely extract container list from spec dictionary."""
        if isinstance(data, dict):
            if "containers" in data:
                return data["containers"]
            return data.get("spec", {}).get("containers", [])
        if isinstance(data, list):
            return data
        return []

    @staticmethod
    def _compute_qos_class(
        has_requests: bool, has_limits: bool, all_match: bool
    ) -> str:
        """Determine Kubernetes QoS class based on request/limit matching."""
        if has_requests and has_limits and all_match:
            return "Guaranteed"
        if has_requests or has_limits:
            return "Burstable"
        return "BestEffort"

    @classmethod
    def _extract_node_conditions(cls, bundle: EvidenceBundle) -> str:
        """Extract node condition flags including MemoryPressure and DiskPressure."""
        node_item = bundle.get("ev.node.conditions") or bundle.get("ev.node.status")
        if (
            node_item is None
            or node_item.status != CollectionStatus.AVAILABLE
            or not node_item.data
        ):
            return "Node conditions evidence unavailable."

        data = node_item.data
        conditions = data.get("conditions", data) if isinstance(data, dict) else data
        if not isinstance(conditions, list):
            return "Unrecognized node conditions format."

        lines = [
            line for cond in conditions if (line := cls._format_node_condition(cond))
        ]
        return (
            "\n".join(lines)
            if lines
            else "No standard node pressure conditions recorded."
        )

    @staticmethod
    def _format_node_condition(cond: Any) -> Optional[str]:
        """Format an individual node condition if relevant to pressure."""
        if not isinstance(cond, dict):
            return None
        c_type = cond.get("type", "")
        c_status = cond.get("status", "")
        if c_type in ("MemoryPressure", "DiskPressure", "PIDPressure", "Ready"):
            return f"- Node Condition: {c_type}={c_status} (Reason: {cond.get('reason', 'none')})"
        return None

    @classmethod
    def _extract_oom_cgroup_status(cls, bundle: EvidenceBundle) -> str:
        """Extract cgroup OOM termination status from container status evidence."""
        status_item = bundle.get("ev.pod.container.status")
        if (
            status_item is None
            or status_item.status != CollectionStatus.AVAILABLE
            or not status_item.data
        ):
            return "Container cgroup status unavailable."

        data = status_item.data
        statuses = (
            data.get("containerStatuses", [data]) if isinstance(data, dict) else data
        )
        if not isinstance(statuses, list):
            statuses = [statuses]

        lines = [line for s in statuses if (line := cls._find_cgroup_oom(s))]
        return (
            "\n".join(lines)
            if lines
            else "No cgroup OOMKilled events in container status."
        )

    @classmethod
    def _find_cgroup_oom(cls, s: Any) -> Optional[str]:
        """Detect cgroup OOM termination in container state."""
        if not isinstance(s, dict):
            return None
        last = s.get("lastState", {}).get("terminated", {})
        curr = s.get("state", {}).get("terminated", {})
        for term in (last, curr):
            if cls._is_oom_terminated(term):
                name = s.get("name", "main")
                return f"- Container '{name}' terminated by cgroup OOM: exitCode={term.get('exitCode')}, reason={term.get('reason')}"
        return None

    @staticmethod
    def _is_oom_terminated(term: Dict[str, Any]) -> bool:
        """Check if terminated dict indicates OOMKilled reason or exit code 137."""
        return term.get("reason") == "OOMKilled" or term.get("exitCode") == 137

    @classmethod
    def _extract_resource_events(cls, bundle: EvidenceBundle) -> str:
        """Extract events relating to scheduling capacity, evictions, and resource limits."""
        events_item = bundle.get("ev.pod.events")
        if (
            events_item is None
            or events_item.status != CollectionStatus.AVAILABLE
            or not events_item.data
        ):
            return "No event evidence recorded."

        events = (
            events_item.data
            if isinstance(events_item.data, list)
            else [events_item.data]
        )
        matched = [cls._format_event(ev) for ev in events if cls._is_resource_event(ev)]

        return (
            "\n".join(matched[:10])
            if matched
            else "No capacity or resource warning events detected."
        )

    @staticmethod
    def _is_resource_event(ev: Any) -> bool:
        """Check if event relates to capacity, pressure, or limits."""
        if not isinstance(ev, dict):
            return False
        keywords = (
            "failedscheduling",
            "insufficient cpu",
            "insufficient memory",
            "evicted",
            "oomkilled",
            "pressure",
        )
        reason = str(ev.get("reason", "")).lower()
        msg = str(ev.get("message", "")).lower()
        return any(kw in reason or kw in msg for kw in keywords)

    @staticmethod
    def _format_event(ev: Dict[str, Any]) -> str:
        """Format an individual event."""
        return f"- [{ev.get('reason', 'Warning')}] {ev.get('message', '')}"
