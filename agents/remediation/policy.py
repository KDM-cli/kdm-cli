"""
Remediation Policy Engine — KDM v4.0.0
=====================================
Deterministic security policy gate enforcing strict command whitelisting and
blocking dangerous or destructive operations prior to cluster execution.
"""

from __future__ import annotations

import re
from typing import List, Optional, Tuple

BLOCKED_PATTERNS: List[str] = [
    r"\bdelete\s+namespace\b",
    r"\bdelete\s+node\b",
    r"\brm\s+-rf\b",
    r"\b--force\b",
    r"\b--grace-period=0\b",
]

ALLOWED_COMMAND_PREFIXES: List[str] = [
    "kubectl set resources",
    "kubectl scale",
    "kubectl rollout restart",
    "kubectl patch",
]


class PolicyEngine:
    """Security policy validator for cluster remediation commands.

    Under the KDM v4.0.0 architecture:
    - Diagnosis is automatic; mutation is deliberate and gated.
    - Commands matching blacklisted destructive patterns are blocked.
    - Only approved command prefixes are allowed for execution.
    """

    def __init__(
        self,
        blocked_patterns: Optional[List[str]] = None,
        allowed_prefixes: Optional[List[str]] = None,
    ) -> None:
        """Initialize the policy engine with pattern sets.

        :param blocked_patterns: Optional custom list of regex blocked patterns.
        :param allowed_prefixes: Optional custom list of allowed command prefixes.
        """
        self.blocked_patterns = (
            list(blocked_patterns) if blocked_patterns is not None else list(BLOCKED_PATTERNS)
        )
        self.allowed_prefixes = (
            list(allowed_prefixes) if allowed_prefixes is not None else list(ALLOWED_COMMAND_PREFIXES)
        )

    def _matches_blocked_pattern(self, pattern: str, command: str) -> bool:
        """Check whether a single pattern matches the given command.

        Handles word boundary nuances for flag prefixes (e.g., '--force').

        :param pattern: Regular expression pattern string.
        :param command: Target command string.
        :return: True if pattern matches, False otherwise.
        """
        if re.search(pattern, command, re.IGNORECASE):
            return True
        if r"\b--" in pattern:
            effective = pattern.replace(r"\b--", r"(?:^|\s|\b)--")
            if re.search(effective, command, re.IGNORECASE):
                return True
        return False

    def is_blocked(self, command: str) -> bool:
        """Check if command matches any blacklisted pattern.

        :param command: Command string to test.
        :return: True if command is blocked, False otherwise.
        """
        return any(self._matches_blocked_pattern(p, command) for p in self.blocked_patterns)

    def is_allowed_prefix(self, command: str) -> bool:
        """Check if command begins with a whitelisted prefix.

        :param command: Command string to test.
        :return: True if command begins with an allowed prefix, False otherwise.
        """
        stripped = command.strip()
        return any(stripped.startswith(prefix) for prefix in self.allowed_prefixes)

    def evaluate(self, command: str) -> bool:
        """Evaluate a cluster mutation command against security policy rules.

        Returns False if the command matches any blacklisted pattern or
        lacks an approved whitelisted prefix.

        :param command: The candidate command string.
        :return: True if the command satisfies all safety policies, False otherwise.
        """
        if not command or not isinstance(command, str):
            return False
        if self.is_blocked(command):
            return False
        return self.is_allowed_prefix(command)

    def evaluate_with_reason(self, command: str) -> Tuple[bool, Optional[str]]:
        """Evaluate command and return approval status with descriptive reason.

        :param command: The candidate command string.
        :return: Tuple of (approved: bool, reason: Optional[str]).
        """
        if not command or not isinstance(command, str):
            return False, "Command must be a non-empty string"
        if self.is_blocked(command):
            return False, "Command matches a blocked destructive pattern"
        if not self.is_allowed_prefix(command):
            return False, "Command does not begin with an authorized prefix"
        return True, None
