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


if __name__ == "__main__":
    unittest.main()
