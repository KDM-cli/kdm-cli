"""
Parallel Agent Orchestrator with Failure Isolation — KDM v4.0.0
================================================================
Implements concurrent specialist agent execution using asyncio, enforcing:
  1. Concurrency limits via asyncio.Semaphore to protect system resources.
  2. Thread pool execution via loop.run_in_executor for synchronous Ollama calls.
  3. Per-agent execution timeouts via asyncio.wait_for.
  4. Failure isolation to ensure crashes/timeouts in one agent do not fail others.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Any, Dict, List, Optional, Sequence

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.core.evidence import EvidenceBundle
    from agents.specialists.base import BaseSpecialistAgent
except ImportError:
    from core.evidence import EvidenceBundle  # type: ignore[no-redef]
    from specialists.base import BaseSpecialistAgent  # type: ignore[no-redef]

logger = logging.getLogger(__name__)


class AgentOrchestrator:
    """Orchestrates parallel specialist agent execution with failure isolation.

    Enforces concurrency limits via an asyncio.Semaphore to protect system
    resources (such as local Ollama RAM/VRAM) and applies per-agent timeouts
    to isolate slow or crashing agents from blocking other investigations.
    """

    def __init__(
        self,
        agents: Optional[Sequence[BaseSpecialistAgent]] = None,
        max_concurrency: int = 2,
        timeout_seconds: float = 25.0,
    ) -> None:
        """Initialize the parallel agent orchestrator.

        :param agents: Sequence of specialist agents to execute concurrently.
        :param max_concurrency: Maximum number of concurrent agent executions (default: 2).
        :param timeout_seconds: Maximum execution time allowed per agent in seconds (default: 25.0s).
        """
        self.agents: List[BaseSpecialistAgent] = (
            list(agents) if agents is not None else []
        )
        self.max_concurrency: int = max(1, int(max_concurrency))
        self.semaphore: asyncio.Semaphore = asyncio.Semaphore(self.max_concurrency)
        self.timeout: float = float(timeout_seconds)
        self.timeout_seconds: float = self.timeout

    async def _execute_agent(
        self, agent: BaseSpecialistAgent, bundle: Optional[EvidenceBundle]
    ) -> Dict[str, Any]:
        """Execute an individual specialist agent with concurrency and timeout guards.

        Runs the agent's synchronous run_investigation method inside loop.run_in_executor
        to prevent blocking the asyncio event loop. Catches timeouts and exceptions to
        guarantee failure isolation.

        :param agent: The specialist agent instance to run.
        :param bundle: Evidence bundle to pass to the agent.
        :return: Standardized dictionary containing 'role', 'status' ('completed' or 'failed'),
                 and either 'result' or 'error'.
        """
        role = getattr(agent, "role", "unknown")
        async with self.semaphore:
            loop = asyncio.get_running_loop()
            try:
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, agent.run_investigation, bundle),
                    timeout=self.timeout,
                )
                return {
                    "role": role,
                    "status": "completed",
                    "result": result,
                }
            except (asyncio.TimeoutError, TimeoutError):
                logger.warning(
                    "Specialist %s timed out after %.1fs", role, self.timeout
                )
                return {
                    "role": role,
                    "status": "failed",
                    "error": f"Timed out after {self.timeout}s",
                }
            except Exception as exc:
                logger.warning(
                    "Specialist %s failed with unhandled exception: %s",
                    role,
                    exc,
                )
                return {
                    "role": role,
                    "status": "failed",
                    "error": str(exc),
                }

    async def run_all(
        self, bundle: Optional[EvidenceBundle] = None
    ) -> List[Dict[str, Any]]:
        """Execute all registered specialist agents concurrently against the evidence bundle.

        Aggregates all execution results preserving the original agent order.
        Guarantees that errors or timeouts in individual agents do not cause
        the overall batch to fail.

        :param bundle: Evidence bundle to pass to all agents.
        :return: List of agent execution result dictionaries.
        """
        if not self.agents:
            return []
        tasks = [self._execute_agent(agent, bundle) for agent in self.agents]
        return await asyncio.gather(*tasks)
