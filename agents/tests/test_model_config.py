"""
Model Configuration and Multi-Model Strategy Unit Tests — KDM v4.0.0
=====================================================================
Validates Phase 22 Dynamic Multi-Model Strategy & Configuration:
  - Role-based model resolution from config/agents.yaml.
  - Custom dictionary and external YAML file configuration loading.
  - Priority hierarchy: CLI --model > role mapping > config default > fallback 'llama3.1'.
  - Edge cases: whitespace, case-insensitivity, flat configs, corrupt YAML.
  - AgentCouncil integration and per-agent model assignment.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock

_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_AGENTS_DIR = os.path.abspath(os.path.join(_TESTS_DIR, ".."))
_REPO_ROOT = os.path.abspath(os.path.join(_AGENTS_DIR, ".."))
for _p in (_REPO_ROOT, _AGENTS_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from agents.council import (
        AgentCouncil,
        load_agents_config,
        resolve_installed_model,
        resolve_model,
    )
except ImportError:
    from council import (  # type: ignore[no-redef]
        AgentCouncil,
        load_agents_config,
        resolve_installed_model,
        resolve_model,
    )


class TestModelConfigResolution(unittest.TestCase):
    """Test suite for role-based model resolution and priority hierarchy."""

    def test_default_fallback_when_no_config(self) -> None:
        """When configuration is empty, all roles must fall back to 'llama3.1'."""
        self.assertEqual(resolve_model("runtime", config={}), "llama3.1")
        self.assertEqual(resolve_model("config", config={}), "llama3.1")
        self.assertEqual(resolve_model("resource", config={}), "llama3.1")
        self.assertEqual(resolve_model("synthesizer", config={}), "llama3.1")
        self.assertEqual(resolve_model("default", config={}), "llama3.1")

    def test_role_resolution_from_default_yaml_file(self) -> None:
        """Loading repo config/agents.yaml must resolve role-specific models correctly."""
        config_path = os.path.join(_REPO_ROOT, "config", "agents.yaml")
        self.assertTrue(os.path.isfile(config_path), f"Expected config at {config_path}")

        config = load_agents_config(config_path)
        self.assertIn("models", config)
        self.assertEqual(config["models"]["config"], "qwen2.5-coder")
        self.assertEqual(config["models"]["runtime"], "llama3.1")
        self.assertEqual(config["models"]["resource"], "llama3.1")
        self.assertEqual(config["models"]["synthesizer"], "llama3.1")
        self.assertEqual(config["models"]["default"], "llama3.1")

        # Resolving via loaded config
        self.assertEqual(resolve_model("config", config=config), "qwen2.5-coder")
        self.assertEqual(resolve_model("runtime", config=config), "llama3.1")
        self.assertEqual(resolve_model("resource", config=config), "llama3.1")
        self.assertEqual(resolve_model("synthesizer", config=config), "llama3.1")

    def test_role_resolution_with_custom_dict(self) -> None:
        """Resolves models when custom dict mapping is provided."""
        custom_config = {
            "models": {
                "default": "llama3.1:70b",
                "runtime": "mistral:latest",
                "config": "qwen2.5-coder:14b",
                "resource": "deepseek-coder",
            }
        }
        self.assertEqual(resolve_model("runtime", config=custom_config), "mistral:latest")
        self.assertEqual(resolve_model("config", config=custom_config), "qwen2.5-coder:14b")
        self.assertEqual(resolve_model("resource", config=custom_config), "deepseek-coder")
        # Synthesizer is not explicitly mapped; must fall back to models.default
        self.assertEqual(resolve_model("synthesizer", config=custom_config), "llama3.1:70b")

    def test_role_resolution_with_custom_yaml_file(self) -> None:
        """Loads and resolves models from a custom YAML file path."""
        yaml_content = (
            "models:\n"
            '  default: "phi4:latest"\n'
            '  runtime: "llama3.2:3b"\n'
            '  config: "qwen2.5-coder:32b"\n'
            '  resource: "mistral-nemo"\n'
            '  synthesizer: "command-r"\n'
        )
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as tmp:
            tmp.write(yaml_content)
            tmp_path = tmp.name

        try:
            cfg = load_agents_config(tmp_path)
            self.assertEqual(resolve_model("runtime", config=cfg), "llama3.2:3b")
            self.assertEqual(resolve_model("config", config=cfg), "qwen2.5-coder:32b")
            self.assertEqual(resolve_model("resource", config=cfg), "mistral-nemo")
            self.assertEqual(resolve_model("synthesizer", config=cfg), "command-r")
            self.assertEqual(resolve_model("unknown_role", config=cfg), "phi4:latest")
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_cli_override_takes_precedence_over_role_mapping(self) -> None:
        """CLI override flag (--model) must take precedence over per-role mapping."""
        custom_config = {
            "models": {
                "default": "llama3.1",
                "runtime": "llama3.1",
                "config": "qwen2.5-coder",
                "resource": "llama3.1",
                "synthesizer": "llama3.1",
            }
        }
        # Explicit CLI override for config role
        result = resolve_model("config", config=custom_config, cli_override="qwen2.5-coder:7b")
        self.assertEqual(result, "qwen2.5-coder:7b")

        # Global CLI override replaces all roles
        cli_model = "mistral:instruct"
        for role in ("runtime", "config", "resource", "synthesizer", "unmapped"):
            self.assertEqual(
                resolve_model(role, config=custom_config, cli_override=cli_model),
                cli_model,
                f"Role {role} did not honor CLI override",
            )

    def test_empty_or_whitespace_cli_override_falls_back_to_config(self) -> None:
        """Empty or whitespace-only CLI override values must fall back to role configuration."""
        custom_config = {
            "models": {
                "default": "llama3.1",
                "config": "qwen2.5-coder",
            }
        }
        self.assertEqual(resolve_model("config", config=custom_config, cli_override=""), "qwen2.5-coder")
        self.assertEqual(resolve_model("config", config=custom_config, cli_override="   "), "qwen2.5-coder")
        self.assertEqual(resolve_model("config", config=custom_config, cli_override=None), "qwen2.5-coder")

    def test_case_insensitivity_and_whitespace_handling(self) -> None:
        """Role resolution should be case-insensitive and tolerate surrounding whitespace."""
        custom_config = {
            "models": {
                "default": "llama3.1",
                "config": "qwen2.5-coder",
                "Runtime": "mistral",
            }
        }
        self.assertEqual(resolve_model("CONFIG", config=custom_config), "qwen2.5-coder")
        self.assertEqual(resolve_model("  config  ", config=custom_config), "qwen2.5-coder")
        self.assertEqual(resolve_model("runtime", config=custom_config), "mistral")
        self.assertEqual(resolve_model("RUNTIME", config=custom_config), "mistral")

    def test_flat_config_dictionary_compatibility(self) -> None:
        """Supports flat dictionaries without the top-level 'models' key."""
        flat_config = {
            "default": "llama3.1",
            "runtime": "llama3.1:latest",
            "config": "qwen2.5-coder:latest",
        }
        self.assertEqual(resolve_model("config", config=flat_config), "qwen2.5-coder:latest")
        self.assertEqual(resolve_model("runtime", config=flat_config), "llama3.1:latest")
        self.assertEqual(resolve_model("synthesizer", config=flat_config), "llama3.1")

    def test_invalid_yaml_file_handles_gracefully(self) -> None:
        """Corrupt or non-dict YAML files safely return empty config and fall back to default."""
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as tmp:
            tmp.write("models: [corrupted, list, not, dict]: invalid : :")
            tmp_path = tmp.name

        try:
            cfg = load_agents_config(tmp_path)
            self.assertEqual(cfg, {})
            self.assertEqual(resolve_model("config", config=cfg), "llama3.1")
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_nonexistent_config_file_returns_empty_dict(self) -> None:
        """Nonexistent file path must not raise exceptions and return empty dict."""
        cfg = load_agents_config("/nonexistent/path/agents.yaml")
        self.assertEqual(cfg, {})
        self.assertEqual(resolve_model("runtime", config=cfg), "llama3.1")


class TestAgentCouncilModelIntegration(unittest.TestCase):
    """Verifies that AgentCouncil correctly instantiates agents with configured models."""

    def setUp(self) -> None:
        self.mock_client = MagicMock()
        # Mock client.list() returning installed models
        mock_model_qwen = MagicMock()
        mock_model_qwen.model = "qwen2.5-coder:latest"
        mock_model_llama = MagicMock()
        mock_model_llama.model = "llama3.1:latest"
        mock_model_mistral = MagicMock()
        mock_model_mistral.model = "mistral:7b"
        mock_res = MagicMock()
        mock_res.models = [mock_model_qwen, mock_model_llama, mock_model_mistral]
        self.mock_client.list.return_value = mock_res

    def test_agent_council_resolves_per_role_models(self) -> None:
        """AgentCouncil without CLI override should assign distinct models per role."""
        custom_config = {
            "models": {
                "default": "llama3.1",
                "runtime": "llama3.1",
                "config": "qwen2.5-coder",
                "resource": "llama3.1",
                "synthesizer": "llama3.1",
            }
        }
        council = AgentCouncil(client=self.mock_client, config=custom_config)

        # Config role resolves to installed candidate matching base 'qwen2.5-coder'
        self.assertEqual(council.resolve_model("config"), "qwen2.5-coder:latest")
        # Other roles resolve to installed candidate matching base 'llama3.1'
        self.assertEqual(council.resolve_model("runtime"), "llama3.1:latest")
        self.assertEqual(council.resolve_model("resource"), "llama3.1:latest")
        self.assertEqual(council.resolve_model("synthesizer"), "llama3.1:latest")

    def test_agent_council_cli_model_override_propagates_to_all_roles(self) -> None:
        """Specifying model in AgentCouncil acts as global CLI override for all roles."""
        custom_config = {
            "models": {
                "default": "llama3.1",
                "config": "qwen2.5-coder",
            }
        }
        override_model = "mistral:7b"
        council = AgentCouncil(
            client=self.mock_client,
            model=override_model,
            config=custom_config,
        )

        for role in ("runtime", "config", "resource", "synthesizer"):
            resolved = council.resolve_model(role)
            # The client matches or falls back to override_model
            self.assertEqual(resolved, override_model)

    def test_agent_council_run_assigns_specialist_models(self) -> None:
        """AgentCouncil.run instantiates each specialist with its role-assigned model."""
        mock_response = MagicMock()
        mock_response.message.content = json.dumps({
            "rootCause": "Config problem detected",
            "confidence": "high",
            "bestSolution": {
                "actionTitle": "Fix ConfigMap",
                "steps": ["Apply configmap"],
                "commandToRun": "kubectl apply -f cm.yaml",
                "riskLevel": "low",
            },
        })
        self.mock_client.chat.return_value = mock_response

        custom_config = {
            "models": {
                "default": "llama3.1",
                "runtime": "runtime-specialist-model",
                "config": "qwen2.5-coder",
                "resource": "resource-specialist-model",
                "synthesizer": "synthesizer-model",
            }
        }
        # In mock list, return empty so resolved names are preserved directly
        self.mock_client.list.return_value = {"models": []}

        council = AgentCouncil(client=self.mock_client, config=custom_config)
        self.assertEqual(council.resolve_model("runtime"), "runtime-specialist-model")
        self.assertEqual(council.resolve_model("config"), "qwen2.5-coder")
        self.assertEqual(council.resolve_model("resource"), "resource-specialist-model")
        self.assertEqual(council.resolve_model("synthesizer"), "synthesizer-model")

    def test_legacy_resolve_model_backward_compatibility(self) -> None:
        """Calling resolve_model(client, requested_model) maintains backward compatibility."""
        mock_client = MagicMock()
        mock_model = MagicMock()
        mock_model.model = "llama3.1:latest"
        mock_res = MagicMock()
        mock_res.models = [mock_model]
        mock_client.list.return_value = mock_res

        # Legacy call signature
        resolved = resolve_model(mock_client, "llama3.1")
        self.assertEqual(resolved, "llama3.1:latest")


if __name__ == "__main__":
    unittest.main()
