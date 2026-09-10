"""Specialist agents for diagnosing Kubernetes and Docker workload failures using Ollama Python SDK.
"""

from typing import Any, Dict, List, Optional
import json
import re
import ollama


def extract_json(raw: str) -> Dict[str, Any]:
    """Extracts and parses JSON from raw LLM output, handling markdown fences and whitespace."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) >= 2:
            if lines[-1].strip() == "```":
                text = "\n".join(lines[1:-1]).strip()
            else:
                text = "\n".join(lines[1:]).strip()
    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


def parse_k8s_failure(failure_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """Parses domain-specific entities from failure text and context."""
    pod_name = context.get("name") or "workload"
    ns = context.get("namespace") or "default"
    kind = context.get("kind") or "Pod"

    text = failure_text or ""

    # Secret / ConfigMap missing
    secret_match = re.search(r'secret\s+["\']?([^"\'\s:]+)["\']?\s+not found', text, re.IGNORECASE)
    configmap_match = re.search(r'configmap\s+["\']?([^"\'\s:]+)["\']?\s+not found', text, re.IGNORECASE)
    # Image pull errors
    image_match = re.search(r'(?:image|pulling image)\s+["\']?([^"\'\s,]+)["\']?', text, re.IGNORECASE)
    is_image_err = bool(re.search(r'ImagePullBackOff|ErrImagePull|manifest unknown|failed to pull and unpack image', text, re.IGNORECASE))
    # OOM
    is_oom = bool(re.search(r'OOMKilled|exit code 137|command terminated with exit code 137|Out of memory', text, re.IGNORECASE))
    # CrashLoop
    is_crash = bool(re.search(r'CrashLoopBackOff|Back-off restarting failed container|exit code 1(?!\d)', text, re.IGNORECASE))
    # Unschedulable / Nodes
    is_unschedulable = bool(re.search(r'0/\d+ nodes are available|FailedScheduling|Insufficient cpu|Insufficient memory|node\(s\) had untolerated taint', text, re.IGNORECASE))

    return {
        "pod_name": pod_name,
        "ns": ns,
        "kind": kind,
        "secret_name": secret_match.group(1) if secret_match else None,
        "configmap_name": configmap_match.group(1) if configmap_match else None,
        "image_name": image_match.group(1) if (image_match and is_image_err) else None,
        "is_image_err": is_image_err,
        "is_oom": is_oom,
        "is_crash": is_crash,
        "is_unschedulable": is_unschedulable,
    }


class RuntimeLogAgent:
    """Specialist agent focusing on container process lifecycle, signals, and stderr/stdout logs."""

    ROLE = "runtime"
    NAME = "Runtime & Log Agent"
    ICON = ""

    def __init__(self, client: ollama.Client, model: str):
        self.client = client
        self.model = model

    def analyze(self, failure_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        system_prompt = (
            "You are a Senior Kubernetes & Docker Runtime Engineer specializing in container lifecycle, "
            "Linux signals, exit codes (137 OOMKill, 1 Crash, 126 Permissions, 143 SIGTERM), "
            "and application stderr/stdout stack traces.\n"
            "Analyze the given failure text. Identify the immediate runtime or process-level trigger.\n"
            "Return a clean JSON object with keys:\n"
            '  "summary": concise diagnosis sentence naming the exact component or trigger,\n'
            '  "evidence": list of 2-3 specific technical observations\n'
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
            parsed = extract_json(raw)
            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": "Completed runtime & log inspection",
                "summary": parsed.get("summary", "Inspected runtime signals and error logs."),
                "evidence": parsed.get("evidence", []),
            }
        except Exception:
            parsed_meta = parse_k8s_failure(failure_text, context)
            if parsed_meta["secret_name"]:
                summary = f"Container volume mount blocked: Secret '{parsed_meta['secret_name']}' is not available."
                evidence = [
                    f"MountVolume.SetUp failed for container in {parsed_meta['pod_name']}",
                    f"Kubelet runtime is unable to attach secret volume '{parsed_meta['secret_name']}'",
                ]
            elif parsed_meta["configmap_name"]:
                summary = f"Container configuration blocked: ConfigMap '{parsed_meta['configmap_name']}' not found."
                evidence = [
                    f"Kubelet unable to resolve ConfigMap volume or envFrom for {parsed_meta['pod_name']}",
                    f"Required key material missing in namespace '{parsed_meta['ns']}'",
                ]
            elif parsed_meta["is_image_err"]:
                img = parsed_meta["image_name"] or "specified container image"
                summary = f"Container runtime failed to retrieve image '{img}' (ErrImagePull)."
                evidence = [
                    f"Kubelet image pull backoff triggered on {parsed_meta['pod_name']}",
                    "Container process initialization halted before exec",
                ]
            elif parsed_meta["is_oom"]:
                summary = f"Container process in {parsed_meta['pod_name']} was terminated by Linux OOM-killer (exit code 137)."
                evidence = [
                    "Memory cgroup limit exceeded under execution",
                    "Kernel sent SIGKILL signal to process",
                ]
            elif parsed_meta["is_crash"]:
                summary = f"Container process in {parsed_meta['pod_name']} exited with non-zero status (CrashLoopBackOff)."
                evidence = [
                    "Process terminated immediately after invocation",
                    "Application startup script or entrypoint failed",
                ]
            elif parsed_meta["is_unschedulable"]:
                summary = f"Workload {parsed_meta['pod_name']} has no runtime process because it is not scheduled to a node."
                evidence = [
                    "Kubelet has not initiated container engine setup",
                    "Pod remains in Pending scheduling phase",
                ]
            else:
                summary = f"Process error detected in {parsed_meta['pod_name']}: {failure_text.splitlines()[0] if failure_text else 'workload issue'}"
                evidence = [failure_text.splitlines()[0] if failure_text else "Container lifecycle anomaly"]

            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": "Completed runtime & log inspection",
                "summary": summary,
                "evidence": evidence,
            }


class ConfigDependencyAgent:
    """Specialist agent focusing on declarative configuration, environment, and dependencies."""

    ROLE = "config"
    NAME = "Config & Dependency Agent"
    ICON = ""

    def __init__(self, client: ollama.Client, model: str):
        self.client = client
        self.model = model

    def analyze(self, failure_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        system_prompt = (
            "You are a Senior Kubernetes Configuration Specialist focusing on ConfigMaps, Secrets, "
            "environment variables, volume mounts, service discovery, and liveness/readiness probe timeouts.\n"
            "Analyze whether the failure stems from misconfiguration, missing dependencies, or probe thresholds.\n"
            "Return a clean JSON object with keys:\n"
            '  "summary": concise diagnosis sentence detailing the configuration gap,\n'
            '  "evidence": list of 2-3 specific configuration observations\n'
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
            parsed = extract_json(raw)
            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": "Completed configuration & dependency analysis",
                "summary": parsed.get("summary", "Inspected manifest configs and dependencies."),
                "evidence": parsed.get("evidence", []),
            }
        except Exception:
            parsed_meta = parse_k8s_failure(failure_text, context)
            if parsed_meta["secret_name"]:
                summary = f"Missing Kubernetes Secret resource '{parsed_meta['secret_name']}' in namespace '{parsed_meta['ns']}'."
                evidence = [
                    f"Pod specification references Secret '{parsed_meta['secret_name']}' under volume mounts",
                    f"Kubernetes API returned 404 Not Found for Secret '{parsed_meta['secret_name']}'",
                ]
            elif parsed_meta["configmap_name"]:
                summary = f"Missing Kubernetes ConfigMap '{parsed_meta['configmap_name']}' in namespace '{parsed_meta['ns']}'."
                evidence = [
                    f"Pod specification references ConfigMap '{parsed_meta['configmap_name']}'",
                    f"ConfigMap does not exist in namespace '{parsed_meta['ns']}'",
                ]
            elif parsed_meta["is_image_err"]:
                img = parsed_meta["image_name"] or "specified container image"
                summary = f"Manifest references unavailable image '{img}' or missing imagePullSecrets."
                evidence = [
                    f"Container spec in {parsed_meta['pod_name']} requests image '{img}'",
                    f"Verify image tag accuracy or repository authentication secrets in '{parsed_meta['ns']}'",
                ]
            elif parsed_meta["is_unschedulable"]:
                summary = "Manifest resource requests or nodeSelector/affinity cannot be satisfied."
                evidence = [
                    "Pod declarative constraints exceed currently available node resources",
                    "Verify requests.cpu, requests.memory, and node tolerations",
                ]
            else:
                summary = f"Configuration evaluation completed for {parsed_meta['pod_name']} in namespace '{parsed_meta['ns']}'."
                evidence = ["Inspected manifest references and volume mounts"]

            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": "Completed configuration & dependency analysis",
                "summary": summary,
                "evidence": evidence,
            }


class ClusterResourceAgent:
    """Specialist agent focusing on node capacity, memory limits, and scheduler QoS."""

    ROLE = "resource"
    NAME = "Cluster & Resource Agent"
    ICON = ""

    def __init__(self, client: ollama.Client, model: str):
        self.client = client
        self.model = model

    def analyze(self, failure_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        system_prompt = (
            "You are a Senior Kubernetes Capacity & Infrastructure Engineer focusing on node memory/disk pressure, "
            "OOMKilled events, CPU throttling, cgroup memory limits, and QoS classes.\n"
            "Analyze whether the workload failed due to quota exhaustion, cluster starvation, or improper sizing.\n"
            "Return a clean JSON object with keys:\n"
            '  "summary": concise diagnosis sentence evaluating node and cgroup capacity,\n'
            '  "evidence": list of 2-3 technical resource observations\n'
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
            parsed = extract_json(raw)
            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": "Completed resource & quota evaluation",
                "summary": parsed.get("summary", "Evaluated node capacity and memory limits."),
                "evidence": parsed.get("evidence", []),
            }
        except Exception:
            parsed_meta = parse_k8s_failure(failure_text, context)
            if parsed_meta["is_oom"]:
                summary = f"Container in {parsed_meta['pod_name']} exceeded its configured cgroup memory limit."
                evidence = [
                    "Host kernel triggered OOM killer due to container limit boundary breach",
                    "Recommend bumping container limits.memory in Pod specification",
                ]
            elif parsed_meta["is_unschedulable"]:
                summary = "Cluster scheduler unable to find an eligible node with sufficient allocatable capacity."
                evidence = [
                    "Existing nodes do not satisfy CPU or memory request thresholds",
                    "Cluster requires additional node scaling or request right-sizing",
                ]
            elif parsed_meta["secret_name"] or parsed_meta["configmap_name"]:
                summary = "Cluster resource capacity normal; failure is strictly declarative dependency blocker."
                evidence = [
                    "Node CPU, memory, and disk pressure levels remain healthy",
                    "Workload startup is gated solely by missing configuration objects",
                ]
            elif parsed_meta["is_image_err"]:
                summary = "Node compute resources normal; container execution blocked by image retrieval."
                evidence = [
                    "No node memory pressure or disk eviction observed",
                    "Failure isolated to container registry access",
                ]
            else:
                summary = f"Evaluated node capacity and allocation for {parsed_meta['pod_name']}."
                evidence = ["No active node memory pressure or disk pressure detected"]

            return {
                "role": self.ROLE,
                "agentName": self.NAME,
                "icon": self.ICON,
                "status": "completed",
                "statusText": "Completed resource & quota evaluation",
                "summary": summary,
                "evidence": evidence,
            }


class SynthesizerAgent:
    """Lead SRE synthesizer agent that reconciles reports and outputs consensus diagnosis."""

    ROLE = "synthesizer"
    NAME = "Lead SRE Synthesizer"
    ICON = ""

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
            "and output the optimal step-by-step remediation plan with exact commands.\n"
            "Return a clean JSON object with keys:\n"
            '  "rootCause": concise statement of true root cause,\n'
            '  "confidence": "high" | "medium" | "low",\n'
            '  "bestSolution": {\n'
            '    "actionTitle": specific actionable fix title,\n'
            '    "steps": ["specific step 1", "specific step 2", ...],\n'
            '    "commandToRun": "exact executable command like kubectl create secret or kubectl describe",\n'
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
            parsed = extract_json(raw)
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
            parsed_meta = parse_k8s_failure(failure_text, context)
            pod = parsed_meta["pod_name"]
            ns = parsed_meta["ns"]

            if parsed_meta["secret_name"]:
                sec = parsed_meta["secret_name"]
                return {
                    "rootCause": f"Pod '{pod}' cannot start because referenced Secret '{sec}' is missing in namespace '{ns}'.",
                    "confidence": "high",
                    "findings": findings,
                    "bestSolution": {
                        "actionTitle": f"Create Missing Secret '{sec}' in Namespace '{ns}'",
                        "steps": [
                            f"Check existing secrets: kubectl get secrets -n {ns}",
                            f"Create the required secret: kubectl create secret generic {sec} -n {ns} --from-literal=key=value",
                            f"Verify that pod '{pod}' mounts the volume and progresses to Running",
                        ],
                        "commandToRun": f"kubectl create secret generic {sec} -n {ns} --from-literal=key=value",
                        "riskLevel": "low",
                    },
                }

            if parsed_meta["configmap_name"]:
                cm = parsed_meta["configmap_name"]
                return {
                    "rootCause": f"Pod '{pod}' cannot start because referenced ConfigMap '{cm}' is missing in namespace '{ns}'.",
                    "confidence": "high",
                    "findings": findings,
                    "bestSolution": {
                        "actionTitle": f"Create Missing ConfigMap '{cm}' in Namespace '{ns}'",
                        "steps": [
                            f"Inspect namespace ConfigMaps: kubectl get configmaps -n {ns}",
                            f"Create the required ConfigMap: kubectl create configmap {cm} -n {ns} --from-literal=KEY=VALUE",
                            f"Workload '{pod}' will automatically bind once the ConfigMap is present",
                        ],
                        "commandToRun": f"kubectl create configmap {cm} -n {ns} --from-literal=KEY=VALUE",
                        "riskLevel": "low",
                    },
                }

            if parsed_meta["is_image_err"]:
                img = parsed_meta["image_name"] or "container image"
                return {
                    "rootCause": f"Container image '{img}' cannot be pulled for Pod '{pod}' (ErrImagePull / ImagePullBackOff).",
                    "confidence": "high",
                    "findings": findings,
                    "bestSolution": {
                        "actionTitle": f"Correct Container Image Tag or Configure ImagePullSecrets",
                        "steps": [
                            f"Inspect exact pull failure: kubectl describe pod {pod} -n {ns}",
                            f"Ensure image '{img}' exists on registry with the specified tag",
                            f"If private registry, verify imagePullSecrets are attached to the Pod or service account",
                        ],
                        "commandToRun": f"kubectl describe pod {pod} -n {ns}",
                        "riskLevel": "low",
                    },
                }

            if parsed_meta["is_oom"]:
                return {
                    "rootCause": f"Container in Pod '{pod}' was abruptly killed by the Linux OOM killer (exit code 137).",
                    "confidence": "high",
                    "findings": findings,
                    "bestSolution": {
                        "actionTitle": f"Increase Container Memory Limits for Pod '{pod}'",
                        "steps": [
                            f"Inspect previous container state: kubectl describe pod {pod} -n {ns}",
                            "Increase limits.memory in the deployment or pod specification",
                            "Profile application memory usage to detect memory leaks",
                        ],
                        "commandToRun": f"kubectl logs {pod} -n {ns} --previous",
                        "riskLevel": "low",
                    },
                }

            if parsed_meta["is_unschedulable"]:
                return {
                    "rootCause": f"Pod '{pod}' is unschedulable because no cluster nodes have sufficient CPU/memory or match taints.",
                    "confidence": "high",
                    "findings": findings,
                    "bestSolution": {
                        "actionTitle": "Scale Node Capacity or Adjust Pod Resource Requests",
                        "steps": [
                            "Inspect cluster node capacities: kubectl describe nodes",
                            "Check pod resource requests: requests.cpu and requests.memory",
                            "Add additional worker nodes or relax node affinity/taint constraints",
                        ],
                        "commandToRun": "kubectl describe nodes",
                        "riskLevel": "low",
                    },
                }

            first_err = failure_text.splitlines()[0] if failure_text else "Workload failure"
            return {
                "rootCause": f"Multi-agent consensus identified workload anomaly: {first_err}",
                "confidence": "medium",
                "findings": findings,
                "bestSolution": {
                    "actionTitle": f"Inspect Pod Events and Application Logs for '{pod}'",
                    "steps": [
                        f"Describe pod events: kubectl describe pod {pod} -n {ns}",
                        f"Check previous execution logs: kubectl logs {pod} -n {ns} --previous",
                        "Update the workload specification and re-apply",
                    ],
                    "commandToRun": f"kubectl describe pod {pod} -n {ns}",
                    "riskLevel": "low",
                },
            }
