"""
Unit Tests — Structured Specialist Agents (agents/specialists/)
================================================================
Tests cover:
  - BaseSpecialistAgent initialization, contracts, format="json", and options={"temperature": 0.1}.
  - Robust JSON parsing, markdown code fences, malformed responses, and timeout/exception recovery.
  - RuntimeLogAgent system prompt, exit codes/signals/log extraction, and empty logs edge case.
  - ConfigDependencyAgent system prompt, manifest/probe inspection, and missing volume/secret events.
  - ClusterResourceAgent system prompt, node pressure conditions, QoS classes, and cgroup limits.
  - Standardized SpecialistReport schema compliance across all three domain specialists.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Optional
import unittest
from unittest.mock import MagicMock

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import (
        CollectionStatus,
        EvidenceBundle,
        EvidenceItem,
        Target,
    )
    from agents.specialists.base import FALLBACK_REPORT, BaseSpecialistAgent
    from agents.specialists.config import ConfigDependencyAgent
    from agents.specialists.resource import ClusterResourceAgent
    from agents.specialists.runtime import RuntimeLogAgent
except ImportError:
    from core.evidence import CollectionStatus, EvidenceBundle, EvidenceItem, Target  # type: ignore[no-redef]
    from specialists.base import FALLBACK_REPORT, BaseSpecialistAgent  # type: ignore[no-redef]
    from specialists.config import ConfigDependencyAgent  # type: ignore[no-redef]
    from specialists.resource import ClusterResourceAgent  # type: ignore[no-redef]
    from specialists.runtime import RuntimeLogAgent  # type: ignore[no-redef]


class MockChatResponse:
    """Mock container representing an Ollama chat response object."""

    def __init__(self, content: str) -> None:
        self.message = MagicMock(content=content)

    def __getitem__(self, item: str) -> Any:
        if item == "message":
            return {"content": self.message.content}
        raise KeyError(item)


def _make_bundle(
    workload_name: str = "order-api",
    container_name: Optional[str] = "api",
    namespace: str = "production",
) -> EvidenceBundle:
    """Helper to create a fresh EvidenceBundle for testing."""
    target = Target(
        workload_kind="Deployment",
        workload_name=workload_name,
        namespace=namespace,
        container_name=container_name,
    )
    return EvidenceBundle(target=target, collected_at="2026-10-09T00:00:00Z")


def _add_evidence(
    bundle: EvidenceBundle,
    item_id: str,
    data: Any,
    status: CollectionStatus = CollectionStatus.AVAILABLE,
) -> None:
    """Helper to populate an evidence item into an EvidenceBundle."""
    bundle.add(
        EvidenceItem(
            id=item_id,
            source="kubernetes_api",
            status=status,
            data=data,
        )
    )


class ConcreteTestAgent(BaseSpecialistAgent):
    """Concrete subclass for testing BaseSpecialistAgent behaviors."""

    role = "test_role"
    display_name = "Test Agent"
    icon = "🧪"

    def build_prompt(self, bundle: EvidenceBundle) -> str:
        return f"Investigate workload {bundle.target.workload_name}"

    def get_system_prompt(self) -> str:
        return "You are a test diagnostic agent. Return valid JSON."


class TestBaseSpecialistAgent(unittest.TestCase):
    """Tests for :class:`~specialists.base.BaseSpecialistAgent` contract and error handling."""

    def setUp(self) -> None:
        self.mock_client = MagicMock()
        self.agent = ConcreteTestAgent(self.mock_client, model="llama3.1")

    def test_abstract_class_cannot_be_instantiated(self) -> None:
        """Verify BaseSpecialistAgent cannot be instantiated directly without abstract methods."""
        with self.assertRaises(TypeError):
            BaseSpecialistAgent(self.mock_client, model="llama3.1")  # type: ignore[abstract]

    def test_run_investigation_success_and_parameters(self) -> None:
        """Verify run_investigation passes model, format='json', and options to client.chat()."""
        payload = {
            "summary": "Root cause identified.",
            "evidence": ["Fact A", "Fact B"],
            "hypotheses": ["Hypothesis 1"],
            "confidence": "high",
        }
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps(payload)}
        }

        bundle = _make_bundle()
        report = self.agent.run_investigation(bundle)

        self.mock_client.chat.assert_called_once_with(
            model="llama3.1",
            messages=[
                {
                    "role": "system",
                    "content": "You are a test diagnostic agent. Return valid JSON.",
                },
                {"role": "user", "content": "Investigate workload order-api"},
            ],
            format="json",
            options={"temperature": 0.1},
        )
        self.assertEqual(report["summary"], "Root cause identified.")
        self.assertEqual(report["evidence"], ["Fact A", "Fact B"])
        self.assertEqual(report["hypotheses"], ["Hypothesis 1"])
        self.assertEqual(report["confidence"], "high")

    def test_run_investigation_with_chat_response_object(self) -> None:
        """Verify run_investigation parses ChatResponse objects using attribute access."""
        payload = {
            "summary": "Process terminated normally.",
            "evidence": ["Exit 0"],
            "hypotheses": [],
            "confidence": "low",
        }
        self.mock_client.chat.return_value = MockChatResponse(json.dumps(payload))

        bundle = _make_bundle()
        report = self.agent.run_investigation(bundle)
        self.assertEqual(report["summary"], "Process terminated normally.")
        self.assertEqual(report["confidence"], "low")

    def test_markdown_code_fence_stripping(self) -> None:
        """Verify markdown code fences surrounding JSON are cleanly stripped and parsed."""
        fenced_json = '```json\n{"summary": "Fenced summary", "evidence": [], "hypotheses": [], "confidence": "medium"}\n```'
        self.mock_client.chat.return_value = {"message": {"content": fenced_json}}

        report = self.agent.run_investigation(_make_bundle())
        self.assertEqual(report["summary"], "Fenced summary")
        self.assertEqual(report["confidence"], "medium")

    def test_malformed_json_recovery(self) -> None:
        """Verify malformed JSON responses recover gracefully with fallback report."""
        malformed_inputs = [
            "This is not json at all",
            '{"summary": "Incomplete json',
            "",
            "42",
            "[1, 2, 3]",
        ]
        bundle = _make_bundle()
        for raw in malformed_inputs:
            with self.subTest(raw=raw):
                self.mock_client.chat.return_value = {"message": {"content": raw}}
                report = self.agent.run_investigation(bundle)
                self.assertEqual(report, FALLBACK_REPORT)
                self.assertEqual(report["confidence"], "low")
                self.assertEqual(report["summary"], "Agent output parsing failed")

    def test_ollama_timeout_and_exceptions_recovery(self) -> None:
        """Verify Ollama timeouts and network exceptions recover gracefully with fallback report."""
        bundle = _make_bundle()
        for exc in (
            TimeoutError("Connection timed out"),
            RuntimeError("Ollama service unavailable"),
            KeyError("message"),
        ):
            with self.subTest(exc=type(exc).__name__):
                self.mock_client.chat.side_effect = exc
                report = self.agent.run_investigation(bundle)
                self.assertEqual(report["confidence"], "low")
                self.assertEqual(report["summary"], "Agent output parsing failed")
                self.assertEqual(report["evidence"], [])
                self.assertEqual(report["hypotheses"], [])

    def test_none_bundle_handling(self) -> None:
        """Verify None evidence bundle returns fallback report immediately."""
        report = self.agent.run_investigation(None)  # type: ignore[arg-type]
        self.assertEqual(report, FALLBACK_REPORT)

    def test_report_normalization(self) -> None:
        """Verify non-list evidence/hypotheses and unexpected confidence are normalized."""
        self.mock_client.chat.return_value = {
            "message": {
                "content": json.dumps(
                    {
                        "summary": "Custom report",
                        "evidence": "Single fact string",
                        "hypotheses": "Single hypothesis",
                        "confidence": "UNKNOWN_VALUE",
                    }
                )
            }
        }
        report = self.agent.run_investigation(_make_bundle())
        self.assertEqual(report["evidence"], ["Single fact string"])
        self.assertEqual(report["hypotheses"], ["Single hypothesis"])
        self.assertEqual(report["confidence"], "low")


class TestRuntimeLogAgent(unittest.TestCase):
    """Tests for :class:`~specialists.runtime.RuntimeLogAgent` domain diagnostics."""

    def setUp(self) -> None:
        self.mock_client = MagicMock()
        self.agent = RuntimeLogAgent(self.mock_client, model="llama3.1")

    def test_metadata_and_system_prompt(self) -> None:
        """Verify agent metadata and role persona constraints."""
        self.assertEqual(self.agent.role, "runtime")
        self.assertEqual(self.agent.display_name, "Runtime & Log Agent")
        self.assertEqual(self.agent.icon, "🔍")

        sys_prompt = self.agent.get_system_prompt()
        self.assertIn(
            "Senior Linux & Container Runtime Diagnostics Specialist", sys_prompt
        )
        self.assertIn("137 OOMKilled", sys_prompt)
        self.assertIn("exit codes", sys_prompt)
        self.assertIn("no previous crash log was persisted", sys_prompt)

    def test_build_prompt_empty_logs_edge_case(self) -> None:
        """Verify empty or unavailable logs are explicitly noted rather than hallucinated."""
        bundle = _make_bundle()
        # Empty previous logs
        _add_evidence(
            bundle, "ev.pod.logs.previous", "", status=CollectionStatus.UNAVAILABLE
        )

        prompt = self.agent.build_prompt(bundle)
        self.assertIn(
            "No previous crash log was persisted (empty or unavailable)", prompt
        )

    def test_build_prompt_with_exit_code_and_logs(self) -> None:
        """Verify build_prompt extracts exit code 137 and log snippet."""
        bundle = _make_bundle(container_name="api")
        _add_evidence(
            bundle,
            "ev.pod.container.status",
            {
                "containerStatuses": [
                    {
                        "name": "api",
                        "restartCount": 3,
                        "lastState": {
                            "terminated": {"exitCode": 137, "reason": "OOMKilled"}
                        },
                    }
                ]
            },
        )
        _add_evidence(
            bundle,
            "ev.pod.logs.previous",
            "fatal: out of memory allocating 512MB\nKilled",
        )
        _add_evidence(
            bundle,
            "ev.pod.events",
            [
                {
                    "reason": "BackOff",
                    "message": "Back-off restarting failed container api",
                }
            ],
        )

        prompt = self.agent.build_prompt(bundle)
        self.assertIn("exitCode: 137", prompt)
        self.assertIn("OOMKilled", prompt)
        self.assertIn("fatal: out of memory", prompt)
        self.assertIn("Back-off restarting failed container", prompt)

    def test_run_investigation_healthy_case(self) -> None:
        """Verify healthy runtime report conforms to low confidence schema."""
        healthy_response = {
            "summary": "No runtime crashes or non-zero exit codes detected.",
            "evidence": ["Container exitCode == 0"],
            "hypotheses": [],
            "confidence": "low",
        }
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps(healthy_response)}
        }

        bundle = _make_bundle()
        report = self.agent.run_investigation(bundle)
        self.assertEqual(
            report["summary"], "No runtime crashes or non-zero exit codes detected."
        )
        self.assertEqual(report["evidence"], ["Container exitCode == 0"])
        self.assertEqual(report["hypotheses"], [])
        self.assertEqual(report["confidence"], "low")


class TestConfigDependencyAgent(unittest.TestCase):
    """Tests for :class:`~specialists.config.ConfigDependencyAgent` domain diagnostics."""

    def setUp(self) -> None:
        self.mock_client = MagicMock()
        self.agent = ConfigDependencyAgent(self.mock_client, model="llama3.1")

    def test_metadata_and_system_prompt(self) -> None:
        """Verify agent metadata and declarative configuration persona."""
        self.assertEqual(self.agent.role, "config")
        self.assertEqual(self.agent.display_name, "Config & Dependency Agent")
        self.assertEqual(self.agent.icon, "⚙️")

        sys_prompt = self.agent.get_system_prompt()
        self.assertIn("Kubernetes Declarative Configuration Specialist", sys_prompt)
        self.assertIn("ConfigMap and Secret references", sys_prompt)
        self.assertIn("probe configurations", sys_prompt)

    def test_build_prompt_missing_config_and_probe_failure(self) -> None:
        """Verify build_prompt extracts missing ConfigMap events and probe timeouts."""
        bundle = _make_bundle(container_name="web")
        _add_evidence(
            bundle,
            "ev.pod.container.status",
            {
                "containerStatuses": [
                    {
                        "name": "web",
                        "state": {"waiting": {"reason": "CreateContainerConfigError"}},
                    }
                ]
            },
        )
        _add_evidence(
            bundle,
            "ev.pod.spec",
            {
                "containers": [
                    {
                        "name": "web",
                        "livenessProbe": {
                            "timeoutSeconds": 2,
                            "periodSeconds": 10,
                            "failureThreshold": 3,
                        },
                    }
                ],
                "volumes": [{"name": "cfg", "configMap": {"name": "app-config"}}],
            },
        )
        _add_evidence(
            bundle,
            "ev.pod.events",
            [
                {
                    "reason": "FailedMount",
                    "message": 'MountVolume.SetUp failed: configmap "app-config" not found',
                },
                {
                    "reason": "Unhealthy",
                    "message": "Liveness probe failed: HTTP probe timed out after 2 seconds",
                },
            ],
        )

        prompt = self.agent.build_prompt(bundle)
        self.assertIn("CreateContainerConfigError", prompt)
        self.assertIn("livenessProbe: timeoutSeconds=2", prompt)
        self.assertIn("ConfigMap 'app-config'", prompt)
        self.assertIn('configmap "app-config" not found', prompt)
        self.assertIn("Liveness probe failed", prompt)

    def test_run_investigation_config_diagnosis(self) -> None:
        """Verify investigation returns structured diagnostic report for config failures."""
        response_data = {
            "summary": "Pod blocked by missing ConfigMap 'app-config' in namespace production.",
            "evidence": [
                "ConfigMap app-config not found event",
                "Waiting reason CreateContainerConfigError",
            ],
            "hypotheses": [
                "ConfigMap was deleted or not deployed in production namespace"
            ],
            "confidence": "high",
        }
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps(response_data)}
        }

        report = self.agent.run_investigation(_make_bundle())
        self.assertEqual(report["confidence"], "high")
        self.assertIn("app-config", report["summary"])
        self.assertEqual(len(report["evidence"]), 2)


class TestClusterResourceAgent(unittest.TestCase):
    """Tests for :class:`~specialists.resource.ClusterResourceAgent` domain diagnostics."""

    def setUp(self) -> None:
        self.mock_client = MagicMock()
        self.agent = ClusterResourceAgent(self.mock_client, model="llama3.1")

    def test_metadata_and_system_prompt(self) -> None:
        """Verify agent metadata and cluster capacity persona."""
        self.assertEqual(self.agent.role, "resource")
        self.assertEqual(self.agent.display_name, "Cluster & Resource Agent")
        self.assertEqual(self.agent.icon, "🛡️")

        sys_prompt = self.agent.get_system_prompt()
        self.assertIn("Cluster Capacity & Linux Cgroups Specialist", sys_prompt)
        self.assertIn("MemoryPressure", sys_prompt)
        self.assertIn("Quality of Service (QoS) classes", sys_prompt)

    def test_build_prompt_node_pressure_and_qos(self) -> None:
        """Verify build_prompt extracts node pressure flags and infers Burstable QoS."""
        bundle = _make_bundle(container_name="worker")
        _add_evidence(
            bundle,
            "ev.pod.spec",
            {
                "containers": [
                    {
                        "name": "worker",
                        "resources": {
                            "requests": {"cpu": "100m", "memory": "256Mi"},
                            "limits": {"cpu": "500m", "memory": "1Gi"},
                        },
                    }
                ]
            },
        )
        _add_evidence(
            bundle,
            "ev.node.conditions",
            [
                {
                    "type": "MemoryPressure",
                    "status": "True",
                    "reason": "NodeHasInsufficientMemory",
                },
                {
                    "type": "DiskPressure",
                    "status": "False",
                    "reason": "NodeHasSufficientDisk",
                },
            ],
        )
        _add_evidence(
            bundle,
            "ev.pod.events",
            [
                {
                    "reason": "FailedScheduling",
                    "message": "0/3 nodes are available: insufficient memory",
                }
            ],
        )

        prompt = self.agent.build_prompt(bundle)
        self.assertIn("Inferred QoS Class: Burstable", prompt)
        self.assertIn("MemoryPressure=True", prompt)
        self.assertIn("insufficient memory", prompt)

    def test_qos_inference_matrix(self) -> None:
        """Verify QoS calculation for Guaranteed, Burstable, and BestEffort."""
        guaranteed_spec = {
            "containers": [
                {
                    "name": "c1",
                    "resources": {
                        "requests": {"cpu": "1", "memory": "1Gi"},
                        "limits": {"cpu": "1", "memory": "1Gi"},
                    },
                }
            ]
        }
        best_effort_spec = {"containers": [{"name": "c2", "resources": {}}]}

        g_bundle = _make_bundle()
        _add_evidence(g_bundle, "ev.pod.spec", guaranteed_spec)
        self.assertIn("Guaranteed", self.agent.build_prompt(g_bundle))

        b_bundle = _make_bundle()
        _add_evidence(b_bundle, "ev.pod.spec", best_effort_spec)
        self.assertIn("BestEffort", self.agent.build_prompt(b_bundle))

    def test_run_investigation_resource_diagnosis(self) -> None:
        """Verify investigation returns structured diagnostic report for resource failures."""
        response_data = {
            "summary": "Node worker-node-1 is under active MemoryPressure causing pod eviction.",
            "evidence": [
                "Node MemoryPressure=True",
                "FailedScheduling 0/3 nodes available",
            ],
            "hypotheses": [
                "Cluster nodes lack allocatable memory for requested workload"
            ],
            "confidence": "high",
        }
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps(response_data)}
        }

        report = self.agent.run_investigation(_make_bundle())
        self.assertEqual(report["confidence"], "high")
        self.assertIn("MemoryPressure", report["summary"])


class TestSpecialistSchemaConsistency(unittest.TestCase):
    """Verify output schema conformity across all three specialist agents."""

    def test_all_specialists_conform_to_schema(self) -> None:
        """Ensure Runtime, Config, and Resource specialists adhere to SpecialistReport schema."""
        mock_client = MagicMock()
        specialists = [
            RuntimeLogAgent(mock_client, model="llama3.1"),
            ConfigDependencyAgent(mock_client, model="llama3.1"),
            ClusterResourceAgent(mock_client, model="llama3.1"),
        ]

        expected_keys = {"summary", "evidence", "hypotheses", "confidence"}

        for agent in specialists:
            with self.subTest(agent=agent.role):
                mock_client.chat.return_value = {
                    "message": {
                        "content": json.dumps(
                            {
                                "summary": f"{agent.display_name} healthy diagnosis.",
                                "evidence": ["Fact 1"],
                                "hypotheses": [],
                                "confidence": "low",
                            }
                        )
                    }
                }
                report = agent.run_investigation(_make_bundle())
                self.assertEqual(set(report.keys()), expected_keys)
                self.assertIsInstance(report["summary"], str)
                self.assertIsInstance(report["evidence"], list)
                self.assertIsInstance(report["hypotheses"], list)
                self.assertIn(report["confidence"], ("high", "medium", "low"))


if __name__ == "__main__":
    unittest.main()
