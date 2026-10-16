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
from typing import Any, Dict, List, Optional

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


def emit_event(event_type: str, data: Dict[str, Any]) -> None:
    """Emits a single JSON event to stdout, followed by an immediate flush."""
    payload = {"type": event_type, **data}
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _match_requested_model(candidate_models: List[str], requested_model: str) -> Optional[str]:
    """Finds an exact or base name match for the requested model among candidate models."""
    if requested_model in candidate_models:
        return requested_model

    return _find_model_by_base(candidate_models, requested_model.split(":")[0])


def _find_model_by_base(candidate_models: List[str], model_base: str) -> Optional[str]:
    """Finds the first candidate whose untagged model name matches the requested base."""
    return next((model for model in candidate_models if model.split(":")[0] == model_base), None)


def resolve_model(client: ollama.Client, requested_model: str) -> str:
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
        model: str = "llama3.1",
        base_url: str = "http://localhost:11434",
        rule_engine: Optional[RuleEngine] = None,
    ) -> None:
        """Initialize AgentCouncil with client, model, and optional rule engine.

        :param client: Optional pre-configured or mocked ollama.Client.
        :param model: Target LLM model name (default: 'llama3.1').
        :param base_url: Ollama daemon host URL (default: 'http://localhost:11434').
        :param rule_engine: Optional RuleEngine for deterministic fast-path evaluation.
        """
        self.base_url = base_url
        self.model = model
        self.client = client if client is not None else ollama.Client(host=base_url)
        self.rule_engine = rule_engine if rule_engine is not None else RuleEngine()

    def resolve_model(self) -> str:
        """Resolve installed or compatible Ollama model."""
        return resolve_model(self.client, self.model)

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
        resolved = self.resolve_model()

        runtime_agent = RuntimeLogAgent(self.client, resolved)
        config_agent = ConfigDependencyAgent(self.client, resolved)
        resource_agent = ClusterResourceAgent(self.client, resolved)
        synthesizer = SynthesizerAgent(self.client, resolved)

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
    model: str = "llama3.1",
    base_url: str = "http://localhost:11434",
    client: Optional[ollama.Client] = None,
) -> Dict[str, Any]:
    """Runs the full multi-agent collaborative investigation pipeline."""
    council = AgentCouncil(client=client, model=model, base_url=base_url)
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
        model = input_data.get("model", "llama3.1")
        base_url = input_data.get("baseUrl", "http://localhost:11434")

        run_council(failure_text, context, model, base_url)
    except Exception as err:
        emit_event("error", {"message": str(err)})
        sys.exit(1)


if __name__ == "__main__":
    main()
