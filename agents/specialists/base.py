"""
Base Specialist Agent — KDM v4.0.0
===================================
Defines the abstract base class for domain-specialized SRE agents.
Enforces strict Ollama JSON mode and deterministic fallback parsing.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
import json
import logging
import os
import sys
from typing import Any, Dict, Optional

import ollama

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import EvidenceBundle
except ImportError:
    from core.evidence import EvidenceBundle  # type: ignore[no-redef]

logger = logging.getLogger(__name__)

FALLBACK_REPORT: Dict[str, Any] = {
    "summary": "Agent output parsing failed",
    "evidence": [],
    "hypotheses": [],
    "confidence": "low",
}


class BaseSpecialistAgent(ABC):
    """Abstract base class for domain-specialized diagnostic agents.

    Each specialist focuses exclusively on its domain (Runtime, Config, Resource)
    and queries Ollama with strict JSON mode to eliminate hallucinations.
    """

    role: str
    display_name: str
    icon: str

    def __init__(self, client: ollama.Client, model: str) -> None:
        """Initialize specialist agent with an Ollama client and model name."""
        self.client = client
        self.model = model

    @abstractmethod
    def build_prompt(self, bundle: EvidenceBundle) -> str:
        """Construct the domain-specific prompt from the evidence bundle."""
        pass

    @abstractmethod
    def get_system_prompt(self) -> str:
        """Return the specialist's system prompt establishing its persona and constraints."""
        pass

    def run_investigation(self, bundle: EvidenceBundle) -> Dict[str, Any]:
        """Run domain investigation using Ollama with strict JSON mode.

        Passes format="json" and options={"temperature": 0.1} to client.chat().
        Returns a dictionary adhering to the SpecialistReport schema:
        {
            "summary": str,
            "evidence": List[str],
            "hypotheses": List[str],
            "confidence": "high" | "medium" | "low"
        }
        """
        if bundle is None:
            return dict(FALLBACK_REPORT)

        prompt = self.build_prompt(bundle)
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
            return self._parse_chat_response(response)
        except Exception as exc:
            logger.warning(
                "Specialist %s investigation failed: %s",
                getattr(self, "role", "unknown"),
                exc,
            )
            return dict(FALLBACK_REPORT)

    def analyze(
        self, failure_text: str, context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Backward-compatible analysis interface for legacy council workflows."""
        ctx = context or {}
        user_content = (
            f"Workload Failure Information:\n{failure_text}\nContext: {json.dumps(ctx)}"
        )
        try:
            response = self.client.chat(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.get_system_prompt()},
                    {"role": "user", "content": user_content},
                ],
                format="json",
            )
            content = self._extract_content(response)
            cleaned = self._strip_markdown_fences(content)
            parsed = json.loads(cleaned)
            if not isinstance(parsed, dict):
                parsed = {}
            return {
                "role": self.role,
                "agentName": self.display_name,
                "icon": self.icon,
                "status": "completed",
                "statusText": f"Completed {self.role} analysis",
                "summary": parsed.get("summary", "Analysis completed."),
                "evidence": parsed.get("evidence", []),
            }
        except Exception:
            return {
                "role": self.role,
                "agentName": self.display_name,
                "icon": self.icon,
                "status": "completed",
                "statusText": f"Completed {self.role} analysis",
                "summary": f"Failure detected in {self.role}: {failure_text.splitlines()[0] if failure_text else 'workload issue'}",
                "evidence": [
                    failure_text.splitlines()[0]
                    if failure_text
                    else "Lifecycle anomaly"
                ],
            }

    def _parse_chat_response(self, response: Any) -> Dict[str, Any]:
        """Safely parse and normalize JSON content from Ollama response."""
        try:
            content = self._extract_content(response)
            cleaned = self._strip_markdown_fences(content)
            parsed = json.loads(cleaned)
            if not isinstance(parsed, dict):
                return dict(FALLBACK_REPORT)
            return self._normalize_report(parsed)
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            return dict(FALLBACK_REPORT)

    @staticmethod
    def _extract_content(response: Any) -> str:
        """Extract text content from dict or ChatResponse objects."""
        if isinstance(response, dict):
            return response.get("message", {}).get("content", "")
        if hasattr(response, "message"):
            msg = response.message
            if isinstance(msg, dict):
                return msg.get("content", "")
            return getattr(msg, "content", "")
        if hasattr(response, "__getitem__"):
            try:
                return response["message"]["content"]
            except Exception:
                pass
        return str(response)

    @staticmethod
    def _strip_markdown_fences(text: str) -> str:
        """Strip markdown code fence blocks if returned by the LLM."""
        stripped = text.strip()
        if stripped.startswith("```"):
            lines = stripped.splitlines()
            if len(lines) >= 2 and lines[-1].strip() == "```":
                return "\n".join(lines[1:-1]).strip()
            if len(lines) >= 1:
                return "\n".join(lines[1:]).strip()
        return stripped

    @staticmethod
    def _normalize_report(data: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize report dictionary to ensure all required fields are typed."""
        summary = str(data.get("summary") or "Investigation completed.")
        evidence = data.get("evidence")
        if not isinstance(evidence, list):
            evidence = [str(evidence)] if evidence else []
        else:
            evidence = [str(item) for item in evidence]

        hypotheses = data.get("hypotheses")
        if not isinstance(hypotheses, list):
            hypotheses = [str(hypotheses)] if hypotheses else []
        else:
            hypotheses = [str(item) for item in hypotheses]

        confidence = str(data.get("confidence") or "low").lower()
        if confidence not in ("high", "medium", "low"):
            confidence = "low"

        return {
            "summary": summary,
            "evidence": evidence,
            "hypotheses": hypotheses,
            "confidence": confidence,
        }
