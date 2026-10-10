"""
Lead SRE Investigator Agent — KDM v4.0.0
=========================================
Implements the Lead SRE Investigator Agent acting as the incident commander.
Aggregates findings from domain specialists, discards secondary cascade
symptoms, eliminates duplicate or misleading findings, and formulates 2-3
ranked competing root-cause hypotheses with calibrated likelihood scores.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from typing import Any, Dict, List

import ollama

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.synthesis.hypotheses import Hypothesis
except ImportError:
    from synthesis.hypotheses import Hypothesis  # type: ignore[no-redef]

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Principal SRE Incident Commander for containerized workloads.
You have received investigative reports from multiple domain specialist agents (Runtime, Config, Resource, etc.).

Your incident commander duties:
1. Aggregate and correlate all specialist findings.
2. Discard secondary cascade symptoms (e.g., probe timeouts or restarts caused by an earlier OOMKill or process panic).
3. Eliminate duplicate or misleading findings and identify the true initial trigger.
4. Formulate 2-3 ranked competing hypotheses with IDs 'hyp-01', 'hyp-02', etc.
5. Assign a likelihood score (float from 0.0 to 1.0) to each hypothesis.
6. If evidence is inconclusive or conflicting, you MUST assign likelihood < 0.5 rather than forcing high certainty.
7. For each hypothesis, list specific 'supporting_evidence' and 'contradicting_evidence' strings.
8. Rank the most probable root trigger first (highest likelihood first).

Output format: Return ONLY a valid JSON array of hypothesis objects:
[
  {
    "id": "hyp-01",
    "description": "Application OOMKilled due to memory limit under peak load.",
    "likelihood": 0.92,
    "supporting_evidence": ["Exit code 137", "Memory limit 256Mi", "OOMKilled reason"],
    "contradicting_evidence": []
  },
  {
    "id": "hyp-02",
    "description": "Slow memory leak triggered by database reconnection loop.",
    "likelihood": 0.45,
    "supporting_evidence": ["PostgreSQL reconnection warnings in stderr"],
    "contradicting_evidence": ["Node MemoryPressure is False"]
  }
]
"""


class LeadInvestigatorAgent:
    """Incident commander agent synthesizing specialist findings into competing hypotheses.

    Correlates evidence across Runtime, Config, and Resource specialists, distinguishes
    root causes from downstream cascade symptoms, and ranks competing hypotheses.
    """

    role: str = "lead_investigator"
    display_name: str = "Lead SRE Investigator"
    icon: str = "🎯"

    def __init__(self, client: ollama.Client, model: str = "llama3.1") -> None:
        """Initialize the Lead SRE Investigator Agent.

        :param client: Ollama client instance for LLM queries.
        :param model: Target LLM model name (default: 'llama3.1').
        """
        self.client = client
        self.model = model

    def get_system_prompt(self) -> str:
        """Return the incident commander system prompt defining persona and constraints.

        :return: System prompt string.
        """
        return SYSTEM_PROMPT.strip()

    def build_prompt(self, specialist_findings: List[Dict[str, Any]]) -> str:
        """Construct synthesis prompt aggregating specialist reports for the LLM.

        :param specialist_findings: List of specialist diagnostic reports.
        :return: Formatted user prompt string.
        """
        normalized = [self._normalize_finding(f) for f in specialist_findings]
        findings_json = json.dumps(normalized, indent=2)
        return (
            "Specialist Investigative Reports:\n"
            f"{findings_json}\n\n"
            "Analyze these specialist findings as Incident Commander. "
            "Eliminate secondary cascade symptoms, reconcile conflicting signals, "
            "and generate 2-3 ranked competing hypotheses adhering to the schema."
        )

    def formulate_hypotheses(
        self, specialist_findings: List[Dict[str, Any]]
    ) -> List[Hypothesis]:
        """Correlate specialist findings and formulate ranked competing hypotheses.

        Queries Ollama with strict JSON mode and calibrated temperature.
        Falls back to deterministic rule synthesis on malformed responses or errors.

        :param specialist_findings: Diagnostic reports from domain specialists.
        :return: List of Hypothesis objects ranked by likelihood in descending order.
        """
        if not specialist_findings:
            return self._build_inconclusive_fallback("No specialist findings provided.")

        prompt = self.build_prompt(specialist_findings)
        try:
            response = self.client.chat(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.get_system_prompt()},
                    {"role": "user", "content": prompt},
                ],
                format="json",
                options={"temperature": 0.1},
            )
            parsed_hypotheses = self._parse_hypotheses_response(response)
            if parsed_hypotheses:
                return sorted(parsed_hypotheses, key=lambda h: h.likelihood, reverse=True)
        except Exception as exc:
            logger.warning("Lead investigator Ollama call failed: %s", exc)

        return self._fallback_hypotheses(specialist_findings)

    async def formulate_hypotheses_async(
        self, specialist_findings: List[Dict[str, Any]]
    ) -> List[Hypothesis]:
        """Execute formulate_hypotheses asynchronously in a worker thread.

        :param specialist_findings: Diagnostic reports from domain specialists.
        :return: List of Hypothesis objects ranked by likelihood descending.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self.formulate_hypotheses, specialist_findings
        )

    @staticmethod
    def _normalize_finding(finding: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize finding dictionary unwrapping nested orchestrator results.

        :param finding: Raw finding dictionary from specialist or orchestrator.
        :return: Clean dictionary containing role, summary, evidence, and confidence.
        """
        if not isinstance(finding, dict):
            return {}
        result_payload = finding.get("result")
        source = result_payload if isinstance(result_payload, dict) else finding
        role = finding.get("role") or source.get("role", "specialist")
        return {
            "role": str(role),
            "summary": str(source.get("summary", "")),
            "evidence": source.get("evidence", []),
            "hypotheses": source.get("hypotheses", []),
            "confidence": str(source.get("confidence", "low")),
        }

    @classmethod
    def _parse_hypotheses_response(cls, response: Any) -> List[Hypothesis]:
        """Extract and parse hypotheses from an Ollama chat response.

        :param response: Ollama chat response object or dictionary.
        :return: List of validated Hypothesis objects.
        """
        content = cls._extract_content(response)
        cleaned = cls._strip_markdown_fences(content)
        try:
            parsed = json.loads(cleaned)
        except (json.JSONDecodeError, TypeError):
            return []

        items = cls._extract_hypothesis_list(parsed)
        return [Hypothesis.from_dict(item) for item in items if isinstance(item, dict)]

    @staticmethod
    def _extract_hypothesis_list(parsed_data: Any) -> List[Any]:
        """Extract list of hypothesis items from parsed JSON object or array.

        :param parsed_data: Parsed JSON structure.
        :return: List of item dictionaries.
        """
        if isinstance(parsed_data, list):
            return parsed_data
        if isinstance(parsed_data, dict):
            for key in ("hypotheses", "Hypotheses", "items", "results"):
                val = parsed_data.get(key)
                if isinstance(val, list):
                    return val
        return []

    @staticmethod
    def _extract_from_message(msg: Any) -> str:
        """Extract content string from message container."""
        if isinstance(msg, dict):
            return str(msg.get("content", ""))
        return str(getattr(msg, "content", ""))

    @classmethod
    def _extract_content(cls, response: Any) -> str:
        """Extract message text content from dict or ChatResponse objects.

        :param response: Raw response from Ollama client.
        :return: Extracted text content string.
        """
        if isinstance(response, dict):
            return str(response.get("message", {}).get("content", ""))
        if hasattr(response, "message"):
            return cls._extract_from_message(response.message)
        try:
            return str(response["message"]["content"])
        except Exception:
            return str(response)

    @staticmethod
    def _strip_markdown_fences(text: str) -> str:
        """Strip markdown ```json code fences if present.

        :param text: Raw content string.
        :return: Unwrapped JSON text string.
        """
        stripped = text.strip()
        if not stripped.startswith("```"):
            return stripped
        lines = stripped.splitlines()
        if lines[-1].strip() == "```":
            return "\n".join(lines[1:-1]).strip()
        return "\n".join(lines[1:]).strip()

    def _fallback_hypotheses(
        self, specialist_findings: List[Dict[str, Any]]
    ) -> List[Hypothesis]:
        """Deterministic fallback synthesizer when LLM parsing is unavailable.

        :param specialist_findings: Diagnostic reports from specialists.
        :return: Deterministically synthesized list of Hypothesis objects.
        """
        normalized = [self._normalize_finding(f) for f in specialist_findings]
        all_evidence: List[str] = []
        for f in normalized:
            ev_list = f.get("evidence", [])
            if isinstance(ev_list, list):
                all_evidence.extend(str(e) for e in ev_list)

        joined_evidence = " ".join(all_evidence).lower()
        if "137" in joined_evidence or "oomkilled" in joined_evidence:
            return self._build_oom_fallback(all_evidence, joined_evidence)
        if "crashloopbackoff" in joined_evidence or "exit code 1" in joined_evidence:
            return self._build_crash_fallback(all_evidence)
        if "configmap" in joined_evidence or "secret" in joined_evidence or "mount" in joined_evidence:
            return self._build_config_fallback(all_evidence)

        return self._build_inconclusive_fallback("Inconclusive specialist reports.")

    def _build_oom_fallback(
        self, all_evidence: List[str], joined_text: str
    ) -> List[Hypothesis]:
        """Build ranked hypotheses for OOMKill incidents with cascade detection.

        :param all_evidence: Combined list of evidence strings.
        :param joined_text: Lowercased concatenated evidence text.
        :return: Ranked hypothesis list.
        """
        oom_ev = [e for e in all_evidence if any(k in e.lower() for k in ("137", "oom", "memory"))]
        has_probe = "probe" in joined_text or "unhealthy" in joined_text
        contra = ["Probe failure is a secondary cascade symptom."] if has_probe else []

        h1 = Hypothesis(
            id="hyp-01",
            description="Application container was OOMKilled after exceeding memory limits under load.",
            likelihood=0.92,
            supporting_evidence=oom_ev if oom_ev else ["Container terminated with exit code 137"],
            contradicting_evidence=contra,
        )
        h2 = Hypothesis(
            id="hyp-02",
            description="Gradual memory leak in application process caused container termination.",
            likelihood=0.45,
            supporting_evidence=["Container restarted repeatedly"],
            contradicting_evidence=["Node MemoryPressure is False"],
        )
        return [h1, h2]

    @staticmethod
    def _build_crash_fallback(all_evidence: List[str]) -> List[Hypothesis]:
        """Build hypotheses for application process crashes."""
        crash_ev = [e for e in all_evidence if any(k in e.lower() for k in ("crash", "exit code", "backoff"))]
        return [
            Hypothesis(
                id="hyp-01",
                description="Application process exited with fatal error during execution.",
                likelihood=0.85,
                supporting_evidence=crash_ev if crash_ev else ["Container in CrashLoopBackOff"],
                contradicting_evidence=[],
            ),
            Hypothesis(
                id="hyp-02",
                description="Transient configuration or dependency connection timeout.",
                likelihood=0.40,
                supporting_evidence=["Repeated container restarts observed"],
                contradicting_evidence=["Process terminates before readiness probe executes"],
            ),
        ]

    @staticmethod
    def _build_config_fallback(all_evidence: List[str]) -> List[Hypothesis]:
        """Build hypotheses for missing configuration or secret dependencies."""
        cfg_ev = [e for e in all_evidence if any(k in e.lower() for k in ("config", "secret", "mount", "404"))]
        return [
            Hypothesis(
                id="hyp-01",
                description="Required ConfigMap or Secret dependency missing from namespace.",
                likelihood=0.88,
                supporting_evidence=cfg_ev if cfg_ev else ["Volume mount setup failed"],
                contradicting_evidence=[],
            ),
            Hypothesis(
                id="hyp-02",
                description="RBAC permission denial accessing namespace resources.",
                likelihood=0.35,
                supporting_evidence=["Volume mount error in pod events"],
                contradicting_evidence=["API returned 404 Not Found rather than 403 Forbidden"],
            ),
        ]

    @staticmethod
    def _build_inconclusive_fallback(reason: str) -> List[Hypothesis]:
        """Build low-confidence hypotheses for ambiguous or conflicting evidence."""
        return [
            Hypothesis(
                id="hyp-01",
                description=f"Inconclusive workload failure: {reason}",
                likelihood=0.40,
                supporting_evidence=["Specialist diagnostic evidence is ambiguous or incomplete"],
                contradicting_evidence=["No deterministic root-cause signature detected"],
            ),
            Hypothesis(
                id="hyp-02",
                description="Potential transient network or node infrastructure anomaly.",
                likelihood=0.25,
                supporting_evidence=["Workload status degraded"],
                contradicting_evidence=["Node conditions report Ready"],
            ),
        ]
