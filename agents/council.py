import sys
import os
import json
from typing import Any, Dict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ollama
from specialists import (
    RuntimeLogAgent,
    ConfigDependencyAgent,
    ClusterResourceAgent,
    SynthesizerAgent,
)


def emit_event(event_type: str, data: Dict[str, Any]) -> None:
    """Emits a single JSON event to stdout, followed by an immediate flush."""
    payload = {"type": event_type, **data}
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def run_council(
    failure_text: str,
    context: Dict[str, Any],
    model: str = "llama3.1",
    base_url: str = "http://localhost:11434",
) -> Dict[str, Any]:
    """Runs the full multi-agent collaborative investigation pipeline."""
    client = ollama.Client(host=base_url)

    runtime_agent = RuntimeLogAgent(client, model)
    config_agent = ConfigDependencyAgent(client, model)
    resource_agent = ClusterResourceAgent(client, model)
    synthesizer = SynthesizerAgent(client, model)

    findings = []

    # Step 1: Runtime Agent
    emit_event("progress", {
        "agent": runtime_agent.NAME,
        "role": runtime_agent.ROLE,
        "icon": runtime_agent.ICON,
        "status": "running",
        "message": f"{runtime_agent.NAME} is working: Analyzing container logs & exit codes...",
    })
    runtime_res = runtime_agent.analyze(failure_text, context)
    findings.append(runtime_res)
    emit_event("agent_completed", {"agent": runtime_agent.NAME, "finding": runtime_res})

    # Step 2: Config Agent
    emit_event("progress", {
        "agent": config_agent.NAME,
        "role": config_agent.ROLE,
        "icon": config_agent.ICON,
        "status": "running",
        "message": f"{config_agent.NAME} is working: Checking ConfigMaps, Secrets & probe thresholds...",
    })
    config_res = config_agent.analyze(failure_text, context)
    findings.append(config_res)
    emit_event("agent_completed", {"agent": config_agent.NAME, "finding": config_res})

    # Step 3: Resource Agent
    emit_event("progress", {
        "agent": resource_agent.NAME,
        "role": resource_agent.ROLE,
        "icon": resource_agent.ICON,
        "status": "running",
        "message": f"{resource_agent.NAME} is working: Evaluating node pressure & memory limits...",
    })
    resource_res = resource_agent.analyze(failure_text, context)
    findings.append(resource_res)
    emit_event("agent_completed", {"agent": resource_agent.NAME, "finding": resource_res})

    # Step 4: Lead Synthesizer Agent
    emit_event("progress", {
        "agent": synthesizer.NAME,
        "role": synthesizer.ROLE,
        "icon": synthesizer.ICON,
        "status": "running",
        "message": f"{synthesizer.NAME} is finding best solution...",
    })
    consensus = synthesizer.synthesize(failure_text, findings, context)

    emit_event("complete", {"consensus": consensus})
    return consensus


def main() -> None:
    """Reads input JSON from stdin and runs the council."""
    try:
        raw_input = sys.stdin.read().strip()
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
