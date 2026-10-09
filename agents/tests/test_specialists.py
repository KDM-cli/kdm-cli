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


class ConcreteTestAgent(BaseSpecialistAgent):
    """Concrete subclass for testing BaseSpecialistAgent behaviors."""

    role = "test_role"
    display_name = "Test Agent"
    icon = "🧪"

    def build_prompt(self, bundle: EvidenceBundle) -> str:
        return f"Investigate workload {bundle.target.workload_name}"

    def get_system_prompt(self) -> str:
        return "You are a test diagnostic agent. Return valid JSON."


class SpecialistTestBase(unittest.TestCase):
    """Base test case providing shared mocking, bundle creation, and evidence helpers."""

    def setUp(self) -> None:
        self.mock_client = MagicMock()

    def make_bundle(
        self,
        workload_name: str = "order-api",
        container_name: Optional[str] = "api",
        namespace: str = "production",
    ) -> EvidenceBundle:
        """Create a standard test EvidenceBundle."""
        target = Target(
            workload_kind="Deployment",
            workload_name=workload_name,
            namespace=namespace,
            container_name=container_name,
        )
        return EvidenceBundle(target=target, collected_at="2026-10-09T00:00:00Z")

    def add_evidence(
        self,
        bundle: EvidenceBundle,
        item_id: str,
        data: Any,
        status: CollectionStatus = CollectionStatus.AVAILABLE,
    ) -> None:
        """Add an evidence item to the given bundle."""
        bundle.add(
            EvidenceItem(
                id=item_id,
                source="kubernetes_api",
                status=status,
                data=data,
            )
        )


class TestBaseSpecialistContracts(SpecialistTestBase):
    """Tests for :class:`~specialists.base.BaseSpecialistAgent` contract and error handling."""

    def setUp(self) -> None:
        super().setUp()
        self.agent = ConcreteTestAgent(self.mock_client, model="llama3.1")

    def test_abstract_instantiation_and_contract(self) -> None:
        """Verify BaseSpecialistAgent cannot be instantiated directly without abstract methods."""
        with self.assertRaises(TypeError):
            BaseSpecialistAgent(self.mock_client, model="llama3.1")  # type: ignore[abstract]

    def test_investigation_payload_and_client_invocation(self) -> None:
        """Verify run_investigation passes format='json', options, and parses dict/object responses."""
        payload = {
            "summary": "Root cause identified.",
            "evidence": ["Fact A", "Fact B"],
            "hypotheses": ["Hypothesis 1"],
            "confidence": "high",
        }
        self.mock_client.chat.return_value = {
            "message": {"content": json.dumps(payload)}
        }

        bundle = self.make_bundle()
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

        # Test object response access
        self.mock_client.chat.return_value = MockChatResponse(json.dumps(payload))
        obj_report = self.agent.run_investigation(bundle)
        self.assertEqual(obj_report["summary"], "Root cause identified.")

    def test_markdown_fences_and_schema_normalization(self) -> None:
        """Verify markdown code fence stripping and report/evidence normalization."""
        fenced_json = '```json\n{"summary": "Fenced summary", "evidence": "Single fact", "hypotheses": "Single hyp", "confidence": "UNKNOWN"}\n```'
        self.mock_client.chat.return_value = {"message": {"content": fenced_json}}

        report = self.agent.run_investigation(self.make_bundle())
        self.assertEqual(report["summary"], "Fenced summary")
        self.assertEqual(report["evidence"], ["Single fact"])
        self.assertEqual(report["hypotheses"], ["Single hyp"])
        self.assertEqual(report["confidence"], "low")

        # Test analyze() evidence normalization
        legacy_res = self.agent.analyze("Failure occurred", {"namespace": "default"})
        self.assertEqual(legacy_res["evidence"], ["Single fact"])

    def test_robust_fallback_and_error_recovery(self) -> None:
        """Verify malformed JSON, timeouts, exceptions, and None bundles recover with fallback."""
        bundle = self.make_bundle()

        # None bundle handling
        self.assertEqual(self.agent.run_investigation(None), FALLBACK_REPORT)  # type: ignore[arg-type]

        # Malformed inputs
        for raw in ("Not JSON", '{"summary": "Incomplete', "", "42", "[1, 2]"):
            with self.subTest(raw=raw):
                self.mock_client.chat.return_value = {"message": {"content": raw}}
                rep = self.agent.run_investigation(bundle)
                self.assertEqual(rep, FALLBACK_REPORT)
                self.assertEqual(rep["confidence"], "low")

        # Exceptions and timeouts
        for exc in (
            TimeoutError("timed out"),
            RuntimeError("down"),
            KeyError("message"),
        ):
            with self.subTest(exc=type(exc).__name__):
                self.mock_client.chat.side_effect = exc
                rep = self.agent.run_investigation(bundle)
                self.assertEqual(rep["summary"], "Agent output parsing failed")
                self.assertEqual(rep["confidence"], "low")


class TestDomainSpecialistAgents(SpecialistTestBase):
    """Tests for Runtime, Config, and Resource domain diagnostic specialists."""

    def test_specialist_metadata_and_system_prompts(self) -> None:
        """Verify roles, icons, and system prompt personas across all three specialists."""
        specs = [
            (
                RuntimeLogAgent(self.mock_client, model="llama3.1"),
                "runtime",
                "Runtime & Log Agent",
                "🔍",
                "Senior Linux & Container Runtime Diagnostics Specialist",
            ),
            (
                ConfigDependencyAgent(self.mock_client, model="llama3.1"),
                "config",
                "Config & Dependency Agent",
                "⚙️",
                "Kubernetes Declarative Configuration Specialist",
            ),
            (
                ClusterResourceAgent(self.mock_client, model="llama3.1"),
                "resource",
                "Cluster & Resource Agent",
                "🛡️",
                "Cluster Capacity & Linux Cgroups Specialist",
            ),
        ]
        for agent, expected_role, expected_name, expected_icon, prompt_kw in specs:
            with self.subTest(role=expected_role):
                self.assertEqual(agent.role, expected_role)
                self.assertEqual(agent.display_name, expected_name)
                self.assertEqual(agent.icon, expected_icon)
                self.assertIn(prompt_kw, agent.get_system_prompt())

    def test_runtime_log_agent_prompt_evidence(self) -> None:
        """Verify RuntimeLogAgent prompt extraction for empty logs, exit code 137, and events."""
        agent = RuntimeLogAgent(self.mock_client, model="llama3.1")

        # Empty logs edge case
        empty_bundle = self.make_bundle()
        self.add_evidence(
            empty_bundle,
            "ev.pod.logs.previous",
            "",
            status=CollectionStatus.UNAVAILABLE,
        )
        empty_prompt = agent.build_prompt(empty_bundle)
        self.assertIn(
            "No previous crash log was persisted (empty or unavailable)",
            empty_prompt,
        )

        # Crash exit code 137 and log snippet
        crash_bundle = self.make_bundle(container_name="api")
        self.add_evidence(
            crash_bundle,
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
        self.add_evidence(
            crash_bundle,
            "ev.pod.logs.previous",
            "fatal: out of memory allocating 512MB\nKilled",
        )
        self.add_evidence(
            crash_bundle,
            "ev.pod.events",
            [
                {
                    "reason": "BackOff",
                    "message": "Back-off restarting failed container api",
                }
            ],
        )

        prompt = agent.build_prompt(crash_bundle)
        self.assertIn("exitCode: 137", prompt)
        self.assertIn("OOMKilled", prompt)
        self.assertIn("fatal: out of memory", prompt)
        self.assertIn("Back-off restarting failed container", prompt)

    def test_runtime_log_agent_healthy_diagnosis(self) -> None:
        """Verify RuntimeLogAgent produces low-confidence report when healthy."""
        agent = RuntimeLogAgent(self.mock_client, model="llama3.1")
        self.mock_client.chat.return_value = {
            "message": {
                "content": json.dumps(
                    {
                        "summary": "No runtime crashes detected.",
                        "evidence": ["exitCode == 0"],
                        "hypotheses": [],
                        "confidence": "low",
                    }
                )
            }
        }
        report = agent.run_investigation(self.make_bundle())
        self.assertEqual(report["confidence"], "low")
        self.assertEqual(report["hypotheses"], [])

    def test_config_agent_probe_and_mount_evidence(self) -> None:
        """Verify ConfigDependencyAgent extracts probe timeouts and missing ConfigMap mounts."""
        agent = ConfigDependencyAgent(self.mock_client, model="llama3.1")
        bundle = self.make_bundle(container_name="web")
        self.add_evidence(
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
        self.add_evidence(
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
        self.add_evidence(
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

        prompt = agent.build_prompt(bundle)
        self.assertIn("CreateContainerConfigError", prompt)
        self.assertIn("livenessProbe: timeoutSeconds=2", prompt)
        self.assertIn("ConfigMap 'app-config'", prompt)
        self.assertIn('configmap "app-config" not found', prompt)
        self.assertIn("Liveness probe failed", prompt)

    def test_config_agent_env_and_init_container_refs(self) -> None:
        """Verify ConfigDependencyAgent extracts envFrom and valueFrom configs across containers."""
        agent = ConfigDependencyAgent(self.mock_client, model="llama3.1")
        bundle = self.make_bundle(container_name="web")
        self.add_evidence(
            bundle,
            "ev.pod.spec",
            {
                "containers": [
                    {
                        "name": "web",
                        "envFrom": [{"configMapRef": {"name": "web-config"}}],
                        "env": [
                            {
                                "name": "DB_PASS",
                                "valueFrom": {
                                    "secretKeyRef": {
                                        "name": "db-secret",
                                        "key": "password",
                                    }
                                },
                            }
                        ],
                    }
                ],
                "initContainers": [
                    {
                        "name": "init-db",
                        "envFrom": [{"secretRef": {"name": "vault-token"}}],
                    }
                ],
            },
        )

        prompt = agent.build_prompt(bundle)
        self.assertIn("Container 'web' envFrom: ConfigMap 'web-config'", prompt)
        self.assertIn("Container 'web' env 'DB_PASS': Secret 'db-secret'", prompt)
        self.assertIn("Container 'init-db' envFrom: Secret 'vault-token'", prompt)

    def test_config_dependency_agent_investigation_report(self) -> None:
        """Verify ConfigDependencyAgent returns structured diagnostic report for missing configs."""
        agent = ConfigDependencyAgent(self.mock_client, model="llama3.1")
        self.mock_client.chat.return_value = {
            "message": {
                "content": json.dumps(
                    {
                        "summary": "Missing ConfigMap app-config.",
                        "evidence": ["ConfigMap app-config not found"],
                        "hypotheses": ["ConfigMap deleted"],
                        "confidence": "high",
                    }
                )
            }
        }
        report = agent.run_investigation(self.make_bundle())
        self.assertEqual(report["confidence"], "high")
        self.assertIn("app-config", report["summary"])

    def test_cluster_resource_agent_prompt_and_events(self) -> None:
        """Verify ClusterResourceAgent extracts node pressure conditions and scheduling events."""
        agent = ClusterResourceAgent(self.mock_client, model="llama3.1")
        bundle = self.make_bundle(container_name="worker")
        self.add_evidence(
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
        self.add_evidence(
            bundle,
            "ev.node.conditions",
            [
                {
                    "type": "MemoryPressure",
                    "status": "True",
                    "reason": "NodeHasInsufficientMemory",
                }
            ],
        )
        self.add_evidence(
            bundle,
            "ev.pod.events",
            [
                {
                    "reason": "FailedScheduling",
                    "message": "0/3 nodes are available: insufficient memory",
                }
            ],
        )

        prompt = agent.build_prompt(bundle)
        self.assertIn("Inferred QoS Class: Burstable", prompt)
        self.assertIn("MemoryPressure=True", prompt)
        self.assertIn("insufficient memory", prompt)

    def test_cluster_resource_agent_qos_matrix(self) -> None:
        """Verify ClusterResourceAgent QoS class calculation across resource profiles."""
        agent = ClusterResourceAgent(self.mock_client, model="llama3.1")
        qos_cases = [
            (
                {
                    "containers": [
                        {
                            "name": "c1",
                            "resources": {
                                "requests": {"cpu": "1", "memory": "1Gi"},
                                "limits": {"cpu": "1", "memory": "1Gi"},
                            },
                        }
                    ]
                },
                "Guaranteed",
            ),
            (
                {
                    "containers": [
                        {
                            "name": "c1",
                            "resources": {
                                "requests": {"cpu": "1"},
                                "limits": {"cpu": "1"},
                            },
                        }
                    ]
                },
                "Burstable",
            ),
            ({"containers": [{"name": "c2", "resources": {}}]}, "BestEffort"),
        ]
        for spec, expected_qos in qos_cases:
            with self.subTest(expected_qos=expected_qos):
                b = self.make_bundle()
                self.add_evidence(b, "ev.pod.spec", spec)
                self.assertIn(expected_qos, agent.build_prompt(b))

    def test_cluster_resource_agent_investigation_report(self) -> None:
        """Verify ClusterResourceAgent returns structured diagnostic report for resource failures."""
        agent = ClusterResourceAgent(self.mock_client, model="llama3.1")
        self.mock_client.chat.return_value = {
            "message": {
                "content": json.dumps(
                    {
                        "summary": "Node under active MemoryPressure.",
                        "evidence": ["MemoryPressure=True"],
                        "hypotheses": ["OOM eviction"],
                        "confidence": "high",
                    }
                )
            }
        }
        report = agent.run_investigation(self.make_bundle())
        self.assertEqual(report["confidence"], "high")
        self.assertIn("MemoryPressure", report["summary"])

    def test_schema_consistency_across_all_specialists(self) -> None:
        """Ensure Runtime, Config, and Resource specialists adhere to SpecialistReport schema."""
        specialists = [
            RuntimeLogAgent(self.mock_client, model="llama3.1"),
            ConfigDependencyAgent(self.mock_client, model="llama3.1"),
            ClusterResourceAgent(self.mock_client, model="llama3.1"),
        ]
        expected_keys = {"summary", "evidence", "hypotheses", "confidence"}

        for agent in specialists:
            with self.subTest(agent=agent.role):
                self.mock_client.chat.return_value = {
                    "message": {
                        "content": json.dumps(
                            {
                                "summary": f"{agent.display_name} diagnosis.",
                                "evidence": ["Fact 1"],
                                "hypotheses": [],
                                "confidence": "low",
                            }
                        )
                    }
                }
                report = agent.run_investigation(self.make_bundle())
                self.assertEqual(set(report.keys()), expected_keys)
                self.assertIsInstance(report["summary"], str)
                self.assertIsInstance(report["evidence"], list)
                self.assertIsInstance(report["hypotheses"], list)
                self.assertIn(report["confidence"], ("high", "medium", "low"))


if __name__ == "__main__":
    unittest.main()
