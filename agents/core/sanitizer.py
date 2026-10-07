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
    """Recursively walk *data* and replace values whose keys look sensitive.

    The function handles arbitrarily nested structures composed of
    ``dict``, ``list``, and scalar values.  Non-string dictionary keys that
    happen to match the pattern are also redacted (though this is uncommon).

    Args:
        data: The data structure to sanitise.  May be a ``dict``, ``list``,
              or any scalar type.  The original object is **not** mutated;
              a new structure is returned.

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

        >>> redact_sensitive_data("plain string")
        'plain string'
    """
    if isinstance(data, dict):
        return _redact_dict(data)
    if isinstance(data, list):
        return [redact_sensitive_data(item) for item in data]
    return data


def _redact_dict(data: dict) -> dict:
    """Return a new dict with sensitive values replaced.

    Args:
        data: A ``dict`` to sanitise.

    Returns:
        A sanitised copy of *data*.
    """
    result: dict = {}
    for key, value in data.items():
        str_key = str(key)
        if _is_sensitive_key(str_key):
            result[key] = REDACTED_PLACEHOLDER
        else:
            result[key] = redact_sensitive_data(value)
    return result
