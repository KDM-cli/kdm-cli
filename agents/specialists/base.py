"""
Base Specialist Agent — KDM v4.0.0
===================================
Defines the abstract base class for domain-specialized SRE agents.
Enforces strict Ollama JSON mode and deterministic fallback parsing.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
import asyncio
import json
import logging
import os
import sys
from typing import Any, Dict, List, Optional

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
            normalized = self._normalize_report(parsed)
            return {
                "role": self.role,
                "agentName": self.display_name,
                "icon": self.icon,
                "status": "completed",
                "statusText": f"Completed {self.role} analysis",
                "summary": parsed.get("summary", "Analysis completed."),
                "evidence": normalized.get("evidence", []),
            }
        except Exception:
            fallback_label = "workload issue"
            lines = failure_text.splitlines() if failure_text else []
            if lines:
                fallback_label = lines[0]
            return {
                "role": self.role,
                "agentName": self.display_name,
                "icon": self.icon,
                "status": "completed",
                "statusText": f"Completed {self.role} analysis",
                "summary": f"Failure detected in {self.role}: {fallback_label}",
                "evidence": [fallback_label],
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
    def _extract_from_message(msg: Any) -> str:
        """Extract content from a message dictionary or object."""
        if isinstance(msg, dict):
            return str(msg.get("content", ""))
        return str(getattr(msg, "content", ""))

    @staticmethod
    def _extract_item_content(response: Any) -> str:
        """Fallback extraction for subscriptable response objects."""
        try:
            return str(response["message"]["content"])
        except Exception:
            return str(response)

    @classmethod
    def _extract_content(cls, response: Any) -> str:
        """Extract text content from dict or ChatResponse objects."""
        if isinstance(response, dict):
            return str(response.get("message", {}).get("content", ""))
        if hasattr(response, "message"):
            return cls._extract_from_message(response.message)
        return cls._extract_item_content(response)

    @staticmethod
    def _unwrap_fenced_lines(lines: List[str]) -> str:
        """Unwrap lines contained within markdown code fences."""
        if not lines:
            return ""
        if lines[-1].strip() == "```":
            return "\n".join(lines[1:-1]).strip()
        return "\n".join(lines[1:]).strip()

    @classmethod
    def _strip_markdown_fences(cls, text: str) -> str:
        """Strip markdown code fence blocks if returned by the LLM."""
        stripped = text.strip()
        if not stripped.startswith("```"):
            return stripped
        return cls._unwrap_fenced_lines(stripped.splitlines())

    @staticmethod
    def _ensure_string_list(items: Any) -> List[str]:
        """Ensure an input field is converted to a list of strings."""
        if isinstance(items, list):
            return [str(item) for item in items]
        if items:
            return [str(items)]
        return []

    @staticmethod
    def _normalize_confidence(val: Any) -> str:
        """Normalize confidence score to 'high', 'medium', or 'low'."""
        text = str(val or "low").lower()
        if text in ("high", "medium", "low"):
            return text
        return "low"

    @classmethod
    def _normalize_report(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize report dictionary to ensure all required fields are typed."""
        summary = str(data.get("summary") or "Investigation completed.")
        return {
            "summary": summary,
            "evidence": cls._ensure_string_list(data.get("evidence")),
            "hypotheses": cls._ensure_string_list(data.get("hypotheses")),
            "confidence": cls._normalize_confidence(data.get("confidence")),
        }

    @staticmethod
    def _format_history_summary(history: List[Dict[str, Any]]) -> str:
        """Format prior tool execution records for inclusion in prompt."""
        if not history:
            return "No previous tool executions."
        lines: List[str] = []
        for i, turn in enumerate(history, 1):
            tool = turn.get("tool", "unknown")
            args = turn.get("args", {})
            res = turn.get("result", {})
            lines.append(
                f"Turn {i}: Invoked '{tool}' with args {json.dumps(args)} -> Result: {json.dumps(res)}"
            )
        return "\n".join(lines)

    def _parse_json_dict(self, response: Any) -> Dict[str, Any]:
        """Safely parse JSON dictionary from an Ollama chat response."""
        try:
            content = self._extract_content(response)
            cleaned = self._strip_markdown_fences(content)
            parsed = json.loads(cleaned)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    async def evaluate_next_step(
        self,
        bundle: Optional[EvidenceBundle],
        history: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Evaluate evidence and tool history to decide the next investigation action.

        :param bundle: Evidence bundle containing current workload facts.
        :param history: Prior tool call history for the active investigation.
        :return: Action dictionary requesting a tool execution or providing final diagnosis.
        """
        if bundle is None:
            return {"action": "final_answer", "report": dict(FALLBACK_REPORT)}

        prompt = self.build_prompt(bundle)
        hist_summary = self._format_history_summary(history)
        user_content = (
            f"{prompt}\n\n"
            f"=== TOOL EXECUTION HISTORY ===\n{hist_summary}\n\n"
            "Evaluate whether additional cluster evidence is needed. If you require further evidence, "
            'return: {"action": "call", "tool": "<tool_name>", "args": {<kwargs>}}.\n'
            "If you have sufficient facts to form a diagnosis, return:\n"
            '{"action": "final_answer", "report": {"summary": "...", "evidence": [...], "hypotheses": [...], "confidence": "high|medium|low"}}.'
        )

        loop = asyncio.get_running_loop()
        try:
            response = await loop.run_in_executor(
                None,
                lambda: self.client.chat(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": self.get_system_prompt()},
                        {"role": "user", "content": user_content},
                    ],
                    format="json",
                    options={"temperature": 0.1},
                ),
            )
            parsed = self._parse_json_dict(response)
            if parsed.get("action") == "call" and parsed.get("tool"):
                return {
                    "action": "call",
                    "tool": str(parsed["tool"]),
                    "args": parsed.get("args", {}),
                }
            if parsed.get("action") == "final_answer":
                rep = parsed.get("report") if isinstance(parsed.get("report"), dict) else parsed
                return {"action": "final_answer", "report": self._normalize_report(rep)}
            return {"action": "final_answer", "report": self._normalize_report(parsed)}
        except Exception as exc:
            logger.warning(
                "Specialist %s evaluate_next_step failed: %s",
                getattr(self, "role", "unknown"),
                exc,
            )
            return {"action": "final_answer", "report": dict(FALLBACK_REPORT)}

    async def force_synthesis(
        self,
        bundle: Optional[EvidenceBundle],
        history: List[Dict[str, Any]],
        instruction: str = "Max investigation depth reached. Provide your best diagnosis based on current facts.",
    ) -> Dict[str, Any]:
        """Synthesize final diagnosis incorporating all evidence and tool results.

        :param bundle: Evidence bundle containing workload facts.
        :param history: Prior tool call history.
        :param instruction: Synthesis instruction prompt.
        :return: Normalized specialist report dictionary.
        """
        if bundle is None:
            return dict(FALLBACK_REPORT)

        prompt = self.build_prompt(bundle)
        hist_summary = self._format_history_summary(history)
        user_content = (
            f"{prompt}\n\n"
            f"=== TOOL EXECUTION HISTORY ===\n{hist_summary}\n\n"
            f"=== INSTRUCTION ===\n{instruction}\n\n"
            "Provide your final diagnosis adhering to the SpecialistReport schema."
        )

        loop = asyncio.get_running_loop()
        try:
            response = await loop.run_in_executor(
                None,
                lambda: self.client.chat(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": self.get_system_prompt()},
                        {"role": "user", "content": user_content},
                    ],
                    format="json",
                    options={"temperature": 0.1},
                ),
            )
            return self._parse_chat_response(response)
        except Exception as exc:
            logger.warning(
                "Specialist %s force_synthesis failed: %s",
                getattr(self, "role", "unknown"),
                exc,
            )
            return dict(FALLBACK_REPORT)

