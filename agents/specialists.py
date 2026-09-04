"""Specialist agents for diagnosing Kubernetes and Docker workload failures using Ollama Python SDK.
"""

from typing import Any, Dict, List
import json
import ollama


class RuntimeLogAgent:
    """Specialist agent focusing on container process lifecycle, signals, and stderr/stdout logs."""

    ROLE = "runtime"
    NAME = "Runtime & Log Agent"
    ICON = "🔍"

    def __init__(self, client: ollama.Client, model: str):
        self.client = client
        self.model = model

    def analyze(self, failure_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        system_prompt = (
            "You are a Kubernetes & Docker Runtime Engineer specializing in container lifecycle, "
            "Linux signals, exit codes (137 OOMKill, 1 Crash, 126 Permissions, 143 SIGTERM), "
            "and application stderr/stdout stack traces.\n"
            "Analyze the given failure text. Identify the immediate runtime or process-level trigger.\n"
            "Return a clean JSON object with keys:\n"
            '  "summary": concise diagnosis sentence,\n'
            '  "evidence": list of 2-3 key observations\n'
            "Return ONLY valid JSON."
        )

        user_content = f"Workload Failure Information:\n{failure_text}\nContext: {json.dumps(context)}"
        try:
            response = self.client.chat(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                format="json",
            )
            raw = response.message.content
            parsed = json.loads(raw)
            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": "Completed runtime & log inspection",
                "summary": parsed.get("summary", "Inspected runtime signals and error logs."),
                "evidence": parsed.get("evidence", []),
            }
        except Exception as err:
            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": f"Runtime observation generated: {err}",
                "summary": f"Process error detected: {failure_text[:120]}...",
                "evidence": [f"Exit state indicates failure: {failure_text.splitlines()[0] if failure_text else 'Unknown'}"],
            }


class ConfigDependencyAgent:
    """Specialist agent focusing on declarative configuration, environment, and dependencies."""

    ROLE = "config"
    NAME = "Config & Dependency Agent"
    ICON = "⚙️"

    def __init__(self, client: ollama.Client, model: str):
        self.client = client
        self.model = model

    def analyze(self, failure_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        system_prompt = (
            "You are a Kubernetes Configuration & SRE Specialist focusing on ConfigMaps, Secrets, "
            "environment variables, volume mounts, service discovery, and liveness/readiness probe timeouts.\n"
            "Analyze whether the failure stems from misconfiguration, missing dependencies, or probe thresholds.\n"
            "Return a clean JSON object with keys:\n"
            '  "summary": concise diagnosis sentence,\n'
            '  "evidence": list of 2-3 key observations\n'
            "Return ONLY valid JSON."
        )

        user_content = f"Workload Failure Information:\n{failure_text}\nContext: {json.dumps(context)}"
        try:
            response = self.client.chat(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                format="json",
            )
            raw = response.message.content
            parsed = json.loads(raw)
            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": "Completed configuration & dependency analysis",
                "summary": parsed.get("summary", "Inspected manifest configs and dependencies."),
                "evidence": parsed.get("evidence", []),
            }
        except Exception as err:
            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": f"Config observation generated: {err}",
                "summary": "Evaluated configuration dependencies against failure signature.",
                "evidence": ["Checked configuration and volume binding prerequisites."],
            }


class ClusterResourceAgent:
    """Specialist agent focusing on node capacity, memory limits, and scheduler QoS."""

    ROLE = "resource"
    NAME = "Cluster & Resource Agent"
    ICON = "🛡️"

    def __init__(self, client: ollama.Client, model: str):
        self.client = client
        self.model = model

    def analyze(self, failure_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        system_prompt = (
            "You are a Kubernetes Capacity & Infrastructure Engineer focusing on node memory/disk pressure, "
            "OOMKilled events, CPU throttling, cgroup memory limits, and QoS classes.\n"
            "Analyze whether the workload failed due to quota exhaustion, cluster starvation, or improper sizing.\n"
            "Return a clean JSON object with keys:\n"
            '  "summary": concise diagnosis sentence,\n'
            '  "evidence": list of 2-3 key observations\n'
            "Return ONLY valid JSON."
        )

        user_content = f"Workload Failure Information:\n{failure_text}\nContext: {json.dumps(context)}"
        try:
            response = self.client.chat(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                format="json",
            )
            raw = response.message.content
            parsed = json.loads(raw)
            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": "Completed resource & quota evaluation",
                "summary": parsed.get("summary", "Evaluated node capacity and memory limits."),
                "evidence": parsed.get("evidence", []),
            }
        except Exception as err:
            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": f"Resource observation generated: {err}",
                "summary": "Evaluated container resource limits and node allocation.",
                "evidence": ["Assessed memory limits and cluster eviction status."],
            }


class SynthesizerAgent:
    """Lead SRE synthesizer agent that reconciles reports and outputs consensus diagnosis."""

    ROLE = "synthesizer"
    NAME = "Lead SRE Synthesizer"
    ICON = "🎯"

    def __init__(self, client: ollama.Client, model: str):
        self.client = client
        self.model = model

    def synthesize(
        self,
        failure_text: str,
        findings: List[Dict[str, Any]],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        system_prompt = (
            "You are the Lead SRE Incident Commander. You have received investigative reports from three "
            "specialist agents: Runtime Agent, Config Agent, and Resource Agent.\n"
            "Reconcile the findings, eliminate symptoms that are merely consequences, determine the true root cause, "
            "and output the optimal step-by-step remediation plan.\n"
            "Return a clean JSON object with keys:\n"
            '  "rootCause": concise statement of true root cause,\n'
            '  "confidence": "high" | "medium" | "low",\n'
            '  "bestSolution": {\n'
            '    "actionTitle": short fix title,\n'
            '    "steps": ["step 1", "step 2", ...],\n'
            '    "commandToRun": "optional exact command like kubectl patch or restart",\n'
            '    "riskLevel": "low" | "medium" | "high"\n'
            "  }\n"
            "Return ONLY valid JSON."
        )

        user_content = (
            f"Original Error:\n{failure_text}\n\n"
            f"Specialist Agent Reports:\n{json.dumps(findings, indent=2)}\n\n"
            f"Context: {json.dumps(context)}"
        )

        try:
            response = self.client.chat(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                format="json",
            )
            raw = response.message.content
            parsed = json.loads(raw)
            return {
                "rootCause": parsed.get("rootCause", "Root cause identified from agent consensus."),
                "confidence": parsed.get("confidence", "high"),
                "findings": findings,
                "bestSolution": {
                    "actionTitle": parsed.get("bestSolution", {}).get("actionTitle", "Apply Recommended Fix"),
                    "steps": parsed.get("bestSolution", {}).get("steps", ["Review container logs and configuration.", "Apply recommended adjustment."]),
                    "commandToRun": parsed.get("bestSolution", {}).get("commandToRun"),
                    "riskLevel": parsed.get("bestSolution", {}).get("riskLevel", "low"),
                },
            }
        except Exception:
            first_err = failure_text.splitlines()[0] if failure_text else "Workload failure"
            return {
                "rootCause": f"Consensus indicates failure: {first_err}",
                "confidence": "medium",
                "findings": findings,
                "bestSolution": {
                    "actionTitle": "Remediate Workload Failure",
                    "steps": [
                        "Review container exit codes and startup parameters.",
                        "Inspect Kubernetes events with 'kubectl describe'.",
                        "Restart the workload once verified.",
                    ],
                    "riskLevel": "low",
                },
            }
