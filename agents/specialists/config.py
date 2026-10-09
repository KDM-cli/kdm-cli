"""
Config Dependency Specialist Agent — KDM v4.0.0
================================================
Domain-specialized SRE agent diagnosing declarative configuration issues,
missing ConfigMaps/Secrets, volume mount failures, and probe threshold timeouts.
"""

from __future__ import annotations

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


class ConfigDependencyAgent(BaseSpecialistAgent):
    """Diagnoses declarative manifest errors, missing ConfigMaps/Secrets, and probe timeouts."""

    role: str = "config"
    display_name: str = "Config & Dependency Agent"
    icon: str = "⚙️"

    ROLE: str = "config"
    NAME: str = "Config & Dependency Agent"
    ICON: str = "⚙️"

    def get_system_prompt(self) -> str:
        """Establish the persona, boundaries, and JSON output schema for the config specialist."""
        return (
            "You are a Kubernetes Declarative Configuration Specialist.\n"
            "Your expertise is in Kubernetes manifests, pod specifications, volume mounts, ConfigMap and Secret references, "
            "environment variable bindings, service discovery / DNS resolution, and probe configurations (liveness, readiness, startup) "
            "and timeouts.\n\n"
            "Diagnostic Guidelines:\n"
            "1. Focus strictly on declarative configurations, missing ConfigMaps/Secrets, failed mounts, and probe configurations.\n"
            "2. Inspect probe thresholds (initialDelaySeconds, timeoutSeconds, periodSeconds, failureThreshold) for timeout mismatches.\n"
            "3. If no configuration errors, missing dependencies, or probe failures are detected, report healthy with confidence 'low' "
            "and empty hypotheses.\n"
            "4. Return ONLY a valid JSON object adhering strictly to the schema:\n"
            "{\n"
            '  "summary": "<Concise diagnosis sentence naming the exact misconfiguration or healthy summary>",\n'
            '  "evidence": ["<Technical fact 1>", "<Technical fact 2>"],\n'
            '  "hypotheses": ["<Potential root cause 1>"],\n'
            '  "confidence": "high" | "medium" | "low"\n'
            "}\n"
            "Do NOT wrap in markdown fences or include explanatory text outside the JSON."
        )

    def build_prompt(self, bundle: EvidenceBundle) -> str:
        """Assemble domain-specific config and dependency evidence for the model prompt."""
        target_info = self._extract_target(bundle)
        waiting_info = self._extract_waiting_reason(bundle)
        probe_info = self._extract_probe_configs(bundle)
        volume_info = self._extract_volume_and_env_configs(bundle)
        events_info = self._extract_config_events(bundle)

        return (
            f"=== TARGET WORKLOAD ===\n{target_info}\n\n"
            f"=== CONTAINER WAITING STATE ===\n{waiting_info}\n\n"
            f"=== PROBE CONFIGURATIONS ===\n{probe_info}\n\n"
            f"=== VOLUME & ENVIRONMENT CONFIGURATIONS ===\n{volume_info}\n\n"
            f"=== CONFIG & PROBE WARNING EVENTS ===\n{events_info}\n\n"
            "Analyze the above evidence strictly within your declarative configuration domain. Output valid JSON adhering to the SpecialistReport schema."
        )

    @staticmethod
    def _has_valid_evidence(item: Optional[Any]) -> bool:
        """Check if an evidence item exists and was successfully collected."""
        if item is None:
            return False
        if item.status != CollectionStatus.AVAILABLE:
            return False
        return bool(item.data)

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
    def _extract_waiting_reason(cls, bundle: EvidenceBundle) -> str:
        """Extract config-related container waiting states such as CreateContainerConfigError."""
        item = bundle.get("ev.pod.container.status")
        if not cls._has_valid_evidence(item):
            return "Container status evidence unavailable."

        status_data = item.data  # type: ignore[union-attr]
        statuses = cls._extract_container_statuses(status_data)
        for s in statuses:
            matched = cls._match_config_waiting(s)
            if matched:
                return matched

        return "No configuration-related waiting state detected."

    @staticmethod
    def _extract_container_statuses(status_data: Any) -> List[Dict[str, Any]]:
        """Normalize containerStatuses from dict or list."""
        if isinstance(status_data, dict):
            return status_data.get("containerStatuses", [status_data])
        if isinstance(status_data, list):
            return status_data
        return []

    @staticmethod
    def _match_config_waiting(s: Dict[str, Any]) -> Optional[str]:
        """Check if individual container is waiting due to configuration errors."""
        if not isinstance(s, dict):
            return None
        waiting = s.get("state", {}).get("waiting", {})
        reason = waiting.get("reason", "")
        if reason in (
            "CreateContainerConfigError",
            "CreateContainerError",
            "InvalidImageName",
        ):
            name = s.get("name", "main")
            return f"Container '{name}' is waiting: {reason} - {waiting.get('message', '')}"
        return None

    @classmethod
    def _extract_probe_configs(cls, bundle: EvidenceBundle) -> str:
        """Extract probe configurations from pod specification evidence."""
        spec_item = bundle.get("ev.pod.spec")
        if spec_item is None:
            spec_item = bundle.get("ev.pod.manifest")
        if spec_item is None:
            spec_item = bundle.get("ev.manifest")

        if not cls._has_valid_evidence(spec_item):
            return "Pod specification evidence unavailable."

        containers = cls._extract_containers_from_spec(spec_item.data)  # type: ignore[union-attr]
        probe_lines = []
        for c in containers:
            probe_lines.extend(cls._format_container_probes(c))

        return (
            "\n".join(probe_lines)
            if probe_lines
            else "No probe configurations declared."
        )

    @staticmethod
    def _extract_containers_from_spec(spec_data: Any) -> List[Dict[str, Any]]:
        """Extract container list from pod spec data."""
        if not isinstance(spec_data, dict):
            return []
        if "containers" in spec_data:
            return spec_data["containers"]
        return spec_data.get("spec", {}).get("containers", [])

    @classmethod
    def _extract_all_containers_from_spec(
        cls, pod_spec: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Extract regular and init containers from spec."""
        containers = cls._extract_containers_from_spec(pod_spec)
        init_c = pod_spec.get("initContainers", [])
        if isinstance(init_c, list):
            return containers + [c for c in init_c if isinstance(c, dict)]
        return containers

    @classmethod
    def _format_container_probes(cls, container: Any) -> List[str]:
        """Format liveness, readiness, and startup probes for a container."""
        if not isinstance(container, dict):
            return []
        name = container.get("name", "container")
        probe_types = ("livenessProbe", "readinessProbe", "startupProbe")
        lines = []
        for p_type in probe_types:
            line = cls._extract_probe_line(name, container, p_type)
            if line:
                lines.append(line)
        return lines

    @classmethod
    def _extract_probe_line(
        cls, container_name: str, container: Dict[str, Any], probe_type: str
    ) -> Optional[str]:
        """Extract formatted line for a probe if present in container."""
        probe = container.get(probe_type)
        if isinstance(probe, dict):
            return cls._format_single_probe(container_name, probe_type, probe)
        return None

    @staticmethod
    def _format_single_probe(
        container_name: str, probe_type: str, probe: Dict[str, Any]
    ) -> str:
        """Format probe timeout, period, and threshold parameters."""
        t_sec = probe.get("timeoutSeconds", 1)
        p_sec = probe.get("periodSeconds", 10)
        f_thresh = probe.get("failureThreshold", 3)
        return f"- {container_name}.{probe_type}: timeoutSeconds={t_sec}, periodSeconds={p_sec}, failureThreshold={f_thresh}"

    @classmethod
    def _extract_volume_and_env_configs(cls, bundle: EvidenceBundle) -> str:
        """Extract volume mounts, configMap references, and secret references from spec and env."""
        spec_item = bundle.get("ev.pod.spec")
        if spec_item is None:
            spec_item = bundle.get("ev.pod.manifest")
        if spec_item is None:
            spec_item = bundle.get("ev.manifest")

        if not cls._has_valid_evidence(spec_item):
            return "Volume & env config evidence unavailable."

        data = spec_item.data  # type: ignore[union-attr]
        if not isinstance(data, dict):
            return "Non-dict spec data."

        pod_spec = data.get("spec", data)
        volumes = pod_spec.get("volumes", [])
        lines = [line for v in volumes if (line := cls._format_volume_entry(v))]

        containers = cls._extract_all_containers_from_spec(pod_spec)
        for c in containers:
            lines.extend(cls._format_container_env_refs(c))

        if not lines:
            return "No ConfigMap or Secret volumes/environment references declared."
        return "\n".join(lines)

    @staticmethod
    def _format_volume_entry(v: Any) -> Optional[str]:
        """Format a volume dictionary into human-readable summary if ConfigMap or Secret."""
        if not isinstance(v, dict):
            return None
        v_name = v.get("name", "volume")
        cm = v.get("configMap")
        if isinstance(cm, dict):
            return f"- Volume '{v_name}': ConfigMap '{cm.get('name')}'"
        sec = v.get("secret")
        if isinstance(sec, dict):
            return f"- Volume '{v_name}': Secret '{sec.get('secretName')}'"
        return None

    @classmethod
    def _format_container_env_refs(cls, container: Dict[str, Any]) -> List[str]:
        """Extract envFrom and valueFrom ConfigMap/Secret references from a container."""
        name = container.get("name", "container")
        env_from_lines = [
            line
            for ef in container.get("envFrom", [])
            if (line := cls._format_env_from_entry(name, ef))
        ]
        env_var_lines = [
            line
            for ev in container.get("env", [])
            if (line := cls._format_env_var_entry(name, ev))
        ]
        return env_from_lines + env_var_lines

    @staticmethod
    def _format_env_from_entry(container_name: str, item: Any) -> Optional[str]:
        """Format ConfigMap or Secret reference from envFrom entry."""
        if not isinstance(item, dict):
            return None
        cm_ref = item.get("configMapRef")
        if isinstance(cm_ref, dict):
            return f"- Container '{container_name}' envFrom: ConfigMap '{cm_ref.get('name')}'"
        sec_ref = item.get("secretRef")
        if isinstance(sec_ref, dict):
            return f"- Container '{container_name}' envFrom: Secret '{sec_ref.get('name')}'"
        return None

    @staticmethod
    def _format_env_var_entry(container_name: str, item: Any) -> Optional[str]:
        """Format ConfigMapKeyRef or SecretKeyRef from container env variable."""
        if not isinstance(item, dict):
            return None
        vf = item.get("valueFrom")
        if not isinstance(vf, dict):
            return None
        var_name = item.get("name", "env")
        cm_ref = vf.get("configMapKeyRef")
        if isinstance(cm_ref, dict):
            return f"- Container '{container_name}' env '{var_name}': ConfigMap '{cm_ref.get('name')}' key '{cm_ref.get('key')}'"
        sec_ref = vf.get("secretKeyRef")
        if isinstance(sec_ref, dict):
            return f"- Container '{container_name}' env '{var_name}': Secret '{sec_ref.get('name')}' key '{sec_ref.get('key')}'"
        return None

    @classmethod
    def _extract_config_events(cls, bundle: EvidenceBundle) -> str:
        """Extract events relating to probe failures, failed mounts, and missing secrets/configmaps."""
        events_item = bundle.get("ev.pod.events")
        if not cls._has_valid_evidence(events_item):
            return "No event evidence recorded."

        data = events_item.data  # type: ignore[union-attr]
        events = data if isinstance(data, list) else [data]
        matched = [cls._format_event(ev) for ev in events if cls._is_config_event(ev)]

        return (
            "\n".join(matched[:10])
            if matched
            else "No configuration or probe warning events detected."
        )

    @staticmethod
    def _is_config_event(ev: Any) -> bool:
        """Check if an event relates to config, mounts, secrets, or probes."""
        if not isinstance(ev, dict):
            return False
        keywords = (
            "failedmount",
            "mountvolume",
            "configmap",
            "secret",
            "probe failed",
            "unhealthy",
            "timeout",
        )
        text = f"{ev.get('reason', '')} {ev.get('message', '')}".lower()
        return any(kw in text for kw in keywords)

    @staticmethod
    def _format_event(ev: Dict[str, Any]) -> str:
        """Format an event entry into a bullet item."""
        return f"- [{ev.get('reason', 'Warning')}] {ev.get('message', '')}"
