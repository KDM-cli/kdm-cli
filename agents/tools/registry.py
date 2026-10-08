"""
Tool Registry — KDM v4.0.0
============================
Provides the :class:`ToolRegistry` decorator-based registry that:

* Exposes each tool as an Ollama-compatible JSON schema.
* Enforces a least-privilege whitelist — only registered (read-only) tools
  may be invoked.
* Wraps every execution in a 10-second ``asyncio`` timeout.

Usage
-----
.. code-block:: python

    from tools.registry import tool_registry

    @tool_registry.register("get_pod_status", "Return pod phase and container states")
    async def get_pod_status(namespace: str, pod: str) -> dict:
        ...
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

from core.sanitizer import redact_sensitive_data  # noqa: E402
from core.store import EvidenceStore, ToolCallRecord  # noqa: E402

# ---------------------------------------------------------------------------
# Timeout (seconds) applied to every tool execution.
# ---------------------------------------------------------------------------
_TOOL_TIMEOUT_SECONDS: float = 10.0

# ---------------------------------------------------------------------------
# Mapping of Python annotation objects to JSON schema type strings.
# Handles both actual type objects (int, bool, …) and string literals
# (e.g. "int") that Python 3.13 may produce for locally-defined functions.
# ---------------------------------------------------------------------------
_PY_TYPE_TO_JSON: Dict[Any, str] = {
    int: "integer",
    "int": "integer",
    bool: "boolean",
    "bool": "boolean",
    float: "number",
    "float": "number",
    str: "string",
    "str": "string",
}


def _json_type(annotation: Any) -> str:
    """Map a Python type annotation to its JSON schema type string.

    Accepts both actual type objects (``int``, ``bool``) and string
    annotations (``"int"``, ``"bool"``) which Python 3.13 may produce when
    introspecting locally-defined functions.

    Args:
        annotation: The Python type annotation to map.

    Returns:
        A JSON schema type string (``"string"`` by default for unknown types).
    """
    return _PY_TYPE_TO_JSON.get(annotation, "string")


def _build_param_schema(sig: inspect.Signature) -> Dict[str, Any]:
    """Construct the ``parameters`` block of an Ollama function schema.

    Args:
        sig: The :class:`inspect.Signature` of the tool implementation.

    Returns:
        A dict with ``type``, ``properties``, and ``required`` keys.
    """
    properties: Dict[str, Any] = {}
    required: List[str] = []
    for param in sig.parameters.values():
        properties[param.name] = {"type": _json_type(param.annotation)}
        if param.default is inspect.Parameter.empty:
            required.append(param.name)
    return {"type": "object", "properties": properties, "required": required}


def _build_tool_schema(
    name: str, description: str, sig: inspect.Signature
) -> Dict[str, Any]:
    """Build the full Ollama-compatible tool schema dict.

    Args:
        name: The tool's registered name.
        description: Human-readable description of the tool.
        sig: The :class:`inspect.Signature` of the tool implementation.

    Returns:
        A dict with ``type`` and ``function`` keys compatible with Ollama.
    """
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": _build_param_schema(sig),
        },
    }


class ToolRegistry:
    """Least-privilege, read-only async tool registry with audit logging.

    Tools are registered once via the :meth:`register` decorator and can
    only be invoked through :meth:`execute`, which enforces the whitelist,
    applies a hard execution timeout, and automatically records every
    invocation into an in-memory :class:`~core.store.EvidenceStore`.
    """

    def __init__(self, store: Optional[EvidenceStore] = None) -> None:
        """Initialise an empty registry.

        Args:
            store: Optional :class:`~core.store.EvidenceStore` instance. If omitted,
                a new in-memory store is created.
        """
        self._tools: Dict[str, Dict[str, Any]] = {}
        self._store: Optional[EvidenceStore] = (
            store if store is not None else EvidenceStore()
        )

    @property
    def store(self) -> Optional[EvidenceStore]:
        """Return the active :class:`~core.store.EvidenceStore`."""
        return self._store

    @store.setter
    def store(self, value: Optional[EvidenceStore]) -> None:
        """Set the active :class:`~core.store.EvidenceStore`."""
        self._store = value

    @property
    def evidence_store(self) -> Optional[EvidenceStore]:
        """Alias for :attr:`store`."""
        return self._store

    @evidence_store.setter
    def evidence_store(self, value: Optional[EvidenceStore]) -> None:
        """Alias for :attr:`store`."""
        self._store = value

    def register(self, name: str, description: str) -> Callable:
        """Decorator that registers an async function as a named tool.

        The function's signature is introspected to generate an Ollama-
        compatible JSON schema automatically.

        Args:
            name: The unique tool identifier used during invocation.
            description: A short human-readable description of the tool.

        Returns:
            A decorator that stores the function in the registry.
        """

        def decorator(func: Callable[..., Awaitable[Any]]) -> Callable:
            sig = inspect.signature(func)
            self._tools[name] = {
                "func": func,
                "schema": _build_tool_schema(name, description, sig),
            }
            return func

        return decorator

    async def execute(
        self,
        name: str,
        agent_role: str = "",
        store: Optional[EvidenceStore] = None,
        re_raise: bool = False,
        **kwargs: Any,
    ) -> Any:
        """Invoke a registered tool by name with the supplied keyword arguments.

        Automatically measures wall-clock duration in milliseconds, handles
        exceptions and timeouts, scrubs sensitive argument keys, and records
        the invocation into the active :class:`~core.store.EvidenceStore`.

        Args:
            name: The registered tool name to call.
            agent_role: Optional specialist agent role initiating the call (e.g. ``"runtime"``).
            store: Optional override :class:`~core.store.EvidenceStore` for this call.
            re_raise: When ``True``, re-raises unhandled tool exceptions after recording.
            **kwargs: Arguments forwarded to the tool implementation.

        Raises:
            ValueError: If *name* is not in the whitelist.

        Returns:
            The structured JSON-serialisable result produced by the tool, or
            an ``{"error": ...}`` dict on timeout, exception, or RBAC failure.
        """
        if name not in self._tools:
            raise ValueError(f"Unauthorized or unknown tool: {name}")

        func = self._tools[name]["func"]
        sig = inspect.signature(func)
        call_kwargs = dict(kwargs)
        if (
            "agent_role" in sig.parameters
            and "agent_role" not in call_kwargs
            and agent_role
        ):
            call_kwargs["agent_role"] = agent_role
        if "store" in sig.parameters and "store" not in call_kwargs and store:
            call_kwargs["store"] = store

        scrubbed_args = redact_sensitive_data(dict(kwargs))
        if not isinstance(scrubbed_args, dict):
            scrubbed_args = {}

        start_time = time.time()
        status = "pending"
        result: Any = None
        error: Optional[str] = None
        unhandled_exc: Optional[Exception] = None

        try:
            result = await asyncio.wait_for(
                func(**call_kwargs), timeout=_TOOL_TIMEOUT_SECONDS
            )
            if isinstance(result, dict) and "error" in result:
                status = "error"
                error = str(result["error"])
            else:
                status = "success"
        except asyncio.TimeoutError:
            status = "timed_out"
            error = f"Tool execution timed out after {int(_TOOL_TIMEOUT_SECONDS)}s"
            result = {"error": error}
        except Exception as exc:
            status = "error"
            error = str(exc)
            result = {"error": error}
            unhandled_exc = exc
        finally:
            duration_ms = int(round((time.time() - start_time) * 1000))
            record = ToolCallRecord(
                agent_role=agent_role,
                tool_name=name,
                arguments=scrubbed_args,
                result=result,
                error=error,
                started_at=start_time,
                duration_ms=duration_ms,
                status=status,
            )
            target_store = store if store is not None else self._store
            if target_store is not None:
                target_store.record_tool_call(record)

        if re_raise and unhandled_exc is not None:
            raise unhandled_exc

        return result

    def get_ollama_tools(self) -> List[Dict[str, Any]]:
        """Return all registered tool schemas in Ollama function-calling format.

        Returns:
            A list of schema dicts, one per registered tool.
        """
        return [entry["schema"] for entry in self._tools.values()]


async def _run_with_timeout(
    func: Callable[..., Awaitable[Any]],
    kwargs: Dict[str, Any],
) -> Any:
    """Execute *func* with *kwargs* bounded by :data:`_TOOL_TIMEOUT_SECONDS`.

    Args:
        func: The async tool implementation to call.
        kwargs: The keyword arguments to pass to *func*.

    Returns:
        The function result, or ``{"error": "Tool execution timed out after 10s"}``
        if the deadline is exceeded.
    """
    try:
        return await asyncio.wait_for(func(**kwargs), timeout=_TOOL_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        return {"error": "Tool execution timed out after 10s"}


# ---------------------------------------------------------------------------
# Module-level singleton — import and use this in all tool modules.
# ---------------------------------------------------------------------------
tool_registry = ToolRegistry()
