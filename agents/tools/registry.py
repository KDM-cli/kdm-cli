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
from typing import Any, Awaitable, Callable, Dict, List

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


def _build_tool_schema(name: str, description: str, sig: inspect.Signature) -> Dict[str, Any]:
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
    """Least-privilege, read-only async tool registry.

    Tools are registered once via the :meth:`register` decorator and can
    only be invoked through :meth:`execute`, which enforces the whitelist
    and applies a hard execution timeout.
    """

    def __init__(self) -> None:
        """Initialise an empty registry."""
        self._tools: Dict[str, Dict[str, Any]] = {}

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

    async def execute(self, name: str, **kwargs: Any) -> Any:
        """Invoke a registered tool by name with the supplied keyword arguments.

        Args:
            name: The registered tool name to call.
            **kwargs: Arguments forwarded verbatim to the tool implementation.

        Raises:
            ValueError: If *name* is not in the whitelist.

        Returns:
            The structured JSON-serialisable result produced by the tool, or
            an ``{"error": ...}`` dict on timeout or RBAC failure.
        """
        if name not in self._tools:
            raise ValueError(f"Unauthorized or unknown tool: {name}")
        return await _run_with_timeout(self._tools[name]["func"], kwargs)

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
