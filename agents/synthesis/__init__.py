"""
Multi-Agent Synthesis Package — KDM v4.0.0
=========================================
Provides the Lead SRE Investigator Agent and Hypothesis Engine for
cross-specialist correlation, symptom de-duplication, and hypothesis ranking.
"""

from __future__ import annotations

import os
import sys

_AGENTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

try:
    from agents.synthesis.consensus import (
        BestSolution,
        ConsensusContext,
        ConsensusDiagnosis,
        ConsensusGenerator,
        generate_consensus_diagnosis,
        map_confidence_score,
    )
    from agents.synthesis.hypotheses import Hypothesis
    from agents.synthesis.investigator import LeadInvestigatorAgent
except ImportError:
    from synthesis.consensus import (  # type: ignore[no-redef]
        BestSolution,
        ConsensusContext,
        ConsensusDiagnosis,
        ConsensusGenerator,
        generate_consensus_diagnosis,
        map_confidence_score,
    )
    from synthesis.hypotheses import Hypothesis  # type: ignore[no-redef]
    from synthesis.investigator import LeadInvestigatorAgent  # type: ignore[no-redef]

__all__ = [
    "BestSolution",
    "ConsensusContext",
    "ConsensusDiagnosis",
    "ConsensusGenerator",
    "Hypothesis",
    "LeadInvestigatorAgent",
    "generate_consensus_diagnosis",
    "map_confidence_score",
]
