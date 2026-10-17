"""
Multi-Agent Collaborative Analysis Council — KDM v4.0.0
=========================================================
Coordinates domain specialist agents (RuntimeLogAgent, ConfigDependencyAgent,
ClusterResourceAgent) and SynthesizerAgent using the Ollama Python SDK to
diagnose Kubernetes and Docker workload failures.

Emits NDJSON progress and completion events for live consumption by the CLI
and interactive TUI dashboards.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any, Dict, List, Optional, Union

try:
    import yaml
except ImportError:
    yaml = None


_AGENTS_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_AGENTS_DIR, ".."))
for _p in (_REPO_ROOT, _AGENTS_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import ollama  # noqa: E402

try:
    from agents.core.evidence import EvidenceBundle
    from agents.rules.engine import RuleEngine
    from agents.specialists import (
        ClusterResourceAgent,
        ConfigDependencyAgent,
        RuntimeLogAgent,
        SynthesizerAgent,
    )
    from agents.synthesis.consensus import ConsensusDiagnosis
except ImportError:
    from core.evidence import EvidenceBundle  # type: ignore[no-redef]
    from rules.engine import RuleEngine  # type: ignore[no-redef]
    from specialists import (  # type: ignore[no-redef]
        ClusterResourceAgent,
        ConfigDependencyAgent,
        RuntimeLogAgent,
        SynthesizerAgent,
    )
    from synthesis.consensus import ConsensusDiagnosis  # type: ignore[no-redef]

logger = logging.getLogger(__name__)


CONFIG_FILE_NAME = "agents.yaml"
DEFAULT_FALLBACK_MODEL = "llama3.1"


def emit_event(event_type: str, data: Dict[str, Any]) -> None:
    """Emits a single JSON event to stdout, followed by an immediate flush."""
    payload = {"type": event_type, **data}
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _extract_models_map(config: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Normalizes models dictionary from configuration, supporting nested or flat formats."""
    if not isinstance(config, dict):
        return {}
    models_entry = config.get("models")
    target = models_entry if isinstance(models_entry, dict) else config
    return {
        str(k).strip().lower(): str(v).strip()
        for k, v in target.items()
        if v is not None and str(v).strip()
    }


def load_agents_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """Loads agent configuration from YAML file if present.

    If an explicit config_path is provided, loads exclusively from that path.
    Otherwise, searches candidate paths in the following priority:
      1. Environment variable KDM_AGENTS_CONFIG.
      2. Current working directory ./config/agents.yaml.
      3. Repository root ./config/agents.yaml.

    Returns an empty dictionary if the file is absent, unparseable, or invalid.
    """
    if config_path:
        candidates = [config_path]
    else:
        candidates = []
        env_path = os.environ.get("KDM_AGENTS_CONFIG")
        if env_path:
            candidates.append(env_path)
        candidates.append(os.path.join(os.getcwd(), "config", CONFIG_FILE_NAME))
        candidates.append(os.path.join(_REPO_ROOT, "config", CONFIG_FILE_NAME))

    for path in candidates:
        if path and os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    if yaml is not None:
                        loaded = yaml.safe_load(f)
                    else:
                        loaded = None
                    if isinstance(loaded, dict):
                        return loaded
            except Exception as err:
                logger.warning("Failed to load agent configuration from %s: %s", path, err)
    return {}


def _match_requested_model(candidate_models: List[str], requested_model: str) -> Optional[str]:
    """Finds an exact or base name match for the requested model among candidate models."""
    if requested_model in candidate_models:
        return requested_model

    return _find_model_by_base(candidate_models, requested_model.split(":")[0])


def _find_model_by_base(candidate_models: List[str], model_base: str) -> Optional[str]:
    """Finds the first candidate whose untagged model name matches the requested base."""
    return next((model for model in candidate_models if model.split(":")[0] == model_base), None)


def resolve_installed_model(client: Any, requested_model: str) -> str:
    """Resolves an installed local Ollama model, falling back to an available chat model if needed."""
    try:
        res = client.list()
        models = []
        if hasattr(res, "models"):
            models = [getattr(m, "model", None) or getattr(m, "name", None) for m in res.models]
        elif isinstance(res, dict) and "models" in res:
            models = [m.get("model") or m.get("name") for m in res["models"] if isinstance(m, dict)]

        models = [m for m in models if isinstance(m, str) and m]
        # Filter out embedding models (e.g. nomic-embed-text)
        chat_models = [m for m in models if "embed" not in m.lower()]
        candidate_models = chat_models if chat_models else models

        matched = _match_requested_model(candidate_models, requested_model)
        if matched:
            return matched

        # If requested model not installed, pick the first available chat model
        if candidate_models:
            return candidate_models[0]
    except Exception:
        pass
    return requested_model or "gemma:2b"


def resolve_model(
    role: Any = "default",
    config: Optional[Union[Dict[str, Any], str]] = None,
    cli_override: Optional[str] = None,
    client: Optional[ollama.Client] = None,
) -> str:
    """Dynamically determine which model to instantiate for an agent role.

    Resolution Priority:
      1. Global CLI override (`cli_override`).
      2. Per-role model mapping in `config` (`models.<role>`).
      3. Default model specification in `config` (`models.default`).
      4. Fallback default model ("llama3.1").

    Backward compatibility:
      If called with `resolve_model(client, requested_model)`, delegates to
      `resolve_installed_model(client, requested_model)`.
    """
    # Legacy invocation support: resolve_model(client, requested_model)
    if not isinstance(role, str) and (hasattr(role, "list") or (client is None and isinstance(config, str))):
        return resolve_installed_model(role, str(config) if config else DEFAULT_FALLBACK_MODEL)

    # Priority 1: CLI override takes precedence over all configurations
    if cli_override is not None and str(cli_override).strip():
        resolved_name = str(cli_override).strip()
    else:
        # Load configuration if not explicitly provided
        effective_config = config if isinstance(config, dict) else load_agents_config()
        models_map = _extract_models_map(effective_config)
        role_key = str(role).strip().lower()

        # Priority 2: Role-specific mapping
        if role_key in models_map and models_map[role_key]:
            resolved_name = str(models_map[role_key]).strip()
        # Priority 3: Configuration default
        elif "default" in models_map and models_map["default"]:
            resolved_name = str(models_map["default"]).strip()
        # Priority 4: Hardcoded fallback
        else:
            resolved_name = DEFAULT_FALLBACK_MODEL

    if client is not None:
        return resolve_installed_model(client, resolved_name)
    return resolved_name


class AgentCouncil:
    """Multi-agent SRE diagnostic council coordinating domain specialists and synthesis.

    Evaluates incidents using a two-stage approach:
      1. Deterministic RuleEngine fast-path (< 5ms) for conclusive signatures.
      2. Multi-agent collaborative deliberation across Runtime, Config, and Resource
         specialists followed by Lead SRE synthesis.
    """

    def __init__(
        self,
        client: Optional[ollama.Client] = None,
        model: Optional[str] = None,
        base_url: str = "http://localhost:11434",
        rule_engine: Optional[RuleEngine] = None,
        config: Optional[Dict[str, Any]] = None,
        config_path: Optional[str] = None,
    ) -> None:
        """Initialize AgentCouncil with client, model, and optional rule engine.

        :param client: Optional pre-configured or mocked ollama.Client.
        :param model: Optional target LLM model name override (CLI --model).
        :param base_url: Ollama daemon host URL (default: 'http://localhost:11434').
        :param rule_engine: Optional RuleEngine for deterministic fast-path evaluation.
        :param config: Optional pre-parsed agent configuration dictionary.
        :param config_path: Optional custom path to agents.yaml configuration file.
        """
        self.base_url = base_url
        self.model = model
        self.client = client if client is not None else ollama.Client(host=base_url)
        self.rule_engine = rule_engine if rule_engine is not None else RuleEngine()
        self.config = config if config is not None else load_agents_config(config_path)

    def resolve_model(self, role: str = "default") -> str:
        """Resolve installed or compatible Ollama model for the specified role."""
        return resolve_model(
            role=role,
            config=self.config,
            cli_override=self.model,
            client=self.client,
        )


    def diagnose(
        self,
        bundle: EvidenceBundle,
        emit_events: bool = False,
    ) -> ConsensusDiagnosis:
        """Diagnose an EvidenceBundle through deterministic rules and multi-agent synthesis.

        First evaluates the bundle with RuleEngine in < 5ms. If a rule matches with
        confidence >= 0.99, bypasses the LLM and constructs a ConsensusDiagnosis directly.
        Otherwise, runs domain specialist agents and synthesizer to produce the final diagnosis.

        :param bundle: The Canonical EvidenceBundle to analyze.
        :param emit_events: Whether to emit NDJSON streaming events to stdout.
        :return: Standardized ConsensusDiagnosis instance.
        """
        primary_match = self.rule_engine.get_primary_match(bundle)
        if self.rule_engine.should_bypass_llm(primary_match):
            target_name = ""
            if bundle.target:
                target_name = bundle.target.workload_name or bundle.target.container_name
            diagnosis = ConsensusDiagnosis.from_rule_match(primary_match, target_name=target_name)
            if emit_events:
                emit_event("complete", {"consensus": diagnosis.to_dict()})
            return diagnosis

        failure_text = self._extract_failure_text(bundle)
        context = self._extract_context(bundle)
        return self.run(failure_text, context, emit_events=emit_events)

    def diagnose_bundle(
        self,
        bundle: EvidenceBundle,
        emit_events: bool = False,
    ) -> ConsensusDiagnosis:
        """Alias for diagnose()."""
        return self.diagnose(bundle, emit_events=emit_events)

    def evaluate(
        self,
        bundle: EvidenceBundle,
        emit_events: bool = False,
    ) -> ConsensusDiagnosis:
        """Alias for diagnose()."""
        return self.diagnose(bundle, emit_events=emit_events)

    def run(
        self,
        failure_text: str,
        context: Optional[Dict[str, Any]] = None,
        emit_events: bool = False,
    ) -> ConsensusDiagnosis:
        """Execute the multi-agent specialist pipeline and synthesize findings into a diagnosis.

        :param failure_text: Failure logs, exit codes, or error strings.
        :param context: Workload metadata dict (namespace, kind, name, etc.).
        :param emit_events: Whether to stream progress events to stdout.
        :return: ConsensusDiagnosis instance.
        """
        ctx = context or {}
        runtime_model = self.resolve_model("runtime")
        config_model = self.resolve_model("config")
        resource_model = self.resolve_model("resource")
        synthesizer_model = self.resolve_model("synthesizer")

        runtime_agent = RuntimeLogAgent(self.client, runtime_model)
        config_agent = ConfigDependencyAgent(self.client, config_model)
        resource_agent = ClusterResourceAgent(self.client, resource_model)
        synthesizer = SynthesizerAgent(self.client, synthesizer_model)

        findings: List[Dict[str, Any]] = []

        self._emit_step(emit_events, runtime_agent, "Analyzing container logs & exit codes...")
        runtime_res = runtime_agent.analyze(failure_text, ctx)
        findings.append(runtime_res)
        self._emit_agent_done(emit_events, runtime_agent.NAME, runtime_res)

        self._emit_step(emit_events, config_agent, "Checking ConfigMaps, Secrets & probe thresholds...")
        config_res = config_agent.analyze(failure_text, ctx)
        findings.append(config_res)
        self._emit_agent_done(emit_events, config_agent.NAME, config_res)

        self._emit_step(emit_events, resource_agent, "Evaluating node pressure & memory limits...")
        resource_res = resource_agent.analyze(failure_text, ctx)
        findings.append(resource_res)
        self._emit_agent_done(emit_events, resource_agent.NAME, resource_res)

        if emit_events:
            emit_event("progress", {
                "agent": synthesizer.NAME,
                "role": synthesizer.ROLE,
                "icon": synthesizer.ICON,
                "status": "running",
                "message": f"{synthesizer.NAME} is finding best solution...",
            })
        raw_consensus = synthesizer.synthesize(failure_text, findings, ctx)

        if isinstance(raw_consensus, ConsensusDiagnosis):
            diagnosis = raw_consensus
        else:
            diagnosis = ConsensusDiagnosis.from_dict(raw_consensus)

        if emit_events:
            emit_event("complete", {"consensus": diagnosis.to_dict()})
        return diagnosis

    @staticmethod
    def _emit_step(emit_events: bool, agent: Any, message: str) -> None:
        """Helper to emit agent progress event when enabled."""
        if not emit_events:
            return
        emit_event("progress", {
            "agent": agent.NAME,
            "role": agent.ROLE,
            "icon": agent.ICON,
            "status": "running",
            "message": f"{agent.NAME} is working: {message}",
        })

    @staticmethod
    def _emit_agent_done(emit_events: bool, name: str, finding: Dict[str, Any]) -> None:
        """Helper to emit agent completion event when enabled."""
        if not emit_events:
            return
        emit_event("agent_completed", {"agent": name, "finding": finding})

    @staticmethod
    def _extract_context(bundle: EvidenceBundle) -> Dict[str, Any]:
        """Extract workload context dictionary from an EvidenceBundle."""
        if not bundle or not bundle.target:
            return {"name": "workload", "namespace": "default", "kind": "Pod"}
        t = bundle.target
        ctx: Dict[str, Any] = {
            "name": t.workload_name,
            "namespace": t.namespace,
            "kind": t.workload_kind,
        }
        if t.container_name:
            ctx["container"] = t.container_name
        return ctx

    @classmethod
    def _extract_failure_text(cls, bundle: EvidenceBundle) -> str:
        """Compose a failure narrative from EvidenceBundle items."""
        sections: List[str] = []
        cls._append_status_narrative(sections, bundle.get("ev.pod.container.status"))
        cls._append_pod_status_narrative(sections, bundle.get("ev.pod.status"))
        cls._append_events_narrative(sections, bundle.get("ev.pod.events"))
        cls._append_node_conditions_narrative(sections, bundle.get("ev.node.conditions"))
        cls._append_logs_narrative(sections, bundle.get("ev.pod.logs.previous"))

        return "\n".join(sections) if sections else "Workload failure condition detected."

    @staticmethod
    def _append_status_narrative(sections: List[str], item: Optional[Any]) -> None:
        """Extract container waiting and terminated status notes."""
        if not item or not getattr(item, "data", None):
            return
        d = item.data
        if isinstance(d, dict):
            waiting = d.get("state", {}).get("waiting", {})
            if waiting and waiting.get("reason"):
                sections.append(f"Waiting: {waiting.get('reason')} - {waiting.get('message', '')}")
            term = d.get("lastState", {}).get("terminated", {})
            if term and (term.get("reason") or term.get("exitCode")):
                sections.append(f"Terminated: exitCode {term.get('exitCode')} reason {term.get('reason')} - {term.get('message', '')}")

    @staticmethod
    def _append_pod_status_narrative(sections: List[str], item: Optional[Any]) -> None:
        """Extract pod-level phase and eviction notes."""
        if not item or not getattr(item, "data", None):
            return
        d = item.data
        if isinstance(d, dict):
            phase = d.get("phase", "")
            reason = d.get("reason", "")
            msg = d.get("message", "")
            if reason or phase:
                sections.append(f"Pod Status: {phase} {reason} - {msg}".strip())

    @staticmethod
    def _append_events_narrative(sections: List[str], item: Optional[Any]) -> None:
        """Extract warning events from events list."""
        if not item or not getattr(item, "data", None):
            return
        evs = item.data if isinstance(item.data, list) else [item.data]
        for e in evs:
            if isinstance(e, dict) and e.get("message"):
                sections.append(f"Event: {e.get('reason', 'Warning')} - {e.get('message')}")

    @staticmethod
    def _append_node_conditions_narrative(sections: List[str], item: Optional[Any]) -> None:
        """Extract active node condition alerts."""
        if not item or not getattr(item, "data", None):
            return
        conds = item.data if isinstance(item.data, list) else []
        for c in conds:
            if isinstance(c, dict) and str(c.get("status", "")).lower() == "true":
                sections.append(f"Node condition {c.get('type')} is True: {c.get('message', '')}")

    @staticmethod
    def _append_logs_narrative(sections: List[str], item: Optional[Any]) -> None:
        """Extract previous crash logs snippet."""
        if not item or not getattr(item, "data", None):
            return
        logs_str = str(item.data).strip()
        if logs_str:
            sections.append(f"Logs:\n{logs_str[:1000]}")


def run_council(
    failure_text: str,
    context: Dict[str, Any],
    model: Optional[str] = None,
    base_url: str = "http://localhost:11434",
    client: Optional[ollama.Client] = None,
    config: Optional[Dict[str, Any]] = None,
    config_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Runs the full multi-agent collaborative investigation pipeline."""
    council = AgentCouncil(
        client=client,
        model=model,
        base_url=base_url,
        config=config,
        config_path=config_path,
    )
    diag = council.run(failure_text, context, emit_events=True)
    return diag.to_dict() if hasattr(diag, "to_dict") else diag


def main() -> None:
    """Reads input JSON from stdin and runs the council."""
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            raw_input = sys.argv[1].strip()
        elif not sys.stdin.isatty():
            raw_input = sys.stdin.read().strip()
        else:
            raw_input = ""
        if not raw_input:
            input_data = {}
        else:
            input_data = json.loads(raw_input)

        failure_text = input_data.get("failureText", "General workload error")
        context = input_data.get("context", {})
        model = input_data.get("model") or input_data.get("cli_override")
        base_url = input_data.get("baseUrl", "http://localhost:11434")

        run_council(failure_text, context, model=model, base_url=base_url)
    except Exception as err:
        emit_event("error", {"message": str(err)})
        sys.exit(1)


if __name__ == "__main__":
    main()
