"""
Credential Sanitizer for KDM v4.0.0
=====================================
Provides recursive dictionary redaction utilities that scrub sensitive
credential data before it is stored in an :class:`~core.evidence.EvidenceItem`.

Sensitive keys are detected by a case-insensitive pattern that covers the most
common naming conventions used in Kubernetes secrets, environment variables,
and configuration maps.

Usage
-----
.. code-block:: python

    from core.sanitizer import redact_sensitive_data

    raw = {"DB_PASSWORD": "hunter2", "nested": {"api_key": "abc123"}}
    safe = redact_sensitive_data(raw)
    # {"DB_PASSWORD": "[REDACTED_BY_KDM]", "nested": {"api_key": "[REDACTED_BY_KDM]"}}
"""

from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------------------
# Sentinel value placed in place of redacted credentials.
# ---------------------------------------------------------------------------
REDACTED_PLACEHOLDER = "[REDACTED_BY_KDM]"

# ---------------------------------------------------------------------------
# Compiled regex that matches key names considered sensitive.
# The pattern is intentionally broad to avoid false negatives.
# ---------------------------------------------------------------------------
_SENSITIVE_KEY_PATTERN: re.Pattern[str] = re.compile(
    r"(?i)(password|secret|key|token|auth|credential|cert)",
    re.IGNORECASE,
)


def _is_sensitive_key(key: str) -> bool:
    """Return ``True`` if *key* matches the sensitive-key heuristic.

    Args:
        key: The dictionary key to evaluate.

    Returns:
        ``True`` when the key matches the sensitive pattern.
    """
    return bool(_SENSITIVE_KEY_PATTERN.search(key))


def redact_sensitive_data(data: Any) -> Any:
    """Traverse *data* using an explicit stack and replace sensitive values.

    The function handles arbitrarily nested structures composed of
    ``dict``, ``list``, and scalar values using an explicit stack to prevent
    :exc:`RecursionError` on deeply nested inputs. Sensitive dictionary keys
    as well as Kubernetes environment entries whose sibling ``name`` matches
    sensitive patterns have their values replaced by
    :data:`REDACTED_PLACEHOLDER`. The original object is **not** mutated;
    a new structure is returned.

    Args:
        data: The data structure to sanitise. May be a ``dict``, ``list``,
              or any scalar type.

    Returns:
        A sanitised copy of *data* with sensitive values replaced by
        :data:`REDACTED_PLACEHOLDER`.

    Examples:
        >>> redact_sensitive_data({"DB_PASSWORD": "s3cr3t"})
        {'DB_PASSWORD': '[REDACTED_BY_KDM]'}

        >>> redact_sensitive_data({"nested": {"api_key": "xyz"}})
        {'nested': {'api_key': '[REDACTED_BY_KDM]'}}

        >>> redact_sensitive_data([{"token": "abc"}, {"safe": "value"}])
        [{'token': '[REDACTED_BY_KDM]'}, {'safe': 'value'}]

        >>> redact_sensitive_data([{"name": "DB_PASSWORD", "value": "s3cr3t"}])
        [{'name': 'DB_PASSWORD', 'value': '[REDACTED_BY_KDM]'}]

        >>> redact_sensitive_data("plain string")
        'plain string'
    """
    if not isinstance(data, (dict, list)):
        return data

    if isinstance(data, dict):
        root: Any = {}
    else:
        root = [None] * len(data)

    stack = [(data, root)]

    while stack:
        src, dest = stack.pop()

        if isinstance(src, dict):
            sibling_name_sensitive = any(
                str(k).lower() == "name" and _is_sensitive_key(str(v))
                for k, v in src.items()
            )
            for key, value in src.items():
                str_key = str(key)
                if _is_sensitive_key(str_key) or (
                    sibling_name_sensitive and str_key.lower() == "value"
                ):
                    dest[key] = REDACTED_PLACEHOLDER
                elif isinstance(value, dict):
                    child_dict: dict = {}
                    dest[key] = child_dict
                    stack.append((value, child_dict))
                elif isinstance(value, list):
                    child_list: list = [None] * len(value)
                    dest[key] = child_list
                    stack.append((value, child_list))
                else:
                    dest[key] = value

        elif isinstance(src, list):
            for i, item in enumerate(src):
                if isinstance(item, dict):
                    child_dict = {}
                    dest[i] = child_dict
                    stack.append((item, child_dict))
                elif isinstance(item, list):
                    child_list = [None] * len(item)
                    dest[i] = child_list
                    stack.append((item, child_list))
                else:
                    dest[i] = item

    return root


def _redact_dict(data: dict) -> dict:
    """Return a new dict with sensitive values replaced using stack traversal.

    Args:
        data: A ``dict`` to sanitise.

    Returns:
        A sanitised copy of *data*.
    """
    return redact_sensitive_data(data)

