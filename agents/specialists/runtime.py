"""
Runtime Log Specialist Agent — KDM v4.0.0
==========================================
Domain-specialized SRE agent diagnosing container process lifecycles,
signals, termination exit codes, and stderr/stdout logs.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List, Optional

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import CollectionStatus, EvidenceBundle
    from agents.specialists.base import BaseSpecialistAgent
except ImportError:
    from core.evidence import CollectionStatus, EvidenceBundle  # type: ignore[no-redef]
    from specialists.base import BaseSpecialistAgent  # type: ignore[no-redef]


class RuntimeLogAgent(BaseSpecialistAgent):
    """Diagnoses container execution failures, signals, exit codes, and application logs."""

    role: str = "runtime"
    display_name: str = "Runtime & Log Agent"
    icon: str = "🔍"

    ROLE: str = "runtime"
    NAME: str = "Runtime & Log Agent"
    ICON: str = "🔍"

    def get_system_prompt(self) -> str:
        """Establish the persona, boundaries, and JSON output schema for the runtime specialist."""
        return (
            "You are a Senior Linux & Container Runtime Diagnostics Specialist.\n"
            "Your expertise is in container process execution, Linux signals (SIGKILL 9, SIGTERM 15, SIGSEGV 11), "
            "exit codes (137 OOMKilled, 1 Application Error, 126 Permission/Exec Format, 143 SIGTERM), "
            "panic stack traces, and stderr logs.\n\n"
            "Diagnostic Guidelines:\n"
            "1. Focus strictly on process termination, exit codes, crash signals, and container logs.\n"
            "2. If previous container logs are empty or unavailable, explicitly note that no previous crash log was "
            "persisted rather than hallucinating an application error.\n"
            "3. If no runtime crash, non-zero exit code, or fatal signal is detected, report healthy with confidence 'low' "
            "and empty hypotheses.\n"
            "4. Return ONLY a valid JSON object adhering strictly to the schema:\n"
            "{\n"
            '  "summary": "<Concise diagnosis sentence naming the exact component or trigger>",\n'
            '  "evidence": ["<Technical fact 1>", "<Technical fact 2>"],\n'
            '  "hypotheses": ["<Potential root cause 1>"],\n'
            '  "confidence": "high" | "medium" | "low"\n'
            "}\n"
            "Do NOT wrap in markdown fences or include explanatory text outside the JSON."
        )

    def build_prompt(self, bundle: EvidenceBundle) -> str:
        """Assemble domain-specific runtime evidence for the model prompt."""
        target_info = self._extract_target(bundle)
        status_info = self._extract_container_status(bundle)
        log_info = self._extract_logs(bundle)
        events_info = self._extract_runtime_events(bundle)

        return (
            f"=== TARGET WORKLOAD ===\n{target_info}\n\n"
            f"=== CONTAINER STATUS & EXIT CODES ===\n{status_info}\n\n"
            f"=== LOG EVIDENCE ===\n{log_info}\n\n"
            f"=== RUNTIME WARNING EVENTS ===\n{events_info}\n\n"
            "Analyze the above evidence strictly within your runtime domain. Output valid JSON adhering to the SpecialistReport schema."
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

    def _extract_container_status(self, bundle: EvidenceBundle) -> str:
        """Extract exit codes, termination reasons, and restart counts from container status."""
        item = bundle.get("ev.pod.container.status")
        if item is None or item.status != CollectionStatus.AVAILABLE or not item.data:
            return "Container status evidence unavailable."

        status_data = item.data
        target_name = bundle.target.container_name if bundle.target else None
        target_status = self._find_target_container_status(status_data, target_name)
        if not target_status:
            return json.dumps(status_data, indent=2)

        return self._format_status_entry(target_status)

    @classmethod
    def _find_target_container_status(
        cls, status_data: Any, target_name: Optional[str]
    ) -> Optional[Dict[str, Any]]:
        """Locate the target container dictionary if multiple container statuses exist."""
        if isinstance(status_data, dict):
            return cls._match_dict_status(status_data, target_name)
        if isinstance(status_data, list):
            return cls._match_list_status(status_data, target_name)
        return None

    @staticmethod
    def _match_dict_status(
        status_dict: Dict[str, Any], target_name: Optional[str]
    ) -> Dict[str, Any]:
        """Match container name in containerStatuses list or return entire status dict."""
        statuses = status_dict.get("containerStatuses")
        if isinstance(statuses, list) and target_name:
            for c in statuses:
                if isinstance(c, dict) and c.get("name") == target_name:
                    return c
        return status_dict

    @staticmethod
    def _match_list_status(
        status_list: List[Any], target_name: Optional[str]
    ) -> Optional[Dict[str, Any]]:
        """Find matching container in a list of container status objects."""
        for c in status_list:
            if isinstance(c, dict) and (
                not target_name or c.get("name") == target_name
            ):
                return c
        return None

    @classmethod
    def _format_status_entry(cls, status: Dict[str, Any]) -> str:
        """Format container status dictionary into clear summary lines."""
        lines = []
        if "name" in status:
            lines.append(f"Container: {status['name']}")
        lines.append(f"Restart Count: {status.get('restartCount', 0)}")

        last_term = status.get("lastState", {}).get("terminated")
        if last_term:
            lines.append(cls._format_terminated_state(last_term, "Last State"))

        state_line = cls._format_state(status.get("state", {}))
        if state_line:
            lines.append(state_line)

        return "\n".join(lines) if lines else json.dumps(status, indent=2)

    @staticmethod
    def _format_terminated_state(
        terminated: Dict[str, Any], prefix: str = "State"
    ) -> str:
        """Format terminated container state fields."""
        code = terminated.get("exitCode")
        reason = terminated.get("reason")
        msg = terminated.get("message", "none")
        return (
            f"{prefix}: Terminated (exitCode: {code}, reason: {reason}, message: {msg})"
        )

    @classmethod
    def _format_state(cls, state: Dict[str, Any]) -> Optional[str]:
        """Format waiting, terminated, or running current container state."""
        if "waiting" in state:
            waiting = state["waiting"]
            return f"Current State: Waiting (reason: {waiting.get('reason')}, message: {waiting.get('message', 'none')})"
        if "terminated" in state:
            return cls._format_terminated_state(state["terminated"], "Current State")
        if "running" in state:
            return "Current State: Running"
        return None

    @classmethod
    def _extract_logs(cls, bundle: EvidenceBundle) -> str:
        """Extract previous and current logs, noting missing logs explicitly."""
        sections = [cls._get_previous_logs(bundle)]
        curr = cls._get_current_logs(bundle)
        if curr:
            sections.append(curr)
        return "\n\n".join(sections)

    @staticmethod
    def _get_previous_logs(bundle: EvidenceBundle) -> str:
        """Fetch previous crash logs or return explicit note if missing."""
        prev_item = bundle.get("ev.pod.logs.previous") or bundle.get("ev.logs.previous")
        if (
            prev_item
            and prev_item.status == CollectionStatus.AVAILABLE
            and prev_item.data
        ):
            content = str(prev_item.data).strip()
            return f"Previous Crash Logs:\n{content[:2000]}"
        return "Previous Crash Logs: No previous crash log was persisted (empty or unavailable)."

    @staticmethod
    def _get_current_logs(bundle: EvidenceBundle) -> Optional[str]:
        """Fetch current container logs snippet if available."""
        curr_item = (
            bundle.get("ev.pod.logs.current")
            or bundle.get("ev.pod.logs")
            or bundle.get("ev.logs")
        )
        if (
            curr_item
            and curr_item.status == CollectionStatus.AVAILABLE
            and curr_item.data
        ):
            content = str(curr_item.data).strip()
            return f"Current Logs:\n{content[:2000]}"
        return None

    @classmethod
    def _extract_runtime_events(cls, bundle: EvidenceBundle) -> str:
        """Extract runtime lifecycle warning events."""
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
        matched = [cls._format_event(ev) for ev in events if cls._is_runtime_event(ev)]
        return (
            "\n".join(matched[:10])
            if matched
            else "No runtime warning events detected."
        )

    @staticmethod
    def _is_runtime_event(ev: Any) -> bool:
        """Check if event belongs to container runtime lifecycle."""
        if not isinstance(ev, dict):
            return False
        keywords = (
            "backoff",
            "killing",
            "failed",
            "unhealthy",
            "crashloop",
            "error",
            "oom",
        )
        reason = str(ev.get("reason", "")).lower()
        msg = str(ev.get("message", "")).lower()
        return any(kw in reason or kw in msg for kw in keywords)

    @staticmethod
    def _format_event(ev: Dict[str, Any]) -> str:
        """Format an individual event dictionary."""
        return f"- [{ev.get('reason', 'Warning')}] {ev.get('message', '')}"
