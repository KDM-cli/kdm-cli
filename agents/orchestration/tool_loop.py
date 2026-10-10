"""
Progressive Investigation Loop — KDM v4.0.0
==========================================
Implements a bounded multi-turn progressive tool-calling loop (ReAct pattern)
allowing specialist agents to request additional cluster evidence dynamically.
Enforces hard termination at max_turns (default: 3) and records every tool
call into the EvidenceStore audit trail.
"""

from __future__ import annotations

import inspect
import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import EvidenceBundle
    from agents.core.store import EvidenceStore, ToolCallRecord
    from agents.tools.registry import ToolRegistry
except ImportError:
    from core.evidence import EvidenceBundle  # type: ignore[no-redef]
    from core.store import EvidenceStore, ToolCallRecord  # type: ignore[no-redef]
    from tools.registry import ToolRegistry  # type: ignore[no-redef]

logger = logging.getLogger(__name__)

DEFAULT_MAX_TURNS: int = 3
MAX_DEPTH_INSTRUCTION: str = (
    "Max investigation depth reached. Provide your best diagnosis based on current facts."
)


def _extract_from_dict(decision: Dict[str, Any]) -> List[Any]:
    """Extract native tool calls from dictionary payload.

    :param decision: Dictionary representation of response.
    :return: List of tool calls.
    """
    if "tool_calls" in decision and decision["tool_calls"]:
        return list(decision["tool_calls"])
    msg = decision.get("message")
    if isinstance(msg, dict) and msg.get("tool_calls"):
        return list(msg["tool_calls"])
    return []


def _extract_from_object(decision: Any) -> List[Any]:
    """Extract native tool calls from ChatResponse-like objects.

    :param decision: Response object.
    :return: List of tool calls.
    """
    msg = getattr(decision, "message", None)
    if msg is not None and hasattr(msg, "tool_calls"):
        return list(msg.tool_calls or [])
    if hasattr(decision, "tool_calls"):
        return list(decision.tool_calls or [])
    return []


def _extract_native_tool_calls(decision: Any) -> List[Any]:
    """Extract native tool calls from Ollama chat response objects.

    :param decision: Agent decision object or dictionary.
    :return: List of native tool calls if present.
    """
    if isinstance(decision, dict):
        return _extract_from_dict(decision)
    return _extract_from_object(decision)


def _parse_json_args_str(raw_args: str) -> Dict[str, Any]:
    """Safely parse JSON-encoded string arguments.

    :param raw_args: JSON string to decode.
    :return: Parsed arguments dictionary.
    """
    try:
        parsed = json.loads(raw_args)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, ValueError):
        return {}


def _ensure_dict_args(raw_args: Any) -> Dict[str, Any]:
    """Normalize raw tool arguments into a dictionary.

    :param raw_args: Raw arguments (dict or JSON string).
    :return: Dictionary of parsed arguments.
    """
    if isinstance(raw_args, dict):
        return dict(raw_args)
    if isinstance(raw_args, str):
        return _parse_json_args_str(raw_args)
    return {}


def _extract_call_action(decision: Dict[str, Any]) -> Dict[str, Any]:
    """Extract tool call action details from dictionary.

    :param decision: Raw action dictionary.
    :return: Standardized call action dictionary.
    """
    tool_name = str(decision.get("tool") or decision.get("name") or "")
    raw_args = decision.get("args") or decision.get("arguments") or {}
    args = _ensure_dict_args(raw_args)
    return {"action": "call", "tool": tool_name, "args": args, "report": {}}


def _extract_final_action(decision: Dict[str, Any]) -> Dict[str, Any]:
    """Extract final answer report from dictionary.

    :param decision: Raw final answer dictionary.
    :return: Standardized final answer dictionary.
    """
    report = decision.get("report") if "report" in decision else decision
    valid_report = report if isinstance(report, dict) else {}
    return {
        "action": "final_answer",
        "tool": "",
        "args": {},
        "report": valid_report,
    }


def _format_dict_decision(decision: Dict[str, Any]) -> Dict[str, Any]:
    """Format structured dictionary decision.

    :param decision: Decision dictionary from agent.
    :return: Standardized action dictionary.
    """
    action = str(decision.get("action", "")).lower()
    if action in ("call", "call_tool"):
        return _extract_call_action(decision)
    return _extract_final_action(decision)


def _format_native_call(tool_call: Any) -> Dict[str, Any]:
    """Format an Ollama native function call object.

    :param tool_call: Native tool call object or dict.
    :return: Standardized action dictionary.
    """
    func = (
        tool_call.get("function", {})
        if isinstance(tool_call, dict)
        else getattr(tool_call, "function", {})
    )
    name = func.get("name", "") if isinstance(func, dict) else getattr(func, "name", "")
    raw_args = (
        func.get("arguments", {})
        if isinstance(func, dict)
        else getattr(func, "arguments", {})
    )
    return {
        "action": "call",
        "tool": str(name),
        "args": _ensure_dict_args(raw_args),
        "report": {},
    }


class ProgressiveInvestigationLoop:
    """Bounded multi-turn progressive tool-calling loop for specialist agents.

    Allows specialist agents to evaluate initial evidence, request dynamic
    tool executions, inspect results, and recursively reason across up to
    max_turns. Automatically records all tool calls to the EvidenceStore.
    """

    def __init__(
        self,
        tool_registry: Optional[ToolRegistry] = None,
        evidence_store: Optional[EvidenceStore] = None,
        max_turns: int = DEFAULT_MAX_TURNS,
    ) -> None:
        """Initialize the progressive investigation loop.

        :param tool_registry: ToolRegistry instance managing read-only cluster tools.
        :param evidence_store: EvidenceStore instance for audit provenance tracking.
        :param max_turns: Maximum number of investigation reasoning turns (default: 3).
        """
        self.tools: ToolRegistry = (
            tool_registry if tool_registry is not None else ToolRegistry()
        )
        self.store: EvidenceStore = (
            evidence_store if evidence_store is not None else EvidenceStore()
        )
        self._link_store_if_needed()
        self.max_turns: int = max(1, int(max_turns))
        self.turn_history: List[Dict[str, Any]] = []

    def _link_store_if_needed(self) -> None:
        """Link store to tools registry if unassigned."""
        if hasattr(self.tools, "store") and self.tools.store is None:
            self.tools.store = self.store

    async def run_agent_loop(
        self,
        agent: Any,
        bundle: Optional[EvidenceBundle] = None,
    ) -> Dict[str, Any]:
        """Run progressive multi-turn investigation loop for a specialist agent.

        :param agent: Specialist agent instance to execute.
        :param bundle: Evidence bundle containing current workload facts.
        :return: Synthesized specialist report dictionary.
        """
        history: List[Dict[str, Any]] = []
        self.turn_history = history

        for turn in range(self.max_turns):
            decision = await self._evaluate_step(agent, bundle, history)
            parsed = self._parse_decision(decision)
            if parsed["action"] == "final_answer":
                return parsed["report"]
            await self._execute_and_record(
                agent, parsed["tool"], parsed["args"], history
            )

        return await self._force_synthesis(agent, bundle, history)

    async def _evaluate_step(
        self,
        agent: Any,
        bundle: Optional[EvidenceBundle],
        history: List[Dict[str, Any]],
    ) -> Any:
        """Evaluate the agent's next step in the loop.

        :param agent: Specialist agent instance.
        :param bundle: Current evidence bundle.
        :param history: Prior tool call history.
        :return: Raw decision returned by the agent.
        """
        eval_fn = getattr(agent, "evaluate_next_step", None)
        if eval_fn is None:
            return {"action": "final_answer", "report": await self._fallback_report(agent, bundle)}
        result = eval_fn(bundle, history)
        if inspect.isawaitable(result):
            return await result
        return result

    def _parse_decision(self, decision: Any) -> Dict[str, Any]:
        """Parse and standardize raw agent decision into action and parameters.

        :param decision: Raw output from agent evaluate_next_step.
        :return: Standardized decision dictionary.
        """
        native_calls = _extract_native_tool_calls(decision)
        if native_calls:
            return _format_native_call(native_calls[0])
        if isinstance(decision, dict):
            return _format_dict_decision(decision)
        return {"action": "final_answer", "tool": "", "args": {}, "report": {}}

    async def _execute_and_record(
        self,
        agent: Any,
        tool_name: str,
        args: Dict[str, Any],
        history: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Execute requested tool safely and record in store and history.

        :param agent: Specialist agent requesting the call.
        :param tool_name: Registered tool name to invoke.
        :param args: Keyword arguments for the tool.
        :param history: Turn history list to append to.
        :return: History entry dictionary.
        """
        role = getattr(agent, "role", "specialist")
        start_time = time.time()
        tool_res, err, status = await self._safe_execute_tool(tool_name, args, role)
        duration_ms = int(round((time.time() - start_time) * 1000))

        record = ToolCallRecord(
            agent_role=role,
            tool_name=tool_name,
            arguments=args,
            result=tool_res,
            error=err,
            started_at=start_time,
            duration_ms=duration_ms,
            status=status,
        )
        self._audit_tool_record(record)

        entry = {"tool": tool_name, "args": args, "result": tool_res}
        history.append(entry)
        return entry

    async def _safe_execute_tool(
        self,
        tool_name: str,
        args: Dict[str, Any],
        role: str,
    ) -> Tuple[Any, Optional[str], str]:
        """Safely invoke tool capturing exceptions and timeouts.

        :param tool_name: Name of tool to execute.
        :param args: Tool arguments dictionary.
        :param role: Agent role name.
        :return: Tuple of (result, error_str, status_str).
        """
        try:
            res = await self._call_tool(tool_name, args, role)
            if isinstance(res, dict) and "error" in res:
                return res, str(res["error"]), "error"
            return res, None, "success"
        except Exception as exc:
            err_msg = str(exc)
            return {"error": err_msg}, err_msg, "error"

    async def _call_tool(
        self,
        tool_name: str,
        args: Dict[str, Any],
        role: str,
    ) -> Any:
        """Invoke tool registry execute with appropriate arguments.

        :param tool_name: Tool name.
        :param args: Keyword arguments.
        :param role: Specialist agent role.
        :return: Result from tool registry execute.
        """
        sig = inspect.signature(self.tools.execute)
        call_kwargs = dict(args)
        if "agent_role" in sig.parameters:
            call_kwargs["agent_role"] = role
        if "store" in sig.parameters:
            call_kwargs["store"] = self.store
        return await self.tools.execute(tool_name, **call_kwargs)

    def _is_duplicate_call(self, record: ToolCallRecord) -> bool:
        """Check if tool call was already recorded during execution.

        :param record: ToolCallRecord to check.
        :return: True if duplicate record exists.
        """
        if not hasattr(self.store, "get_tool_calls"):
            return False
        calls = self.store.get_tool_calls()
        if not calls:
            return False
        last = calls[-1]
        is_same = last.tool_name == record.tool_name
        is_current = last.started_at >= record.started_at
        return is_same and is_current

    def _audit_tool_record(self, record: ToolCallRecord) -> None:
        """Record tool execution audit trail if not already stored.

        :param record: Completed ToolCallRecord.
        """
        if not hasattr(self.store, "record_tool_call"):
            return
        if self._is_duplicate_call(record):
            return
        self.store.record_tool_call(record)

    async def _force_synthesis(
        self,
        agent: Any,
        bundle: Optional[EvidenceBundle],
        history: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Force agent to produce final synthesis when max_turns is reached.

        :param agent: Specialist agent instance.
        :param bundle: Evidence bundle.
        :param history: Prior tool call history.
        :return: Synthesized specialist report.
        """
        synth_fn = getattr(agent, "force_synthesis", None)
        if synth_fn is None:
            return await self._fallback_report(agent, bundle)

        sig = inspect.signature(synth_fn)
        if "instruction" in sig.parameters:
            res = synth_fn(bundle, history, instruction=MAX_DEPTH_INSTRUCTION)
        else:
            res = synth_fn(bundle, history)

        if inspect.isawaitable(res):
            return await res
        return res

    async def _fallback_report(
        self,
        agent: Any,
        bundle: Optional[EvidenceBundle],
    ) -> Dict[str, Any]:
        """Generate fallback diagnosis if agent lacks synthesis handler.

        :param agent: Specialist agent instance.
        :param bundle: Evidence bundle.
        :return: Fallback report dictionary.
        """
        investigate_fn = getattr(agent, "run_investigation", None)
        if investigate_fn is not None:
            res = investigate_fn(bundle)
            if inspect.isawaitable(res):
                return await res
            return res
        return {
            "summary": "Max investigation depth reached. Diagnosis based on current facts.",
            "evidence": [],
            "hypotheses": [],
            "confidence": "low",
        }
