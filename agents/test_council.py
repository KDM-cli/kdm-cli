import sys
import os
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from specialists import (
    RuntimeLogAgent,
    ConfigDependencyAgent,
    ClusterResourceAgent,
    SynthesizerAgent,
)
from council import resolve_model


class MockChatResponse:
    def __init__(self, content: str):
        self.message = MagicMock(content=content)


class TestSpecialistAgents(unittest.TestCase):
    def setUp(self):
        self.mock_client = MagicMock()

    def test_runtime_log_agent(self):
        self.mock_client.chat.return_value = MockChatResponse(
            '{"summary": "Container was killed by OOMKiller (exit code 137).", "evidence": ["Exit status 137 detected"]}'
        )
        agent = RuntimeLogAgent(self.mock_client, "llama3.1")
        res = agent.analyze("Back-off restarting failed container", {"namespace": "default"})

        self.assertEqual(res["role"], "runtime")
        self.assertIn("OOMKiller", res["summary"])
        self.assertEqual(len(res["evidence"]), 1)

    def test_config_dependency_agent(self):
        self.mock_client.chat.return_value = MockChatResponse(
            '{"summary": "ConfigMap app-config is missing key DB_URL.", "evidence": ["KeyError in pod spec"]}'
        )
        agent = ConfigDependencyAgent(self.mock_client, "llama3.1")
        res = agent.analyze("Error creating pod: ConfigMap not found", {"namespace": "default"})

        self.assertEqual(res["role"], "config")
        self.assertIn("ConfigMap", res["summary"])

    def test_cluster_resource_agent(self):
        self.mock_client.chat.return_value = MockChatResponse(
            '{"summary": "Node worker-1 has MemoryPressure.", "evidence": ["Memory limit exceeded"]}'
        )
        agent = ClusterResourceAgent(self.mock_client, "llama3.1")
        res = agent.analyze("0/3 nodes are available: insufficient memory", {"namespace": "default"})

        self.assertEqual(res["role"], "resource")
        self.assertIn("MemoryPressure", res["summary"])

    def test_synthesizer_agent(self):
        self.mock_client.chat.return_value = MockChatResponse(
            '{"rootCause": "Container memory limit 256Mi was exceeded under peak load.", "confidence": "high", "bestSolution": {"actionTitle": "Increase Memory Limits", "steps": ["Bump limits.memory to 512Mi"], "commandToRun": "kubectl set resources deployment my-app --limits=memory=512Mi", "riskLevel": "low"}}'
        )
        agent = SynthesizerAgent(self.mock_client, "llama3.1")
        findings = [
            {"role": "runtime", "agentName": "Runtime Agent", "summary": "Exit code 137"},
            {"role": "config", "agentName": "Config Agent", "summary": "Probe ok"},
            {"role": "resource", "agentName": "Resource Agent", "summary": "Memory limit 256Mi hit"},
        ]
        res = agent.synthesize("OOMKilled", findings, {"name": "my-app"})

        self.assertIn("memory limit", res["rootCause"].lower())
        self.assertEqual(res["confidence"], "high")
        self.assertEqual(res["bestSolution"]["actionTitle"], "Increase Memory Limits")

    def test_markdown_code_fence_json(self):
        self.mock_client.chat.return_value = MockChatResponse(
            '```json\n{"summary": "Secret not found.", "evidence": ["secret app-secret missing"]}\n```'
        )
        agent = ConfigDependencyAgent(self.mock_client, "gemma:2b")
        res = agent.analyze("MountVolume failed: secret not found", {"namespace": "default"})
        self.assertEqual(res["summary"], "Secret not found.")
        self.assertEqual(len(res["evidence"]), 1)

    def test_domain_heuristic_fallback_missing_secret(self):
        self.mock_client.chat.side_effect = RuntimeError("Ollama server unavailable")
        agent = SynthesizerAgent(self.mock_client, "gemma:2b")
        findings = []
        res = agent.synthesize(
            'MountVolume.SetUp failed for volume "secret-volume" : secret "app-secret" not found',
            findings,
            {"name": "missing-secret-pod", "namespace": "prod"}
        )
        self.assertIn("app-secret", res["rootCause"])
        self.assertIn("Create Missing Secret 'app-secret'", res["bestSolution"]["actionTitle"])
        self.assertIn("kubectl create secret generic app-secret", res["bestSolution"]["commandToRun"])

    def test_domain_heuristic_fallback_missing_configmap_casing(self):
        self.mock_client.chat.side_effect = RuntimeError("Ollama server unavailable")
        agent = SynthesizerAgent(self.mock_client, "gemma:2b")
        findings = []
        res = agent.synthesize(
            'configmap "app-config" not found',
            findings,
            {"name": "my-pod", "namespace": "prod"}
        )
        self.assertIn("kubectl create configmap app-config -n prod --from-literal=KEY=VALUE", res["bestSolution"]["commandToRun"])

    def test_resolve_model_handles_none_and_embed_models(self):
        # Mock ollama list response with None model and embedding models
        mock_model_embed = MagicMock()
        mock_model_embed.model = "nomic-embed-text"
        mock_model_none = MagicMock()
        mock_model_none.model = None
        mock_model_none.name = None
        mock_model_chat = MagicMock()
        mock_model_chat.model = "llama3.1:latest"

        mock_res = MagicMock()
        mock_res.models = [mock_model_embed, mock_model_none, mock_model_chat]
        self.mock_client.list.return_value = mock_res

        # If requested model matches base name, it should resolve
        resolved = resolve_model(self.mock_client, "llama3.1")
        self.assertEqual(resolved, "llama3.1:latest")

        # Dict response with empty / missing values
        self.mock_client.list.return_value = {
            "models": [
                {"name": "nomic-embed-text"},
                {"model": None, "name": None},
                {"name": "qwen2.5:7b"},
            ]
        }
        resolved_dict = resolve_model(self.mock_client, "non-existent")
        self.assertEqual(resolved_dict, "qwen2.5:7b")


if __name__ == "__main__":
    unittest.main()
