"""
Unit Tests — Credential Sanitizer (agents/core/sanitizer.py)
==============================================================
Tests cover:
  - Direct password, token, auth, cert redaction with case insensitivity.
  - Sibling 'name' pattern matching for Kubernetes envVars entries.
  - Deep nested structures without RecursionError (iterative stack traversal).
  - Immutability of input data and scalar passthrough.
"""

from __future__ import annotations

from core.evidence import CollectionStatus, EvidenceItem
from core.sanitizer import REDACTED_PLACEHOLDER, redact_sensitive_data


class TestSanitizer:
    """Test suite for credential redaction sanitizer."""

    def test_password_key_redacted(self) -> None:
        """Verify password key is redacted."""
        assert redact_sensitive_data({"password": "s3cr3t"}) == {"password": REDACTED_PLACEHOLDER}

    def test_token_key_redacted(self) -> None:
        """Verify token key is redacted."""
        assert redact_sensitive_data({"api_token": "abc"}) == {"api_token": REDACTED_PLACEHOLDER}

    def test_auth_key_redacted(self) -> None:
        """Verify authorization key is redacted."""
        assert redact_sensitive_data({"Authorization": "Bearer xyz"}) == {
            "Authorization": REDACTED_PLACEHOLDER
        }

    def test_case_insensitive(self) -> None:
        """Verify sensitive key matching is case-insensitive."""
        cases = {"PASSWORD": "a", "Secret": "b", "API_KEY": "c", "Token": "d"}
        result = redact_sensitive_data(cases)
        for k in cases:
            assert result[k] == REDACTED_PLACEHOLDER

    def test_safe_key_preserved(self) -> None:
        """Verify non-sensitive keys preserve their values intact."""
        assert redact_sensitive_data({"restartCount": 4}) == {"restartCount": 4}

    def test_nested_dict(self) -> None:
        """Verify redaction works correctly in nested dictionaries."""
        data = {"outer": {"DB_PASSWORD": "secret", "safe_field": "ok"}}
        result = redact_sensitive_data(data)
        assert result["outer"]["DB_PASSWORD"] == REDACTED_PLACEHOLDER
        assert result["outer"]["safe_field"] == "ok"

    def test_deeply_nested(self) -> None:
        """Verify redaction works across multiple levels of dictionary nesting."""
        data = {"level1": {"level2": {"level3": {"api_key": "deep_secret"}}}}
        result = redact_sensitive_data(data)
        assert result["level1"]["level2"]["level3"]["api_key"] == REDACTED_PLACEHOLDER

    def test_arbitrarily_deep_nesting_no_recursion_error(self) -> None:
        """Verify stack-based traversal handles deep nesting without RecursionError."""
        depth = 2000
        cur: dict = {"api_key": "secret_leaf"}
        for _ in range(depth):
            cur = {"child": cur}
        result = redact_sensitive_data(cur)
        target_node = result
        for _ in range(depth):
            target_node = target_node["child"]
        assert target_node["api_key"] == REDACTED_PLACEHOLDER

    def test_list_of_dicts(self) -> None:
        """Verify redaction applies inside lists of dictionaries."""
        data = [{"token": "abc"}, {"safe": "value"}]
        result = redact_sensitive_data(data)
        assert result[0]["token"] == REDACTED_PLACEHOLDER
        assert result[1]["safe"] == "value"

    def test_mixed_nested_structure(self) -> None:
        """Verify envVars sibling name matching and credentials redaction."""
        data = {
            "envVars": [
                {"name": "DB_HOST", "value": "localhost"},
                {"name": "DB_PASSWORD", "value": "supersecret"},
            ],
            "credentials": {"cert": "PEM...", "endpoint": "https://example.com"},
        }
        result = redact_sensitive_data(data)
        assert result["envVars"][0]["value"] == "localhost"
        assert result["envVars"][1]["value"] == REDACTED_PLACEHOLDER
        assert result["credentials"] == REDACTED_PLACEHOLDER

    def test_scalar_passthrough(self) -> None:
        """Verify primitive scalar values are returned unmodified."""
        assert redact_sensitive_data("plain string") == "plain string"
        assert redact_sensitive_data(42) == 42
        assert redact_sensitive_data(None) is None

    def test_original_not_mutated(self) -> None:
        """Verify original data structure is not mutated during redaction."""
        original = {"password": "secret", "safe": "data"}
        redact_sensitive_data(original)
        assert original["password"] == "secret"

    def test_cert_key_redacted(self) -> None:
        """Verify certificate keys are recognized as sensitive."""
        assert redact_sensitive_data({"tls_cert": "PEM_DATA"}) == {
            "tls_cert": REDACTED_PLACEHOLDER
        }

    def test_secret_in_evidence_item(self) -> None:
        """Verify integration of redaction before creating an EvidenceItem."""
        raw_env = {"DB_HOST": "db.svc", "DB_PASSWORD": "hunter2"}
        safe_env = redact_sensitive_data(raw_env)
        item = EvidenceItem(
            id="ev.secret.env",
            source="kubernetes_api",
            status=CollectionStatus.AVAILABLE,
            data=safe_env,
            timestamp="2026-09-11T12:00:00Z",
        )
        assert item.data["DB_PASSWORD"] == REDACTED_PLACEHOLDER
        assert item.data["DB_HOST"] == "db.svc"
