# KDM CLI — Robust Multi-Agent Tool-Calling Architecture
## Exhaustive Contributor-Ready Issue & PR Implementation Roadmap

> **Goal:** Evolve `kdm analyze` from a parallel LLM prompt script into an auditable, deterministic, tool-using SRE diagnosis and self-healing system.
>
> **Core Stack:** Node.js (v20+) + React Ink TUI, Python 3.10+ Multi-Agent Runtime, Ollama Python SDK, Kubernetes (`@kubernetes/client-node` / `kubernetes`), Dockerode, NDJSON IPC.
>
> **Target Audience:** Open-source contributors, maintainers, and reviewers. Every phase below is formulated as an exhaustive, copy-pasteable **GitHub Issue & Pull Request Specification**.

---

## Contributor Guidelines & PR Etiquette

1. **Pick an Issue**: Check GitHub Milestone `v4.0.0` (Issues #271 to #295).
2. **Target Branch**: All Pull Requests implementing these phases **MUST target branch `v4.0.0`** (DO NOT target `main`).
3. **Commit Convention**: Follow Conventional Commits, e.g., `feat(agents): Phase 1 - Canonical evidence model and collectors`.
4. **Code Quality**:
   - Python: Target Python 3.10+. Type hints required (`from typing import ...`). Code must pass `ruff check` and `python3 -m unittest discover agents/`.
   - TypeScript: Strict typing. No `any` without explicit justification. Must pass `npm run build` and `npm test`.
5. **PR Scope**: Keep each PR strictly isolated to its phase deliverables. Include unit and integration tests for every new class or function.

---

```text
                                   KDM CLI
                                      │
                                      ▼
                             Analysis Orchestrator
                                      │
                                      ▼
                            Canonical Evidence Collector
                                      │
                                      ▼
                               EvidenceBundle
                                      │
                     ┌────────────────┴────────────────┐
                     ▼                                 ▼
             Deterministic Rules                 Agent Council
             (OOM, CrashLoop,                    (Runtime, Config,
              ImagePull, etc.)                    Resource Agents)
                     │                                 │
                     │                           Bounded Tool Calls
                     │                           (Logs, Metrics, Probes)
                     │                                 │
                     └────────────────┬────────────────┘
                                      │
                                      ▼
                            Auditable Finding Store
                                      │
                                      ▼
                              Lead SRE Investigator
                              (Hypothesis Generation)
                                      │
                                      ▼
                               Validator Agent
                             (Evidence Cross-Check)
                                      │
                                      ▼
                             Consensus Diagnosis
                                      │
                     ┌────────────────┴────────────────┐
                     ▼                                 ▼
               Live Ink TUI                   Remediation Planner
             (NDJSON Stream)                           │
                                                       ▼
                                               Safety Policy Gate
                                                       │
                                                 [y/N] Prompt
                                                       │
                                                       ▼
                                              Remediation Executor
                                                       │
                                                       ▼
                                             Post-Fix Verification
```

---


# Phase 0 — Issue #271

## Overview
Understand, map, and freeze the existing `kdm analyze` execution flow before introducing any architectural changes.

Part of **Milestone v4.0.0** — Phase 0 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(core): Phase 0 - Baseline pipeline mapping and contract freeze`
> **PR SCOPE**: Keep this PR strictly focused on Phase 0 deliverables. Do not modify agent council or UI components in this PR.

---

## 1. Description of What Has to Be Done
Currently, `kdm analyze` functions as a direct CLI command that collects workload status and calls an LLM (Ollama, OpenAI, Claude, etc.) through a single prompt. Because we are evolving this into a multi-agent system (with Python council, canonical evidence collector, deterministic rules, and interactive remediation), we must **freeze the existing input/output contracts** and create a baseline test harness.

Contributors must:
1. Identify and document every touchpoint in `src/analysis/analysis.ts`, `src/commands/analyze.ts`, and `src/ui/AnalyzeDashboard.tsx`.
2. Define stable TypeScript interfaces (`AnalysisRequest`, `LegacyAnalysisResult`, `AnalysisEvent`) that encapsulate current behavior.
3. Record deterministic test fixtures for 4 canonical Kubernetes failure modes (OOMKilled, CrashLoopBackOff, ImagePullBackOff, probe failure).
4. Implement automated baseline regression tests that assert existing behavior runs without live cluster or active Ollama server.
5. Provide a feature-flag gate (`process.env.KDM_MULTI_AGENT`) so future phases can be developed incrementally without breaking existing users.

---

## 2. Desired Outcome & Expected Behavior

### Current Behavior vs Expected Outcome
- **Current**: Direct prompt-to-LLM flow without frozen boundaries. Changes to analysis logic risk breaking cloud backends (OpenAI/Claude) or CLI flags.
- **Expected Outcome**:
  - Calling `kdm analyze <workload>` continues to work identically for all users.
  - When `KDM_MULTI_AGENT` is not set or false, the exact legacy pipeline executes.
  - A comprehensive suite of offline baseline fixtures verifies that analysis parsing, confidence calculation, and fix formatting remain 100% stable.
  - A clean architectural boundary is established through frozen interfaces, preparing the codebase for Phase 1.

### Example Expected Test Output
```text
$ npm test -- src/analysis/__tests__/analysis-baseline.test.ts

 ✓ src/analysis/__tests__/analysis-baseline.test.ts (6 tests)
   ✓ parses OOMKilled exit code 137 correctly in legacy flow
   ✓ handles CrashLoopBackOff with non-zero exit code
   ✓ handles ImagePullBackOff with authorization failure
   ✓ gracefully handles probe threshold timeouts
   ✓ preserves cloud backend fallback (OpenAI/Claude)
   ✓ respects KDM_MULTI_AGENT feature flag toggle
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Pipeline Flow Diagram
```text
CLI Input (`kdm analyze <pod>`)
       │
       ▼
src/commands/analyze.ts
       │
       ▼
src/analysis/analysis.ts (Contract Boundary: AnalysisRequest)
       │
       ├─► Feature Flag check: KDM_MULTI_AGENT == 'true'?
       │     ├─► YES: Route to Multi-Agent Engine (Phases 1-24)
       │     └─► NO:  Route to Legacy Pipeline (Frozen Baseline)
       │
       ▼
Legacy Ollama / Cloud Client (Mocked in baseline fixtures)
       │
       ▼
Contract Boundary: LegacyAnalysisResult
       │
       ▼
AnalyzeDashboard.tsx (Frozen UI representation)
```

### Files to Create and Modify
- `[NEW] src/analysis/__tests__/baseline-fixtures.ts`: Frozen input error payloads and expected diagnosis results.
- `[NEW] src/analysis/__tests__/analysis-baseline.test.ts`: Offline integration tests asserting legacy pipeline stability.
- `[MODIFY] src/analysis/types.ts`: Export frozen `AnalysisRequest` and `LegacyAnalysisResult`.
- `[MODIFY] src/analysis/analysis.ts`: Wrap legacy execution in boundary types and feature-flag routing.

---

## 4. Detailed Task Breakdown

- [ ] **Task 0.1: Extract Real-World Baseline Fixtures**
  - In `src/analysis/__tests__/baseline-fixtures.ts`, define static mock objects representing Kubernetes pod status, container statuses, events, and raw logs for:
    1. OOMKilled container (terminated with exit code 137).
    2. CrashLoopBackOff container (application panic on startup, exit code 1).
    3. ImagePullBackOff (invalid registry or missing secret).
    4. Readiness probe failure (HTTP 500 error on `/healthz`).
  - Include corresponding expected LLM responses to enable deterministic testing without live AI inference.

- [ ] **Task 0.2: Define and Export Frozen Boundary Interfaces**
  - In `src/analysis/types.ts`, define `AnalysisRequest` containing workload name, kind, namespace, cluster context, backend, model, and flags.
  - Define `LegacyAnalysisResult` containing rootCause, suggestedFix, confidence, rawOutput, and durationMs.
  - Ensure all fields are strictly typed (no loose `any`).

- [ ] **Task 0.3: Implement Offline Baseline Regression Tests**
  - In `src/analysis/__tests__/analysis-baseline.test.ts`, write unit tests that mock the AI client (`aiClient.generate` / `ollama.chat`).
  - Verify that passing each fixture from Task 0.1 through the analysis function returns the expected `LegacyAnalysisResult`.
  - Assert that errors in backend connection cleanly degrade to an error state rather than throwing unhandled promise rejections.

- [ ] **Task 0.4: Implement Feature Flag Scaffolding**
  - In `src/analysis/analysis.ts`, add:
    ```typescript
    const useMultiAgent = process.env.KDM_MULTI_AGENT === 'true' || options.multiAgent === true;
    ```
  - If `useMultiAgent` is false, execute the frozen legacy analysis logic unconditionally.

---

## 5. Technical Specifications & Concrete Code Signatures

```typescript
// src/analysis/types.ts

export interface AnalysisRequest {
  workloadKind: 'Pod' | 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Job';
  workloadName: string;
  namespace: string;
  clusterContext?: string;
  backend: 'ollama' | 'openai' | 'claude' | 'azure' | 'custom';
  model?: string;
  detailed?: boolean;
}

export interface LegacyAnalysisResult {
  rootCause: string;
  suggestedFix: string;
  confidence: number; // 0.0 to 1.0
  rawOutput: string;
  durationMs: number;
}
```

```typescript
// src/analysis/__tests__/baseline-fixtures.ts

export const OOM_KILLED_FIXTURE = {
  podName: 'auth-service-7bbd8f4b5-9x7q2',
  namespace: 'production',
  containerName: 'auth',
  status: {
    phase: 'Running',
    containerStatuses: [{
      name: 'auth',
      ready: false,
      restartCount: 5,
      lastState: {
        terminated: {
          exitCode: 137,
          reason: 'OOMKilled',
          startedAt: '2026-09-10T12:00:00Z',
          finishedAt: '2026-09-10T12:05:00Z'
        }
      }
    }]
  },
  expectedResult: {
    rootCause: 'Container terminated with exit code 137 due to Out Of Memory (OOMKilled).',
    confidence: 1.0
  }
};
```

---

## 6. Edge Cases & Failure Handling
- **No Cluster Connected**: Baseline tests must run completely in-memory with zero network or socket calls (`nock` or vitest mocks).
- **Backend Unavailable**: Verify that when the mock AI client throws an `ECONNREFUSED` error, `kdm analyze` catches it and returns an error result instead of crashing the process.
- **Node.js Environment**: Tests must pass on both Node 20 and Node 22 without deprecation warnings.

---

## 7. Verification & Acceptance Checklist
- [ ] Run `npm test -- src/analysis/__tests__/analysis-baseline.test.ts` — all tests pass.
- [ ] Run `npm test` — all existing test files pass with zero regressions.
- [ ] Run `npm run build` — TypeScript compiles without errors.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 1 — Issue #272

## Overview
Create a deterministic, normalized canonical evidence layer before introducing specialist agent reasoning.

**Core Architectural Rule:** *KDM collects facts; agents reason over facts.* Agents must never guess container exit codes, restart counts, or probe configurations.

Part of **Milestone v4.0.0** — Phase 1 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(agents): Phase 1 - Canonical Evidence Model and Collectors`
> **PR SCOPE**: Modular PR for Python evidence dataclasses and collectors.

---

## 1. Description of What Has to Be Done
Currently, Kubernetes error messages and raw status strings are passed ad-hoc into prompts. This causes LLMs to fabricate details or hallucinate state when data is missing. 

In Phase 1, contributors will build a normalized, immutable `EvidenceBundle` in Python. KDM will extract deterministic facts from Kubernetes/Docker APIs, assign every piece of information a stable hierarchical identifier (`ev.<category>.<field>`, e.g., `ev.pod.container.status`, `ev.pod.events`), and explicitly record the collection status (`available`, `unavailable`, `permission_denied`, `timeout`, `not_found`).

Specialist agents and deterministic rules will receive this bundle as their single source of truth.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- A structured Python object `EvidenceBundle` that encapsulates all observable facts about a target workload.
- Every evidence item has an immutable ID, a timestamp, a source, and an explicit `CollectionStatus`.
- If permissions prevent reading secrets or logs, the status is explicitly set to `CollectionStatus.PERMISSION_DENIED` rather than missing or assumed healthy.
- Environment variables and secret data keys matching sensitive patterns are automatically redacted before storage.
- The bundle can be serialized to JSON without loss of type information.

### Example JSON Serialized Evidence Output
```json
{
  "target": {
    "workload_kind": "Deployment",
    "workload_name": "checkout-api",
    "namespace": "production",
    "container_name": "checkout"
  },
  "collected_at": "2026-09-11T12:00:00Z",
  "items": {
    "ev.pod.container.status": {
      "id": "ev.pod.container.status",
      "source": "kubernetes_api",
      "status": "available",
      "timestamp": "2026-09-11T12:00:00Z",
      "data": {
        "restartCount": 4,
        "lastState": { "terminated": { "exitCode": 137, "reason": "OOMKilled" } }
      }
    },
    "ev.pod.events": {
      "id": "ev.pod.events",
      "source": "kubernetes_api",
      "status": "available",
      "timestamp": "2026-09-11T12:00:00Z",
      "data": [
        { "type": "Warning", "reason": "BackOff", "message": "Back-off restarting failed container" }
      ]
    },
    "ev.secret.env": {
      "id": "ev.secret.env",
      "source": "kubernetes_api",
      "status": "available",
      "data": { "DB_PASSWORD": "[REDACTED_BY_KDM]" }
    }
  }
}
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Architectural Diagram
```text
Kubernetes API / Docker Daemon
             │
             ▼
   Evidence Collector Functions
 (fetch_pod_evidence, fetch_events)
             │
             ▼
      Sanitizer / Redactor
             │
             ▼
       EvidenceItem(s)
 (id, source, status, data, timestamp)
             │
             ▼
       EvidenceBundle
             │
             ├─► to_dict() / from_dict()
             └─► Single Source of Truth for Agents & Rules
```

### Files to Create and Modify
- `[NEW] agents/core/__init__.py`: Export core models.
- `[NEW] agents/core/evidence.py`: `EvidenceItem`, `EvidenceBundle`, `Target`, and `CollectionStatus` dataclasses.
- `[NEW] agents/core/context.py`: `AnalysisContext` and `AnalysisMetadata` dataclasses.
- `[NEW] agents/core/sanitizer.py`: Automatic credential masking regex utilities.
- `[NEW] agents/tests/test_evidence.py`: Unit tests for bundle creation, status mapping, and serialization.

---

## 4. Detailed Task Breakdown

- [ ] **Task 1.1: Implement Core Dataclasses (`evidence.py`)**
  - Implement `CollectionStatus` as a `str, Enum` with `AVAILABLE`, `UNAVAILABLE`, `PERMISSION_DENIED`, `TIMEOUT`, `NOT_FOUND`.
  - Implement `Target` dataclass identifying `workload_kind`, `workload_name`, `namespace`, `container_name`, and optional `cluster_context`.
  - Implement `EvidenceItem` with fields: `id` (str), `source` (str), `status` (CollectionStatus), `timestamp` (ISO UTC), `data` (Any), `error_message` (Optional[str]).
  - Implement `EvidenceBundle` with methods: `add(item)`, `get(id) -> Optional[EvidenceItem]`, `has(id) -> bool`, `to_dict()`, and `from_dict()`.

- [ ] **Task 1.2: Implement Context Wrapper (`context.py`)**
  - Implement `AnalysisMetadata` (cli_version, backend, model, started_at).
  - Implement `AnalysisContext` wrapping `analysis_id` (UUID), `target`, `evidence` (EvidenceBundle), and `metadata`.

- [ ] **Task 1.3: Implement Secret & Token Redaction (`sanitizer.py`)**
  - Create recursive dictionary sanitizer that detects keys matching `(?i)(password|secret|key|token|auth|credential|cert)`.
  - Replace detected values with `"[REDACTED_BY_KDM]"`.

- [ ] **Task 1.4: Unit Tests (`test_evidence.py`)**
  - Test evidence addition and retrieval with deterministic IDs.
  - Test JSON serialization and round-trip deserialization.
  - Test secret masking across deeply nested dictionaries.
  - Test handling of `PERMISSION_DENIED` and `TIMEOUT` statuses.

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/core/evidence.py
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional
from datetime import datetime

class CollectionStatus(str, Enum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    PERMISSION_DENIED = "permission_denied"
    TIMEOUT = "timeout"
    NOT_FOUND = "not_found"

@dataclass(frozen=True)
class Target:
    workload_kind: str
    workload_name: str
    namespace: str
    container_name: Optional[str] = None
    cluster_context: Optional[str] = None

@dataclass
class EvidenceItem:
    id: str
    source: str
    status: CollectionStatus
    timestamp: str
    data: Any
    error_message: Optional[str] = None

@dataclass
class EvidenceBundle:
    target: Target
    items: Dict[str, EvidenceItem] = field(default_factory=dict)
    collected_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def add(self, item: EvidenceItem) -> None:
        self.items[item.id] = item

    def get(self, evidence_id: str) -> Optional[EvidenceItem]:
        return self.items.get(evidence_id)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "target": self.target.__dict__,
            "collected_at": self.collected_at,
            "items": {k: v.__dict__ for k, v in self.items.items()}
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EvidenceBundle":
        target = Target(**data["target"])
        bundle = cls(target=target, collected_at=data.get("collected_at", ""))
        for k, v in data.get("items", {}).items():
            status = CollectionStatus(v["status"])
            bundle.add(EvidenceItem(
                id=v["id"],
                source=v["source"],
                status=status,
                timestamp=v["timestamp"],
                data=v["data"],
                error_message=v.get("error_message")
            ))
        return bundle
```

---

## 6. Edge Cases & Failure Handling
- **Log Data Overflow**: Limit log strings stored inside evidence items to 100KB max. Truncate with `[TRUNCATED_BY_KDM]`.
- **Malformed Cluster JSON**: Wrap all API responses with safe schema parsing so corrupted fields become `error_message` rather than unhandled Python exceptions.

---

## 7. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_evidence.py` — all tests pass.
- [ ] Ensure `ruff check agents/` passes with zero lint issues.
- [ ] Round-trip serialization tested without data loss.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 2 — Issue #273

## Overview
Implement a safe, typed, read-only tool execution layer and least-privilege tool registry for Kubernetes and Docker inspection.

Part of **Milestone v4.0.0** — Phase 2 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(agents): Phase 2 - Safe Typed Tool Layer & Least-Privilege Registry`
> **PR SCOPE**: Modular PR for typed read-only tool execution.

---

## 1. Description of What Has to Be Done
Large language models perform poorly when fed massive, 500-line static contexts. Instead, specialist agents must dynamically request specific facts (e.g. "fetch previous container logs", "inspect pod events", "check container resource limits") through safe, typed tools.

Contributors must:
1. Build a `ToolRegistry` with a `@tool_registry.register` decorator that exposes tools with JSON schemas compatible with Ollama function calling.
2. Enforce **strict read-only least-privilege**: The tool layer must reject any mutation operations (`apply`, `delete`, `patch`, `scale`).
3. Implement core Kubernetes read tools (`get_pod_status`, `get_container_logs`, `get_pod_events`, `get_deployment_spec`).
4. Implement core Docker read tools (`get_docker_container_inspect`, `get_docker_logs`).
5. Ensure tool responses return structured JSON dictionaries (not raw shell strings) and scrub credentials.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- Agents can query cluster state by name and typed arguments without direct shell execution.
- Ollama receives standard tool definitions:
  ```json
  {
    "type": "function",
    "function": {
      "name": "get_container_logs",
      "description": "Fetch recent logs for a container",
      "parameters": {
        "type": "object",
        "properties": {
          "namespace": { "type": "string" },
          "pod": { "type": "string" },
          "container": { "type": "string" },
          "previous": { "type": "boolean" },
          "tail_lines": { "type": "integer" }
        },
        "required": ["namespace", "pod", "container"]
      }
    }
  }
  ```
- Any unauthorized or mutating tool call triggers an immediate rejection error: `ValueError: Unauthorized tool call: delete_pod`.

---

## 3. The Implementation Plan & Architectural Blueprint

### Tool Execution Flow
```text
Agent Request (`call_tool: get_container_logs(pod="api", tail=50)`)
               │
               ▼
       ToolRegistry.execute()
               │
               ├─► Check: Is tool registered in whitelist?
               │     └─► NO: Raise ValueError("Unauthorized tool")
               │
               ├─► Check: Is tool read-only?
               │     └─► NO: Reject mutating operation
               │
               ▼
    Async Implementation (`agents/tools/kubernetes.py`)
               │
               ▼
    Sanitizer (Scrub Secret tokens)
               │
               ▼
    Structured JSON Return Value
```

### Files to Create and Modify
- `[NEW] agents/tools/__init__.py`: Package init.
- `[NEW] agents/tools/registry.py`: `ToolRegistry` with schema generation and invocation dispatcher.
- `[NEW] agents/tools/kubernetes.py`: Async read-only Kubernetes tools.
- `[NEW] agents/tools/docker.py`: Async read-only Docker tools.
- `[NEW] agents/tests/test_tools.py`: Unit tests mocking subprocess and API client.

---

## 4. Detailed Task Breakdown

- [ ] **Task 2.1: Implement ToolRegistry (`registry.py`)**
  - Implement `ToolRegistry` class with `register(name, description)` decorator.
  - Inspect function parameter types via `inspect.signature` to construct Ollama JSON schemas.
  - Implement `async execute(name, **kwargs) -> Dict[str, Any]` with argument validation.
  - Enforce whitelist: Raise `ValueError` if the requested tool name is not registered.

- [ ] **Task 2.2: Implement Kubernetes Read Tools (`kubernetes.py`)**
  - `get_pod_status(namespace: str, pod: str) -> Dict[str, Any]`: Returns phase, containerStatuses, lastState.
  - `get_container_logs(namespace: str, pod: str, container: str, tail_lines: int = 100, previous: bool = False) -> Dict[str, Any]`: Bounded log fetcher.
  - `get_pod_events(namespace: str, pod: str) -> List[Dict[str, Any]]`: Returns warning events sorted by timestamp.
  - `get_deployment_spec(namespace: str, deployment: str) -> Dict[str, Any]`: Returns replicas, selector, and resource requirements.

- [ ] **Task 2.3: Implement Docker Read Tools (`docker.py`)**
  - `get_docker_container_inspect(container_id: str) -> Dict[str, Any]`: Returns state, exitCode, OOMKilled, restartCount.
  - `get_docker_logs(container_id: str, tail: int = 100) -> Dict[str, Any]`: Returns recent stdout/stderr lines.

- [ ] **Task 2.4: Tool Layer Unit Tests (`test_tools.py`)**
  - Mock `kubectl` and Docker client outputs.
  - Assert that calling unregistered tools raises `ValueError`.
  - Assert that `tail_lines` bounding restricts excessive log payloads.

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/tools/registry.py
import inspect
from typing import Callable, Dict, Any, Awaitable, List

class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, Dict[str, Any]] = {}

    def register(self, name: str, description: str):
        def decorator(func: Callable[..., Awaitable[Any]]):
            sig = inspect.signature(func)
            params = {}
            for param in sig.parameters.values():
                p_type = "string"
                if param.annotation == int:
                    p_type = "integer"
                elif param.annotation == bool:
                    p_type = "boolean"
                params[param.name] = {"type": p_type}

            self._tools[name] = {
                "name": name,
                "description": description,
                "func": func,
                "schema": {
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": description,
                        "parameters": {
                            "type": "object",
                            "properties": params,
                            "required": [p.name for p in sig.parameters.values() if p.default == inspect.Parameter.empty]
                        }
                    }
                }
            }
            return func
        return decorator

    async def execute(self, name: str, **kwargs) -> Any:
        if name not in self._tools:
            raise ValueError(f"Unauthorized or unknown tool: {name}")
        return await self._tools[name]["func"](**kwargs)

    def get_ollama_tools(self) -> List[Dict[str, Any]]:
        return [tool["schema"] for tool in self._tools.values()]

tool_registry = ToolRegistry()
```

---

## 6. Edge Cases & Failure Handling
- **Tool Timeout**: Wrap tool execution in `asyncio.wait_for(..., timeout=10.0)`. Return `{"error": "Tool execution timed out after 10s"}` on expiry.
- **RBAC Forbidden**: Catch 403 Forbidden responses from Kubernetes and return `{"error": "Forbidden", "message": "User lacks permissions to read logs"}`.

---

## 7. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_tools.py` — all tests pass.
- [ ] Verify that no write or delete operations exist in the tool registry.
- [ ] Verify Ollama tool schemas match function arguments.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 3 — Issue #274

## Overview
Build an in-memory auditable Evidence Store and Tool Audit Trail that records every tool call with millisecond timings and links findings to evidence IDs.

Part of **Milestone v4.0.0** — Phase 3 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(agents): Phase 3 - Tool Audit Logging and Evidence Store`
> **PR SCOPE**: Provenance tracking and auditable storage.

---

## 1. Description of What Has to Be Done
In production SRE tools, AI explainability is non-negotiable. Whenever an agent states "The container was killed because the memory limit was 256Mi", it must link directly to the specific evidence ID and tool call record that proved it.

Contributors must:
1. Implement `ToolCallRecord` tracking `call_id`, `agent_role`, `tool_name`, `arguments`, `result`, `duration_ms`, and `status`.
2. Implement `FindingRecord` capturing `claim`, `confidence`, and `evidence_refs` (array of call or evidence IDs).
3. Implement `EvidenceStore` to store tool calls and findings in memory during the analysis session.
4. Hook `ToolRegistry.execute()` to automatically generate and record audit entries without manual agent boilerplate.
5. Provide a provenance resolver: `get_provenance(finding_id)` returns the exact historical facts justifying any diagnosis.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- Every tool call executed by any specialist agent is automatically assigned an audit ID (`call-a1b2c3d4`).
- Execution duration is measured in milliseconds.
- Findings cannot be recorded without referencing at least one evidence ID.
- The complete session audit log can be serialized to JSON for post-mortem analysis.

### Example Provenance Lookup Output
```python
provenance = store.get_provenance("finding-oom-001")
# Returns:
{
  "finding": {
    "finding_id": "finding-oom-001",
    "agent_role": "runtime",
    "claim": "Container was killed by OOMKiller (exit code 137).",
    "confidence": 0.98,
    "evidence_refs": ["ev.pod.container.status", "call-4f9e12"]
  },
  "supporting_tool_calls": [
    {
      "call_id": "call-4f9e12",
      "tool_name": "get_container_logs",
      "arguments": { "previous": True, "tail_lines": 50 },
      "duration_ms": 142,
      "status": "success"
    }
  ]
}
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Audit Flow Diagram
```text
Agent calls Tool (`get_pod_events`)
       │
       ▼
ToolRegistry.execute()
       │
       ├─► Record start_time = time.time()
       ├─► Execute tool
       ├─► Record duration_ms = (time.time() - start_time) * 1000
       │
       ▼
EvidenceStore.record_tool_call(ToolCallRecord)
       │
       ▼
Agent formulates Finding ("Pod was restarted by kubelet")
       │
       ▼
EvidenceStore.record_finding(FindingRecord with evidence_refs=[call_id])
```

### Files to Create and Modify
- `[NEW] agents/core/store.py`: `EvidenceStore`, `ToolCallRecord`, and `FindingRecord`.
- `[MODIFY] agents/tools/registry.py`: Integrate automatic recording on `execute()`.
- `[NEW] agents/tests/test_store.py`: Unit tests for provenance and audit logging.

---

## 4. Detailed Task Breakdown

- [ ] **Task 3.1: Define Audit Dataclasses (`store.py`)**
  - Define `ToolCallRecord` with `call_id` (auto-generated UUID), `agent_role`, `tool_name`, `arguments`, `result`, `error`, `duration_ms`, and `status`.
  - Define `FindingRecord` with `finding_id`, `agent_role`, `claim`, `confidence`, and `evidence_refs: List[str]`.

- [ ] **Task 3.2: Implement In-Memory EvidenceStore (`store.py`)**
  - Implement thread-safe storage using Python lists and dictionaries.
  - Implement `record_tool_call(record: ToolCallRecord)`.
  - Implement `record_finding(finding: FindingRecord)`.
  - Implement `get_provenance(finding_id: str) -> Dict[str, Any]` linking finding to supporting tool calls.
  - Implement `export_audit_log() -> List[Dict[str, Any]]`.

- [ ] **Task 3.3: Instrument ToolRegistry (`registry.py`)**
  - Update `ToolRegistry.execute` to take an optional `agent_role: str = ""`.
  - Automatically measure wall-clock duration and record every call into `EvidenceStore`.

- [ ] **Task 3.4: Write Unit Tests (`test_store.py`)**
  - Test recording successful and failed tool calls.
  - Test provenance retrieval and assert that unreferenced findings return empty supporting lists.
  - Test audit log export.

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/core/store.py
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
import time
import uuid

@dataclass
class ToolCallRecord:
    call_id: str = field(default_factory=lambda: f"call-{uuid.uuid4().hex[:8]}")
    agent_role: str = ""
    tool_name: str = ""
    arguments: Dict[str, Any] = field(default_factory=dict)
    result: Any = None
    error: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    duration_ms: int = 0
    status: str = "pending" # "success" | "error" | "timed_out"

@dataclass
class FindingRecord:
    finding_id: str
    agent_role: str
    claim: str
    confidence: float
    evidence_refs: List[str]

class EvidenceStore:
    def __init__(self):
        self._tool_calls: List[ToolCallRecord] = []
        self._findings: Dict[str, FindingRecord] = {}

    def record_tool_call(self, record: ToolCallRecord) -> None:
        self._tool_calls.append(record)

    def record_finding(self, finding: FindingRecord) -> None:
        self._findings[finding.finding_id] = finding

    def get_provenance(self, finding_id: str) -> Dict[str, Any]:
        finding = self._findings.get(finding_id)
        if not finding:
            return {}
        return {
            "finding": finding.__dict__,
            "supporting_tool_calls": [c.__dict__ for c in self._tool_calls if c.call_id in finding.evidence_refs]
        }

    def export_audit_log(self) -> List[Dict[str, Any]]:
        return [call.__dict__ for call in self._tool_calls]
```

---

## 6. Edge Cases & Failure Handling
- **Tool Exceptions**: When a tool throws an unhandled error, `ToolCallRecord` must catch the exception, set `status="error"`, populate `error=str(e)`, and re-raise or return the error cleanly.
- **Sensitive Arguments**: Scrub keys containing `password` or `token` from `record.arguments` before storage.

---

## 7. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_store.py` — all tests pass.
- [ ] Provenance retrieval verified with supporting tool calls.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 4 — Issue #275

## Overview
Implement a deterministic rule engine that diagnoses well-known Kubernetes and Docker failure signatures in < 5ms before invoking any LLM.

Part of **Milestone v4.0.0** — Phase 4 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(agents): Phase 4 - Deterministic Diagnostic Rule Engine`
> **PR SCOPE**: Rule engine and core Kubernetes failure signatures.

---

## 1. Description of What Has to Be Done
Many Kubernetes failures are deterministic facts, not subjective opinions. If a container's last termination reason is `OOMKilled` with exit code `137`, running an LLM to "guess" what happened is slow, wasteful, and prone to hallucinations.

Contributors must:
1. Define a `BaseRule` abstract class and a `RuleMatch` result object.
2. Implement rules for 5 canonical Kubernetes failure signatures:
   - `OOMKilledRule`: Matches exit code 137 or reason `OOMKilled`.
   - `ImagePullRule`: Matches `ErrImagePull` and `ImagePullBackOff`.
   - `CrashLoopRule`: Matches `CrashLoopBackOff` with exit codes > 0.
   - `ProbeFailureRule`: Matches failed liveness or readiness probe events.
   - `SchedulingRule`: Matches `FailedScheduling` (insufficient CPU/memory).
3. Implement `RuleEngine` that evaluates all registered rules against an `EvidenceBundle`.
4. If a rule match has `confidence >= 0.99`, immediately output the diagnosis and bypass unnecessary LLM turns.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- Well-known outages are diagnosed instantly (< 5 milliseconds).
- The diagnosis cites exact evidence IDs (`ev.pod.container.status`, `ev.pod.events`).
- When no deterministic signature is matched (e.g. subtle logic bugs, silent memory leaks), the engine returns `None` or an empty list, allowing specialist agents to take over.

### Example Rule Match Output
```python
engine = RuleEngine([OOMKilledRule(), ImagePullRule(), CrashLoopRule()])
matches = engine.evaluate_all(bundle)
# matches[0]:
# RuleMatch(
#     rule_id="rule.kubernetes.oom_killed",
#     title="Container Out-Of-Memory (OOMKilled)",
#     root_cause="Container 'auth' terminated with exit code 137 (OOMKilled). Memory limit was exceeded.",
#     confidence=1.0,
#     evidence_ids=["ev.pod.container.status"]
# )
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Execution Pipeline
```text
         EvidenceBundle
               │
               ▼
          RuleEngine
               │
   ┌───────────┼───────────┬───────────┐
   ▼           ▼           ▼           ▼
OOM Rule   ImagePull   CrashLoop    Probe Rule
   │           │           │           │
   └───────────┼───────────┴───────────┘
               │
       RuleMatch found?
       ├── YES (confidence == 1.0): Instant Diagnosis (Skip LLM)
       └── NO: Pass to Specialist Agent Council (Phase 5)
```

### Files to Create and Modify
- `[NEW] agents/rules/__init__.py`: Package init.
- `[NEW] agents/rules/base.py`: `BaseRule` interface and `RuleMatch` class.
- `[NEW] agents/rules/oom.py`: `OOMKilledRule`.
- `[NEW] agents/rules/image_pull.py`: `ImagePullRule`.
- `[NEW] agents/rules/crashloop.py`: `CrashLoopRule`.
- `[NEW] agents/rules/probes.py`: `ProbeFailureRule`.
- `[NEW] agents/rules/scheduling.py`: `SchedulingRule`.
- `[NEW] agents/rules/engine.py`: `RuleEngine` dispatcher.
- `[NEW] agents/tests/test_rules.py`: Test suite covering matches and non-matches.

---

## 4. Detailed Task Breakdown

- [ ] **Task 4.1: Implement BaseRule and RuleMatch (`base.py`)**
  - Implement `RuleMatch` dataclass: `rule_id`, `title`, `root_cause`, `confidence`, `evidence_ids: List[str]`.
  - Implement `BaseRule` ABC with abstract method `evaluate(bundle: EvidenceBundle) -> Optional[RuleMatch]`.

- [ ] **Task 4.2: Implement Concrete Kubernetes Rules**
  - In `oom.py`: inspect `ev.pod.container.status`. If `terminated.reason == "OOMKilled"` or `exitCode == 137`, return match.
  - In `image_pull.py`: inspect container `waiting.reason` for `ErrImagePull` or `ImagePullBackOff`.
  - In `crashloop.py`: inspect container `waiting.reason == "CrashLoopBackOff"`, extract `restartCount` and exit code.
  - In `probes.py`: inspect `ev.pod.events` for messages containing `Liveness probe failed` or `Readiness probe failed`.
  - In `scheduling.py`: inspect pod phase `Pending` and events for `FailedScheduling`.

- [ ] **Task 4.3: Implement RuleEngine (`engine.py`)**
  - Maintain list of active rules.
  - `evaluate_all(bundle: EvidenceBundle) -> List[RuleMatch]`.
  - Provide helper `get_primary_match(bundle) -> Optional[RuleMatch]` returning highest confidence match.

- [ ] **Task 4.4: Write Unit Tests (`test_rules.py`)**
  - Test each rule with positive fixtures (confirm match, 1.0 confidence).
  - Test each rule with negative/healthy fixtures (confirm `None`).

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/rules/base.py
from abc import ABC, abstractmethod
from typing import Optional, List
from agents.core.evidence import EvidenceBundle

class RuleMatch:
    def __init__(self, rule_id: str, title: str, root_cause: str, confidence: float, evidence_ids: List[str]):
        self.rule_id = rule_id
        self.title = title
        self.root_cause = root_cause
        self.confidence = confidence
        self.evidence_ids = evidence_ids

class BaseRule(ABC):
    rule_id: str
    title: str

    @abstractmethod
    def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
        pass
```

```python
# agents/rules/oom.py
from agents.rules.base import BaseRule, RuleMatch
from agents.core.evidence import EvidenceBundle
from typing import Optional

class OOMKilledRule(BaseRule):
    rule_id = "rule.kubernetes.oom_killed"
    title = "Container Out-Of-Memory (OOMKilled)"

    def evaluate(self, bundle: EvidenceBundle) -> Optional[RuleMatch]:
        status = bundle.get("ev.pod.container.status")
        if not status or not status.data:
            return None
        last_state = status.data.get("lastState", {}).get("terminated", {})
        if last_state.get("reason") == "OOMKilled" or last_state.get("exitCode") == 137:
            container = bundle.target.container_name or "container"
            return RuleMatch(
                rule_id=self.rule_id,
                title=self.title,
                root_cause=f"Container '{container}' terminated with exit code 137 (OOMKilled). Memory limit was exceeded.",
                confidence=1.0,
                evidence_ids=["ev.pod.container.status"]
            )
        return None
```

---

## 6. Edge Cases & Failure Handling
- **Missing Container Status**: If `ev.pod.container.status` is missing or has `status != AVAILABLE`, rule must return `None` safely without `AttributeError`.
- **Multiple Rules Match**: `RuleEngine` must sort matches by confidence descending so highest certainty is prioritized.

---

## 7. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_rules.py` — all tests pass.
- [ ] Benchmarked execution time for `RuleEngine.evaluate_all()` is under 10ms.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 5 — Issue #276

## Overview
Implement structured specialist agents (Runtime, Config, Resource) using Ollama with strict JSON schemas to eliminate hallucinations.

Part of **Milestone v4.0.0** — Phase 5 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(agents): Phase 5 - Structured Specialist Agents (Runtime, Config, Resource)`
> **PR SCOPE**: Specialist agent definitions and prompt engineering.

---

## 1. Description of What Has to Be Done
Generic SRE prompts often hallucinate causes or mix up symptoms. In Phase 5, we introduce a council of three domain-specialized agents:
1. **RuntimeLogAgent**: Expert in process execution, signals, exit codes (137, 1, 126, 143), panic traces, and stderr logs.
2. **ConfigDependencyAgent**: Expert in declarative manifests, missing ConfigMaps/Secrets, DNS resolution, and probe configurations.
3. **ClusterResourceAgent**: Expert in node pressure (MemoryPressure, DiskPressure), QoS classes (`Burstable` vs `Guaranteed`), and CPU throttling.

Every specialist must enforce strict Ollama JSON mode (`format="json"`) and output a standardized schema containing summary, evidence citations, and confidence.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- Each specialist agent investigates only its domain of expertise.
- Output is 100% deterministic JSON conforming to `SpecialistReport`.
- If a specialist finds no problems in its domain, it explicitly reports healthy with low suspicion:
  ```json
  {
    "summary": "No runtime crashes or non-zero exit codes detected.",
    "evidence": ["Container exitCode == 0"],
    "hypotheses": [],
    "confidence": "low"
  }
  ```
- If an agent produces invalid JSON, the base class catches the error and provides a fallback structure rather than crashing.

---

## 3. The Implementation Plan & Architectural Blueprint

### Specialist Architecture
```text
                     EvidenceBundle
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
RuntimeLogAgent    ConfigDependencyAgent  ClusterResourceAgent
 (Focus: Logs,       (Focus: Manifests,    (Focus: Node Limits,
  Exit Codes)         Probes, Secrets)      QoS, Pressure)
       │                   │                   │
       ▼                   ▼                   ▼
Ollama JSON Chat    Ollama JSON Chat    Ollama JSON Chat
       │                   │                   │
       ▼                   ▼                   ▼
SpecialistReport    SpecialistReport    SpecialistReport
```

### Files to Create and Modify
- `[NEW] agents/specialists/__init__.py`: Package init.
- `[NEW] agents/specialists/base.py`: `BaseSpecialistAgent` with prompt formatting and JSON parsing.
- `[NEW] agents/specialists/runtime.py`: `RuntimeLogAgent`.
- `[NEW] agents/specialists/config.py`: `ConfigDependencyAgent`.
- `[NEW] agents/specialists/resource.py`: `ClusterResourceAgent`.
- `[NEW] agents/tests/test_specialists.py`: Unit tests with mocked Ollama chat responses.

---

## 4. Detailed Task Breakdown

- [ ] **Task 5.1: Implement BaseSpecialistAgent (`base.py`)**
  - Implement `BaseSpecialistAgent` abstract class taking `client: ollama.Client` and `model: str`.
  - Implement `run_investigation(bundle: EvidenceBundle) -> Dict[str, Any]`.
  - Pass `format="json"` and `options={"temperature": 0.1}` to `client.chat()`.
  - Implement JSON decode recovery with fallback dictionary.

- [ ] **Task 5.2: Implement RuntimeLogAgent (`runtime.py`)**
  - System prompt: Role is Senior Linux & Container Runtime Diagnostics Specialist.
  - Extracts container exit codes, termination signals, and previous logs.

- [ ] **Task 5.3: Implement ConfigDependencyAgent (`config.py`)**
  - System prompt: Role is Kubernetes Declarative Configuration Specialist.
  - Inspects missing volumes, missing ConfigMap keys, and probe timeouts.

- [ ] **Task 5.4: Implement ClusterResourceAgent (`resource.py`)**
  - System prompt: Role is Cluster Capacity & Linux Cgroups Specialist.
  - Inspects node conditions and pod memory/CPU requests versus limits.

- [ ] **Task 5.5: Write Specialist Unit Tests (`test_specialists.py`)**
  - Mock `ollama.Client.chat` returning valid JSON.
  - Mock `ollama.Client.chat` returning malformed text (verify recovery).

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/specialists/base.py
import json
from abc import ABC, abstractmethod
from typing import Dict, Any, List
import ollama
from agents.core.evidence import EvidenceBundle

class BaseSpecialistAgent(ABC):
    role: str
    display_name: str
    icon: str

    def __init__(self, client: ollama.Client, model: str):
        self.client = client
        self.model = model

    @abstractmethod
    def build_prompt(self, bundle: EvidenceBundle) -> str:
        pass

    @abstractmethod
    def get_system_prompt(self) -> str:
        pass

    def run_investigation(self, bundle: EvidenceBundle) -> Dict[str, Any]:
        prompt = self.build_prompt(bundle)
        response = self.client.chat(
            model=self.model,
            messages=[
                {"role": "system", "content": self.get_system_prompt()},
                {"role": "user", "content": prompt}
            ],
            format="json",
            options={"temperature": 0.1}
        )
        try:
            return json.loads(response["message"]["content"])
        except (json.JSONDecodeError, KeyError):
            return {
                "summary": "Agent output parsing failed",
                "evidence": [],
                "hypotheses": [],
                "confidence": "low"
            }
```

---

## 6. Edge Cases & Failure Handling
- **Empty Logs**: If previous logs are empty, `RuntimeLogAgent` must note that no previous crash log was persisted rather than hallucinating an application error.
- **Ollama Timeout**: If Ollama takes longer than expected, catch timeout and return fallback report with `confidence="low"`.

---

## 7. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_specialists.py` — all tests pass.
- [ ] Output schema tested across all 3 specialist agents.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 6 — Issue #277

## Overview
Build an async parallel agent orchestrator using `asyncio` that enforces concurrency semaphores, per-agent timeouts, and error isolation.

Part of **Milestone v4.0.0** — Phase 6 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(agents): Phase 6 - Parallel Agent Orchestrator with Failure Isolation`
> **PR SCOPE**: Async execution, semaphores, and error boundaries.

---

## 1. Description of What Has to Be Done
Running specialist agents sequentially triples investigation latency. However, running unbounded parallel LLM calls against a local Ollama server can exhaust RAM/VRAM and cause system freezing.

Contributors must:
1. Implement `AgentOrchestrator` using Python `asyncio`.
2. Limit concurrent Ollama requests using `asyncio.Semaphore(max_concurrency)` (default: 2).
3. Execute synchronous Ollama client calls inside `loop.run_in_executor(None, ...)`.
4. Wrap each agent in an individual `asyncio.wait_for(..., timeout=timeout_seconds)` (default: 25.0s).
5. Ensure **Failure Isolation**: If one specialist agent times out or crashes, the remaining agents must complete successfully.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- Specialists execute concurrently, reducing total triaging time from ~45s to ~15s.
- Local hardware is protected by the concurrency semaphore.
- If `RuntimeLogAgent` crashes, `ConfigDependencyAgent` and `ClusterResourceAgent` still return their findings cleanly:
  ```json
  [
    { "role": "runtime", "status": "failed", "error": "Agent timed out after 25s" },
    { "role": "config", "status": "completed", "result": { ... } },
    { "role": "resource", "status": "completed", "result": { ... } }
  ]
  ```

---

## 3. The Implementation Plan & Architectural Blueprint

### Concurrency Flow
```text
                     AgentOrchestrator.run_all()
                                │
                    asyncio.gather(*tasks)
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
 Task: RuntimeAgent     Task: ConfigAgent      Task: ResourceAgent
        │                       │                       │
 Semaphore Acquire (max=2)      │              Semaphore Wait...
        │                       │                       │
 run_in_executor(...)    run_in_executor(...)           │
        │                       │                       │
 Semaphore Release ─────────────┼───────────────────────► Semaphore Acquire
        │                       │                       │
 wait_for(timeout=25s)   wait_for(timeout=25s)   wait_for(timeout=25s)
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                    Aggregated Results List
```

### Files to Create and Modify
- `[NEW] agents/orchestration/__init__.py`: Package init.
- `[NEW] agents/orchestration/orchestrator.py`: `AgentOrchestrator` class.
- `[NEW] agents/tests/test_orchestrator.py`: Concurrency, timeout, and failure isolation tests.

---

## 4. Detailed Task Breakdown

- [ ] **Task 6.1: Implement AgentOrchestrator (`orchestrator.py`)**
  - Accept `agents: List[BaseSpecialistAgent]`, `max_concurrency: int = 2`, and `timeout_seconds: float = 25.0`.
  - Use `asyncio.Semaphore(max_concurrency)` to guard execution slots.
  - Use `loop.run_in_executor` to execute blocking `agent.run_investigation(bundle)`.
  - Catch `asyncio.TimeoutError` and return `{"role": agent.role, "status": "failed", "error": "Timeout"}`.
  - Catch general `Exception` and return `{"role": agent.role, "status": "failed", "error": str(e)}`.

- [ ] **Task 6.2: Write Unit Tests (`test_orchestrator.py`)**
  - Test concurrent execution speedup.
  - Test that semaphore limits active concurrent tasks.
  - Test that an agent raising an unhandled exception does not fail the batch.
  - Test that timeout cancels the slow agent and returns partial results.

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/orchestration/orchestrator.py
import asyncio
from typing import List, Dict, Any
from agents.core.evidence import EvidenceBundle
from agents.specialists.base import BaseSpecialistAgent

class AgentOrchestrator:
    def __init__(self, agents: List[BaseSpecialistAgent], max_concurrency: int = 2, timeout_seconds: float = 25.0):
        self.agents = agents
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.timeout = timeout_seconds

    async def _execute_agent(self, agent: BaseSpecialistAgent, bundle: EvidenceBundle) -> Dict[str, Any]:
        async with self.semaphore:
            loop = asyncio.get_running_loop()
            try:
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, agent.run_investigation, bundle),
                    timeout=self.timeout
                )
                return {"role": agent.role, "status": "completed", "result": result}
            except asyncio.TimeoutError:
                return {"role": agent.role, "status": "failed", "error": f"Timed out after {self.timeout}s"}
            except Exception as e:
                return {"role": agent.role, "status": "failed", "error": str(e)}

    async def run_all(self, bundle: EvidenceBundle) -> List[Dict[str, Any]]:
        tasks = [self._execute_agent(agent, bundle) for agent in self.agents]
        return await asyncio.gather(*tasks)
```

---

## 6. Edge Cases & Failure Handling
- **All Agents Timeout**: If all specialists timeout, `run_all()` returns 3 failed records; orchestrator must not crash.
- **Thread Pool Starvation**: Ensure worker threads are not blocked indefinitely by enforcing `asyncio.wait_for`.

---

## 7. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_orchestrator.py` — all tests pass.
- [ ] Failure isolation tested and confirmed.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 7 — Issue #278

## Overview
Implement a bounded multi-turn progressive tool-calling loop (ReAct pattern) allowing specialist agents to request additional cluster evidence dynamically.

Part of **Milestone v4.0.0** — Phase 7 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(agents): Phase 7 - Bounded Progressive Tool-Calling Loop`
> **PR SCOPE**: Multi-turn agent investigation loop.

---

## 1. Description of What Has to Be Done
In complex outages, initial evidence is often incomplete. For example, `RuntimeLogAgent` may notice an exit code 137, but needs to inspect previous logs from a specific container. Instead of hardcoding all queries upfront, the progressive loop lets an agent request a tool execution, inspects the result, and continues reasoning.

Contributors must:
1. Implement `ProgressiveInvestigationLoop` supporting multi-turn agent execution up to `max_turns = 3`.
2. Format tool call requests and responses so Ollama models can alternate between reasoning and querying.
3. Automatically record all dynamic tool executions into the `EvidenceStore`.
4. Ensure recursion and infinite loop safeguards: Once `max_turns` is reached, force the model to synthesize a final conclusion with available evidence.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- An agent can return either a final conclusion or an action calling a tool:
  ```json
  { "action": "call", "tool": "get_container_logs", "args": { "previous": true, "tail_lines": 50 } }
  ```
- The loop executes the requested tool, appends the result to the history, and invokes the agent for the next turn.
- The investigation concludes within at most 3 turns.

---

## 3. The Implementation Plan & Architectural Blueprint

### ReAct Loop Diagram
```text
          EvidenceBundle
                │
                ▼
  Turn 1: Agent evaluates evidence
                │
        Decision Type?
        ├── "final_answer": Return SpecialistReport
        └── "call_tool":
                │
                ▼
        ToolRegistry.execute(tool, args)
                │
                ▼
        Record in EvidenceStore
                │
                ▼
  Turn 2: Agent evaluates evidence + Tool Result
                │
        Decision Type?
        ├── "final_answer": Return SpecialistReport
        └── (Repeat until max_turns=3)
```

### Files to Create and Modify
- `[NEW] agents/orchestration/tool_loop.py`: `ProgressiveInvestigationLoop`.
- `[NEW] agents/tests/test_tool_loop.py`: Multi-turn loop unit tests.

---

## 4. Detailed Task Breakdown

- [ ] **Task 7.1: Implement ProgressiveInvestigationLoop (`tool_loop.py`)**
  - Accept `tool_registry: ToolRegistry`, `evidence_store: EvidenceStore`, and `max_turns: int = 3`.
  - Maintain an in-memory `turn_history` list.
  - Implement `async run_agent_loop(agent, bundle) -> Dict[str, Any]`.
  - Handle both Ollama native function calling and structured JSON tool actions.

- [ ] **Task 7.2: Bound Loop Execution**
  - If `turn >= max_turns`, instruct the agent: `"Max investigation depth reached. Provide your best diagnosis based on current facts."`

- [ ] **Task 7.3: Unit Tests (`test_tool_loop.py`)**
  - Test multi-turn flow where an agent calls `get_container_logs` and then produces final diagnosis.
  - Test that reaching `max_turns` terminates cleanly without hanging.

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/orchestration/tool_loop.py
from typing import Dict, Any, List
from agents.tools.registry import ToolRegistry
from agents.core.store import EvidenceStore

class ProgressiveInvestigationLoop:
    def __init__(self, tool_registry: ToolRegistry, evidence_store: EvidenceStore, max_turns: int = 3):
        self.tools = tool_registry
        self.store = evidence_store
        self.max_turns = max_turns

    async def run_agent_loop(self, agent, bundle) -> Dict[str, Any]:
        history: List[Dict[str, Any]] = []
        for turn in range(self.max_turns):
            decision = await agent.evaluate_next_step(bundle, history)
            if decision.get("action") == "final_answer":
                return decision["report"]
            elif decision.get("action") == "call":
                tool_name = decision["tool"]
                args = decision.get("args", {})
                tool_res = await self.tools.execute(tool_name, **args)
                history.append({"tool": tool_name, "args": args, "result": tool_res})
        return await agent.force_synthesis(bundle, history)
```

---

## 6. Edge Cases & Failure Handling
- **Tool Failure in Loop**: If a tool returns an error, feed the error back to the agent so it can pivot to an alternative hypothesis.

---

## 7. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_tool_loop.py` — all tests pass.
- [ ] Hard stop at 3 turns verified.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 8 — Issue #279

## Overview
Build the Lead SRE Investigator Agent and Hypothesis Engine that correlates reports across specialists and formulates competing root-cause hypotheses.

Part of **Milestone v4.0.0** — Phase 8 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(agents): Phase 8 - Lead Investigator Hypothesis Engine`
> **PR SCOPE**: Hypothesis generation and specialist correlation.

---

## 1. Description of What Has to Be Done
During a real incident, different specialists report contradictory symptoms. For example, `RuntimeLogAgent` may report a process crash, while `ConfigDependencyAgent` reports a failed readiness probe. The Lead SRE Investigator acts as the incident commander: it aggregates all findings, discards secondary cascade symptoms, and generates 2-3 ranked competing hypotheses.

Contributors must:
1. Define the `Hypothesis` data structure with `likelihood` (0.0 to 1.0), `supporting_evidence`, and `contradicting_evidence`.
2. Implement `LeadInvestigatorAgent` with an SRE synthesis prompt.
3. Eliminate duplicate or misleading findings and rank the most probable initial trigger.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- The Lead Investigator produces structured hypotheses:
  ```json
  [
    {
      "id": "hyp-01",
      "description": "Application OOMKilled due to 256Mi memory limit under peak load.",
      "likelihood": 0.92,
      "supporting_evidence": ["Exit code 137", "Memory limit 256Mi", "OOMKilled reason"],
      "contradicting_evidence": []
    },
    {
      "id": "hyp-02",
      "description": "Slow memory leak triggered by database reconnection loop.",
      "likelihood": 0.45,
      "supporting_evidence": ["PostgreSQL reconnection warnings in stderr"],
      "contradicting_evidence": ["Node MemoryPressure is False"]
    }
  ]
  ```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] agents/synthesis/__init__.py`: Package init.
- `[NEW] agents/synthesis/hypotheses.py`: `Hypothesis` dataclass.
- `[NEW] agents/synthesis/investigator.py`: `LeadInvestigatorAgent`.
- `[NEW] agents/tests/test_investigator.py`: Synthesis unit tests.

---

## 4. Detailed Task Breakdown

- [ ] **Task 8.1: Implement Hypothesis Model (`hypotheses.py`)**
  - Implement `Hypothesis` with fields: `id`, `description`, `likelihood`, `supporting_evidence`, `contradicting_evidence`.

- [ ] **Task 8.2: Implement LeadInvestigatorAgent (`investigator.py`)**
  - System prompt: Role is Principal SRE Incident Commander.
  - Implement `formulate_hypotheses(specialist_findings: List[Dict[str, Any]]) -> List[Hypothesis]`.
  - Parse Ollama JSON response into a list of `Hypothesis` objects.

- [ ] **Task 8.3: Unit Tests (`test_investigator.py`)**
  - Test synthesis with complementary findings.
  - Test synthesis with conflicting specialist reports.

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/synthesis/hypotheses.py
from dataclasses import dataclass, field
from typing import List

@dataclass
class Hypothesis:
    id: str
    description: str
    likelihood: float
    supporting_evidence: List[str]
    contradicting_evidence: List[str] = field(default_factory=list)
```

---

## 6. Edge Cases & Failure Handling
- **Low Confidence**: If evidence is inconclusive, the Lead Investigator must assign likelihood < 0.5 rather than forcing high certainty.

---

## 7. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_investigator.py` — all tests pass.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 9 — Issue #280

## Overview
Implement an adversarial Cross-Agent Validator that cross-checks proposed hypotheses against cluster facts to detect hallucinations and false positives.

Part of **Milestone v4.0.0** — Phase 9 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(agents): Phase 9 - Cross-Agent Validator and Disagreement Resolution`
> **PR SCOPE**: Validation engine and contradiction detection.

---

## 1. Description of What Has to Be Done
LLMs exhibit confirmation bias—once a hypothesis is formed, models easily overlook contradictory facts. The Validator acts as an adversarial check: it specifically searches for facts in the `EvidenceBundle` that disprove the Lead Investigator's top hypothesis.

Contributors must:
1. Implement `CrossAgentValidator` with heuristic contradiction checks.
2. Check for hard factual contradictions (e.g. hypothesis claims OOMKill, but exit code was 1; hypothesis claims DNS failure, but CoreDNS is 100% healthy).
3. If contradictions are found, downgrade the confidence score and attach the contradiction reason.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- The validator either confirms the hypothesis (`approved=True`) or rejects/downgrades it (`approved=False`).
- If rejected, the reason is surfaced clearly:
  ```json
  {
    "approved": false,
    "confidence_score": 0.25,
    "reason": "Hypothesis claims OOMKilled, but container exit code was 1 (application panic), not 137."
  }
  ```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] agents/validation/__init__.py`: Package init.
- `[NEW] agents/validation/validator.py`: `CrossAgentValidator` and `ValidationResult`.
- `[NEW] agents/tests/test_validator.py`: Contradiction test suite.

---

## 4. Detailed Task Breakdown

- [ ] **Task 9.1: Implement ValidationResult (`validator.py`)**
  - Dataclass containing `approved: bool`, `confidence_score: float`, and `reason: str`.

- [ ] **Task 9.2: Implement CrossAgentValidator (`validator.py`)**
  - Implement ground-truth assertion rules against the `EvidenceBundle`.
  - Cross-check exit codes, restart counts, probe thresholds, and node conditions.

- [ ] **Task 9.3: Unit Tests (`test_validator.py`)**
  - Test valid hypothesis passes with approval.
  - Test invalid hypothesis with contradiction is flagged and penalized.

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/validation/validator.py
from typing import Dict, Any
from agents.core.evidence import EvidenceBundle
from agents.synthesis.hypotheses import Hypothesis

class ValidationResult:
    def __init__(self, approved: bool, confidence_score: float, reason: str):
        self.approved = approved
        self.confidence_score = confidence_score
        self.reason = reason

class CrossAgentValidator:
    def validate(self, top_hypothesis: Hypothesis, bundle: EvidenceBundle) -> ValidationResult:
        if "OOMKilled" in top_hypothesis.description:
            status = bundle.get("ev.pod.container.status")
            if status and status.data:
                last_exit = status.data.get("lastState", {}).get("terminated", {}).get("exitCode")
                if last_exit and last_exit != 137:
                    return ValidationResult(
                        approved=False,
                        confidence_score=0.2,
                        reason=f"Hypothesis claims OOMKilled but container exit code was {last_exit}, not 137."
                    )
        return ValidationResult(approved=True, confidence_score=top_hypothesis.likelihood, reason="No contradictions found.")
```

---

## 6. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_validator.py` — all tests pass.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 10 — Issue #281

## Overview
Synthesize the final Consensus Diagnosis and confidence scoring combining root cause, specialist findings, evidence citations, and recommended remediation.

Part of **Milestone v4.0.0** — Phase 10 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(agents): Phase 10 - Consensus Diagnosis Schema and Generator`
> **PR SCOPE**: Final diagnosis synthesis and schema compliance.

---

## 1. Description of What Has to Be Done
The user-facing CLI and UI require a unified, standardized consensus object. In Phase 10, contributors synthesize the verified top hypothesis, specialist findings, and best remediation recommendation into a clean `ConsensusDiagnosis` object that complies with the Node TypeScript schema in `src/agent/types.ts`.

---

## 2. Desired Outcome & Expected Behavior

### Expected Output
A serializable Python dictionary strictly matching:
```json
{
  "rootCause": "Container exceeded 256Mi memory limit under peak load",
  "confidence": "high",
  "findings": [
    { "role": "runtime", "summary": "Exit code 137 detected", "evidence": ["status.exitCode == 137"] },
    { "role": "config", "summary": "Memory limit set to 256Mi", "evidence": ["spec.resources.limits.memory"] }
  ],
  "bestSolution": {
    "actionTitle": "Increase Container Memory Limit",
    "steps": ["Increase limits.memory from 256Mi to 512Mi in deployment manifest", "Rollout restart deployment"],
    "commandToRun": "kubectl set resources deployment checkout-api --limits=memory=512Mi",
    "riskLevel": "low"
  },
  "evidenceCitations": ["ev.pod.container.status", "ev.resources.limits"]
}
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] agents/synthesis/consensus.py`: `ConsensusDiagnosis` and `BestSolution` dataclasses.
- `[NEW] agents/tests/test_consensus.py`: Synthesis and formatting tests.

---

## 4. Detailed Task Breakdown

- [ ] **Task 10.1: Implement Consensus Dataclasses (`consensus.py`)**
  - Implement `BestSolution` (action_title, steps, command_to_run, risk_level).
  - Implement `ConsensusDiagnosis` (root_cause, confidence, findings, best_solution, evidence_citations).
  - Implement `to_dict()` converting snake_case attributes to camelCase keys for Node compatibility.

- [ ] **Task 10.2: Map Confidence Scoring**
  - Score >= 0.8 -> `"high"`
  - Score >= 0.5 -> `"medium"`
  - Score < 0.5 -> `"low"`

- [ ] **Task 10.3: Unit Tests (`test_consensus.py`)**
  - Validate camelCase dictionary output against TypeScript schema.

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/synthesis/consensus.py
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

@dataclass
class BestSolution:
    action_title: str
    steps: List[str]
    command_to_run: Optional[str]
    risk_level: str

@dataclass
class ConsensusDiagnosis:
    root_cause: str
    confidence: str
    findings: List[Dict[str, Any]]
    best_solution: BestSolution
    evidence_citations: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rootCause": self.root_cause,
            "confidence": self.confidence,
            "findings": self.findings,
            "bestSolution": {
                "actionTitle": self.best_solution.action_title,
                "steps": self.best_solution.steps,
                "commandToRun": self.best_solution.command_to_run,
                "riskLevel": self.best_solution.risk_level
            },
            "evidenceCitations": self.evidence_citations
        }
```

---

## 6. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_consensus.py` — all tests pass.
- [ ] Schema matches `src/agent/types.ts` exactly.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 11 — Issue #282

## Overview
Define and validate the typed NDJSON streaming event protocol used for real-time inter-process communication between Node.js and Python.

Part of **Milestone v4.0.0** — Phase 11 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(protocol): Phase 11 - Real-Time NDJSON Streaming Event Protocol`
> **PR SCOPE**: Event schemas and cross-language protocol tests.

---

## 1. Description of What Has to Be Done
When Python runs multi-agent triage, the user interface in Node.js needs live updates (e.g. "Runtime Agent started", "Config Agent called tool get_container_logs", "Synthesizer formulated diagnosis"). This communication happens over `stdout` line-by-line using NDJSON.

Contributors must:
1. Formalize the complete event union in Python and TypeScript.
2. Ensure every Python event emission calls `sys.stdout.flush()` immediately to prevent OS line-buffering latency.
3. Redirect all non-protocol Python logs/diagnostics strictly to `sys.stderr`.
4. Implement a TypeScript parser in `src/agent/event-schema.ts` that validates incoming lines against the schema.

---

## 2. Desired Outcome & Expected Behavior

### Expected Event Stream
```text
{"event":"analysis_start","analysisId":"an-123","timestamp":"2026-09-11T12:00:00Z"}
{"event":"evidence_collected","count":12,"ids":["ev.pod.status","ev.logs"]}
{"event":"agent_start","role":"runtime","message":"Inspecting container exit code and logs..."}
{"event":"agent_tool_call","role":"runtime","tool":"get_container_logs","args":{"previous":true}}
{"event":"agent_tool_result","role":"runtime","tool":"get_container_logs","durationMs":120}
{"event":"agent_complete","role":"runtime","summary":"OOMKilled detected"}
{"event":"diagnosis_ready","consensus":{...}}
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] agents/core/events.py`: Event emission helper with `sys.stdout.flush()`.
- `[NEW] src/agent/event-schema.ts`: TypeScript schema validator.
- `[MODIFY] src/agent/types.ts`: Update `NDJSONEvent` union.
- `[NEW] src/__tests__/event-protocol.test.ts`: Cross-language event format test suite.

---

## 4. Detailed Task Breakdown

- [ ] **Task 11.1: Implement Event Emission Helper (`events.py`)**
  - Implement `emit_event(event_name: str, **kwargs)`.
  - Serializes to single-line JSON, writes to `sys.stdout`, and invokes `sys.stdout.flush()`.

- [ ] **Task 11.2: Implement TypeScript Parser (`event-schema.ts`)**
  - Implement `parseNDJSONLine(line: string): NDJSONEvent | null`.
  - Ignore empty lines and lines not containing valid JSON.

- [ ] **Task 11.3: Cross-Language Unit Tests (`event-protocol.test.ts`)**
  - Generate sample lines from Python, assert TypeScript parser reads them with correct types.

---

## 5. Technical Specifications & Concrete Code Signatures

```typescript
// src/agent/types.ts
export type NDJSONEvent =
  | { event: 'analysis_start'; analysisId: string; timestamp: string }
  | { event: 'evidence_collected'; count: number; ids: string[] }
  | { event: 'rule_matched'; ruleId: string; title: string }
  | { event: 'agent_start'; role: 'runtime' | 'config' | 'resource' | 'synthesizer'; message: string }
  | { event: 'agent_tool_call'; role: string; tool: string; args: Record<string, any> }
  | { event: 'agent_tool_result'; role: string; tool: string; durationMs: number }
  | { event: 'agent_progress'; role: string; message: string }
  | { event: 'agent_complete'; role: string; summary: string }
  | { event: 'agent_failed'; role: string; error: string }
  | { event: 'diagnosis_ready'; consensus: ConsensusDiagnosis }
  | { event: 'error'; message: string; fatal: boolean };
```

---

## 6. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_events.py`.
- [ ] Run `npm test -- src/__tests__/event-protocol.test.ts`.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 12 — Issue #283

## Overview
Overhaul the Node/Python subprocess bridge to support robust NDJSON streaming via `readline`, timeout watchdogs, and clean signal termination.

Part of **Milestone v4.0.0** — Phase 12 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(core): Phase 12 - Robust Node/Python Subprocess Bridge`
> **PR SCOPE**: Child process lifecycle and stream parsing.

---

## 1. Description of What Has to Be Done
Node.js needs a production-grade child process runner that executes the Python agent council, streams events in real-time, traps termination signals, and protects against hung processes.

Contributors must:
1. Refactor `src/agent/python-bridge.ts` using `node:child_process.spawn` with `python3 -u` (unbuffered mode).
2. Connect `readline.createInterface` to `proc.stdout` so events are parsed immediately per line without waiting for process exit.
3. Setup a watchdog timer (`timeoutMs`, default: 45s): if exceeded, send `SIGTERM`, wait 1.5s, then force `SIGKILL`.
4. Clean up the child process immediately if the user presses `Ctrl+C` (`process.on('SIGINT')`).
5. Capture `stderr` lines for diagnostic reporting if the Python runner exits with a non-zero code.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- Real-time event streaming: The moment Python emits an NDJSON event, the TypeScript callback `onEvent` is invoked in < 5ms.
- Clean process lifecycle: When the user presses `Ctrl+C` or when the timeout expires, zero zombie Python processes remain.
- Clear error surfacing: If Python crashes due to a missing dependency (e.g. `ModuleNotFoundError: No module named 'ollama'`), the error is captured from `stderr` and reported cleanly to the user.

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[MODIFY] src/agent/python-bridge.ts`: Overhaul runner with readline, watchdogs, and signal handling.
- `[NEW] src/__tests__/python-bridge-lifecycle.test.ts`: Process lifecycle and timeout test suite.

---

## 4. Detailed Task Breakdown

- [ ] **Task 12.1: Implement Streaming Readline in Bridge (`python-bridge.ts`)**
  - Spawn `python3 -u` with script path and JSON input argument.
  - Pipe `stdout` through `readline.createInterface({ input: proc.stdout })`.
  - Dispatch each parsed event to `options.onEvent(event)`.

- [ ] **Task 12.2: Implement Timeout Watchdog & Signal Trapping**
  - Set a timer for `options.timeoutMs || 45000`.
  - On expiry or SIGINT, invoke `proc.kill('SIGTERM')`.
  - If process has not exited after 1500ms, invoke `proc.kill('SIGKILL')`.

- [ ] **Task 12.3: Lifecycle Tests (`python-bridge-lifecycle.test.ts`)**
  - Test normal successful event stream.
  - Test timeout triggers process kill.
  - Test non-zero exit code captures stderr.

---

## 5. Technical Specifications & Concrete Code Signatures

```typescript
// src/agent/python-bridge.ts
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { NDJSONEvent, ConsensusDiagnosis } from './types';

export interface CouncilBridgeOptions {
  failureText: string;
  context: { namespace?: string; kind?: string; name?: string };
  model?: string;
  timeoutMs?: number;
  onEvent?: (event: NDJSONEvent) => void;
  onStderr?: (chunk: string) => void;
}

export async function runAgentCouncilProcess(options: CouncilBridgeOptions): Promise<ConsensusDiagnosis> {
  // Spawns python3 -u, attaches readline, enforces watchdog, resolves on diagnosis_ready
  ...
}
```

---

## 6. Verification & Acceptance Checklist
- [ ] Run `npm test -- src/__tests__/python-bridge-lifecycle.test.ts` — all tests pass.
- [ ] Verified zero orphan python processes on timeout or cancellation.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 13 — Issue #284

## Overview
Wire live NDJSON streaming events into the React Ink terminal dashboard (`AnalyzeDashboard.tsx`) with animated status loaders and active tool indicators.

Part of **Milestone v4.0.0** — Phase 13 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(ui): Phase 13 - Live Ink Multi-Agent Triaging Dashboard`
> **PR SCOPE**: React Ink live loader and consensus display.

---

## 1. Description of What Has to Be Done
The terminal UI must represent **actual backend state**, not simulated loaders. When `RuntimeLogAgent` begins, its spinner starts; when it calls `get_container_logs`, the active tool pane updates; when diagnosis completes, the final consensus view renders.

Contributors must:
1. Hook `onEvent` from `runAgentCouncilProcess` into React state in `src/ui/AnalyzeDashboard.tsx`.
2. Build an `AgentCard` component rendering agent icons (`🔍`, `⚙️`, `🛡️`, `🎯`), spinner, status, and active task message.
3. Build an `ActiveToolPanel` displaying the currently running tool and duration.
4. Render the final `ConsensusDiagnosis` with root cause, confidence badge, and best remediation fix.

---

## 2. Desired Outcome & Expected Behavior

### Expected Terminal UI
```text
┌─ KDM Multi-Agent SRE Investigation ──────────────────────────────────────┐
│                                                                          │
│  ✔ 🔍 Runtime Agent: Detected Exit Code 137 (OOMKilled)                   │
│  ⠋ ⚙️ Config Agent:  Checking pod memory limits and container spec...     │
│  ⏳ 🛡️ Resource Agent: Waiting for node capacity evaluation...            │
│  ⏳ 🎯 Lead SRE:      Waiting to synthesize findings...                   │
│                                                                          │
│  ⚡ Active Tool: [Config Agent] → get_deployment_spec(checkout-api)       │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[MODIFY] src/ui/AnalyzeDashboard.tsx`: State reducer and live event wiring.
- `[NEW] src/ui/components/AgentCard.tsx`: Individual agent card renderer.
- `[NEW] src/ui/components/ActiveToolPanel.tsx`: Active tool execution display.
- `[NEW] src/__tests__/analyze-dashboard-events.test.tsx`: Ink rendering tests.

---

## 4. Detailed Task Breakdown

- [ ] **Task 13.1: Implement AgentCard Component (`AgentCard.tsx`)**
  - Renders status icon: `⠋` spinner for working, `✔` green checkmark for completed, `✖` red cross for failed.
  - Displays agent role, name, and current task message.

- [ ] **Task 13.2: Implement ActiveToolPanel Component (`ActiveToolPanel.tsx`)**
  - Displays active agent and tool call arguments.

- [ ] **Task 13.3: Wire Live State in AnalyzeDashboard (`AnalyzeDashboard.tsx`)**
  - Manage state for `agents: Record<string, AgentState>` and `activeTool`.
  - Update state on `agent_start`, `agent_tool_call`, `agent_complete`.

- [ ] **Task 13.4: Ink Component Tests (`analyze-dashboard-events.test.tsx`)**
  - Assert that dispatching events updates terminal output without crash.

---

## 5. Verification & Acceptance Checklist
- [ ] Run `npm test -- src/__tests__/analyze-dashboard-events.test.tsx` — all tests pass.
- [ ] Visual verification of spinners and layout in terminal.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 14 — Issue #285

## Overview
Implement the structured Remediation Planner that converts verified consensus diagnoses into minimal, auditable remediation patches with rollback instructions.

Part of **Milestone v4.0.0** — Phase 14 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(remediation): Phase 14 - Structured Remediation Planner`
> **PR SCOPE**: Remediation plan generation and diff preview.

---

## 1. Description of What Has to Be Done
Diagnosis without remediation leaves the SRE with manual work. However, automated fixes must never execute arbitrary or opaque commands. The Remediation Planner takes the verified `ConsensusDiagnosis` and generates an actionable `RemediationPlan` consisting of discrete, ordered steps, manifest diffs, and exact rollback commands.

Contributors must:
1. Define `RemediationPlan` and `RemediationStep` data structures.
2. Implement planners for core failure types:
   - **OOMKilled**: Calculate conservative memory limit increase (e.g. 256Mi -> 512Mi) and generate `kubectl set resources` or manifest patch.
   - **CrashLoopBackOff**: Suggest configuration/env updates and restart commands.
   - **ImagePullBackOff**: Suggest image tag fix or secret creation command.
3. Generate exact rollback commands (e.g. `kubectl rollout undo deployment/...`).
4. Assign an auditable `risk_level` (`low`, `medium`, `high`) based on whether the action causes downtime or pod restarts.

---

## 2. Desired Outcome & Expected Behavior

### Expected Output
```python
plan = planner.create_plan(consensus, bundle)
# Returns:
RemediationPlan(
    plan_id="plan-oom-001",
    target_workload="checkout-api",
    summary="Bump memory limit to 512Mi to prevent OOMKill restarts.",
    risk_level="low",
    steps=[
        RemediationStep(
            order=1,
            title="Update container memory limit",
            command="kubectl set resources deployment checkout-api --limits=memory=512Mi -n production",
            diff_preview="- memory: 256Mi\n+ memory: 512Mi",
            is_destructive=False
        )
    ],
    rollback_command="kubectl rollout undo deployment/checkout-api -n production"
)
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] agents/remediation/__init__.py`: Package init.
- `[NEW] agents/remediation/types.py`: `RemediationPlan` and `RemediationStep`.
- `[NEW] agents/remediation/planner.py`: `RemediationPlanner`.
- `[NEW] agents/tests/test_remediation_planner.py`: Planner unit tests.

---

## 4. Detailed Task Breakdown

- [ ] **Task 14.1: Implement Remediation Models (`types.py`)**
  - Define `RemediationStep` with `order`, `title`, `command`, `diff_preview`, `is_destructive`.
  - Define `RemediationPlan` with `plan_id`, `target_workload`, `summary`, `risk_level`, `steps`, `rollback_command`.

- [ ] **Task 14.2: Implement RemediationPlanner (`planner.py`)**
  - Match root cause patterns to predefined remediation templates.
  - Compute safe parameter bumps (e.g. 2x memory limit).
  - Generate corresponding `kubectl` commands and rollback instructions.

- [ ] **Task 14.3: Write Unit Tests (`test_remediation_planner.py`)**
  - Test memory bump calculation logic.
  - Test rollback command generation.

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/remediation/types.py
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class RemediationStep:
    order: int
    title: str
    command: str
    diff_preview: Optional[str] = None
    is_destructive: bool = False

@dataclass
class RemediationPlan:
    plan_id: str
    target_workload: str
    summary: str
    risk_level: str
    steps: List[RemediationStep]
    rollback_command: Optional[str] = None
```

---

## 6. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_remediation_planner.py` — all tests pass.
- [ ] Safe rollback command generated for every plan.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 15 — Issue #286

## Overview
Implement the Remediation Policy Engine and interactive safety gate requiring explicit human confirmation before executing any cluster mutation.

Part of **Milestone v4.0.0** — Phase 15 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(security): Phase 15 - Remediation Policy Safety Gate & Interactive Confirmation`
> **PR SCOPE**: Security policy and interactive confirmation prompt.

---

## 1. Description of What Has to Be Done
**Architectural Rule:** *Diagnosis is automatic; mutation is deliberate and gated.*
Under NO circumstances may KDM execute a mutating cluster command without an explicit, interactive affirmative confirmation from the user. Furthermore, destructive commands must be permanently blocked by an immutable policy engine.

Contributors must:
1. Implement `PolicyEngine` with deterministic regex rules that block dangerous commands (`delete namespace`, `delete node`, `rm -rf`, `--force`, `--grace-period=0`).
2. Enforce a strict command whitelist: only approved prefixes (`kubectl set resources`, `kubectl scale`, `kubectl rollout restart`, `kubectl patch`) are allowed.
3. Implement an interactive terminal prompt in React Ink (`src/remediation/safety-prompt.ts`) showing the command, risk badge, and a `[y/N]` prompt.
4. The default keypress (Enter or `n`) MUST abort execution. Only an explicit `y` or `Y` keypress allows execution to proceed.

---

## 2. Desired Outcome & Expected Behavior

### Expected Terminal View
```text
┌─ Remediation Proposal ───────────────────────────────────────────────────┐
│ Action: Increase Container Memory Limit                                  │
│ Risk:   LOW · Safe rollback available                                    │
│ Command:                                                                 │
│   $ kubectl set resources deployment checkout-api --limits=memory=512Mi  │
│                                                                          │
│ Diff Preview:                                                            │
│   - limits.memory: 256Mi                                                 │
│   + limits.memory: 512Mi                                                 │
│                                                                          │
│ Apply this remediation to the cluster? [y/N]:                            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] agents/remediation/policy.py`: Command validation policy engine.
- `[NEW] src/remediation/safety-prompt.ts`: Ink confirmation prompt.
- `[NEW] agents/tests/test_policy.py`: Policy rejection test suite.
- `[NEW] src/__tests__/safety-prompt.test.ts`: UI prompt test suite.

---

## 4. Detailed Task Breakdown

- [ ] **Task 15.1: Implement PolicyEngine (`policy.py`)**
  - Implement regex blacklist: `delete\s+namespace`, `delete\s+node`, `rm\s+-rf`, `--force`.
  - Implement whitelist prefixes: `kubectl set resources`, `kubectl scale`, `kubectl rollout restart`, `kubectl patch`.
  - Method `evaluate(command: str) -> bool`: returns False if command matches any blacklisted pattern or lacks whitelisted prefix.

- [ ] **Task 15.2: Implement Interactive Safety Prompt (`safety-prompt.ts`)**
  - Render proposed command and diff preview.
  - Capture single keypress. Default Enter -> abort.

- [ ] **Task 15.3: Security Tests (`test_policy.py`)**
  - Test blocked commands: `kubectl delete namespace kube-system` -> Rejected.
  - Test blocked options: `kubectl delete pod api --force --grace-period=0` -> Rejected.
  - Test valid commands: `kubectl set resources deployment api --limits=memory=512Mi` -> Approved.

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/remediation/policy.py
import re

BLOCKED_PATTERNS = [
    r"delete\s+namespace",
    r"delete\s+node",
    r"rm\s+-rf",
    r"--force",
    r"--grace-period=0"
]

ALLOWED_COMMAND_PREFIXES = [
    "kubectl set resources",
    "kubectl scale",
    "kubectl rollout restart",
    "kubectl patch"
]

class PolicyEngine:
    def evaluate(self, command: str) -> bool:
        for pattern in BLOCKED_PATTERNS:
            if re.search(pattern, command, re.IGNORECASE):
                return False
        return any(command.strip().startswith(prefix) for prefix in ALLOWED_COMMAND_PREFIXES)
```

---

## 6. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_policy.py` — all tests pass.
- [ ] Destructive commands proven to be blocked.
- [ ] Interactive prompt defaults to abort.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 16 — Issue #287

## Overview
Build the auditable Remediation Tool Executor that executes user-approved remediation commands safely with stdout/stderr capture and rollback logging.

Part of **Milestone v4.0.0** — Phase 16 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(remediation): Phase 16 - Auditable Remediation Tool Executor with Rollback`
> **PR SCOPE**: Execution engine and audit log capture.

---

## 1. Description of What Has to Be Done
Once the user confirms remediation, the executor safely runs the command against the target cluster, streams output, captures execution metrics, and logs the action to an audit trail.

Contributors must:
1. Implement `executeRemediationCommand` in `src/remediation/executor.ts` using parameterized `execFile` (never raw unescaped shell strings).
2. Measure wall-clock execution duration.
3. Capture stdout, stderr, and exit codes.
4. If execution fails (exit code != 0), surface the exact error and display the rollback command immediately.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- The command executes securely.
- Terminal shows immediate execution feedback:
  ```text
  ⚡ Applying remediation...
     $ kubectl set resources deployment checkout-api --limits=memory=512Mi
  ✓ Command succeeded in 320ms: deployment.apps/checkout-api resource requirements updated
  ```
- If command fails:
  ```text
  ✖ Command failed (exit code 1): Error from server (NotFound): deployments.apps "checkout-api" not found
  ⚠️ Recommended Rollback: kubectl rollout undo deployment/checkout-api -n production
  ```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] src/remediation/executor.ts`: Parameterized command executor.
- `[NEW] src/__tests__/remediation-executor.test.ts`: Mocked execution test suite.

---

## 4. Detailed Task Breakdown

- [ ] **Task 16.1: Implement Command Executor (`executor.ts`)**
  - Split command string into executable and argument array to prevent shell injection.
  - Use `node:child_process.execFile` with a 30s timeout.
  - Return `ExecutionResult` with `success`, `exitCode`, `stdout`, `stderr`, `durationMs`.

- [ ] **Task 16.2: Write Execution Tests (`remediation-executor.test.ts`)**
  - Test successful command execution.
  - Test non-zero exit code error handling.
  - Test timeout enforcement.

---

## 5. Technical Specifications & Concrete Code Signatures

```typescript
// src/remediation/executor.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function executeRemediationCommand(commandStr: string): Promise<ExecutionResult> {
  const parts = commandStr.trim().split(/\s+/);
  const file = parts[0];
  const args = parts.slice(1);
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(file, args, { timeout: 30000 });
    return {
      success: true,
      exitCode: 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      durationMs: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      success: false,
      exitCode: error.code || 1,
      stdout: error.stdout?.trim() || '',
      stderr: error.stderr?.trim() || error.message,
      durationMs: Date.now() - startTime
    };
  }
}
```

---

## 6. Verification & Acceptance Checklist
- [ ] Run `npm test -- src/__tests__/remediation-executor.test.ts` — all tests pass.
- [ ] Parameterized execution verified.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 17 — Issue #288

## Overview
Implement the closed-loop verification engine that polls fresh cluster evidence post-fix to verify the workload reaches `Ready` state without regressions.

Part of **Milestone v4.0.0** — Phase 17 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(remediation): Phase 17 - Post-Fix Closed-Loop Verification Engine`
> **PR SCOPE**: Verification loop and regression detection.

---

## 1. Description of What Has to Be Done
A successful command exit code does NOT mean the workload is healed. If you bump memory limits but the pod immediately crashes on startup with an application panic, the remediation was ineffective. Closed-loop verification actively polls the cluster for 30–60 seconds to confirm the pod becomes `Ready` and restart counts remain stable.

Contributors must:
1. Implement `WorkloadVerifier` in Python (`agents/remediation/verifier.py`).
2. Collect fresh container status every 5 seconds up to a timeout (default: 45s).
3. Confirm:
   - Pod phase is `Running`.
   - `containerStatuses[].ready == True`.
   - `restartCount` has not incremented since remediation started.
4. Detect failure regressions: If container enters `CrashLoopBackOff` or `OOMKilled` again, immediately report verification failure and recommend rollback.

---

## 2. Desired Outcome & Expected Behavior

### Expected Terminal Output
```text
🔍 Verifying remediation outcome...
   [●●○○] Waiting for rollout and container readiness... (10s)
✓ Verification Passed:
   - Pod checkout-api-7d9f is 1/1 Ready
   - Zero restarts detected since patch
   - Memory usage: 180Mi / 512Mi (healthy)
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] agents/remediation/verifier.py`: `WorkloadVerifier` loop.
- `[NEW] agents/tests/test_verifier.py`: Verification test suite.

---

## 4. Detailed Task Breakdown

- [ ] **Task 17.1: Implement WorkloadVerifier (`verifier.py`)**
  - Implement polling loop with `asyncio.sleep(5)`.
  - Compare fresh pod status against baseline restart count.
  - Return `{"status": "verified" | "failed" | "timed_out", "message": "..."}`.

- [ ] **Task 17.2: Unit Tests (`test_verifier.py`)**
  - Test pod transitions to ready -> returns `verified`.
  - Test pod restarts again -> returns `failed` with regression details.
  - Test timeout condition -> returns `timed_out`.

---

## 5. Technical Specifications & Concrete Code Signatures

```python
# agents/remediation/verifier.py
import asyncio
from typing import Dict, Any

class WorkloadVerifier:
    def __init__(self, check_fn):
        self.check_fn = check_fn

    async def verify(self, initial_restart_count: int, timeout: int = 45) -> Dict[str, Any]:
        start = asyncio.get_event_loop().time()
        while asyncio.get_event_loop().time() - start < timeout:
            status = await self.check_fn()
            if status.get("ready") and status.get("restart_count", 0) <= initial_restart_count:
                return {"status": "verified", "message": "Workload is healthy and Ready."}
            if status.get("restart_count", 0) > initial_restart_count:
                return {"status": "failed", "message": "Container crashed again post-remediation."}
            await asyncio.sleep(5)
        return {"status": "timed_out", "message": "Workload did not reach Ready within timeout."}
```

---

## 6. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_verifier.py` — all tests pass.
- [ ] Regression detection tested.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 18 — Issue #289

## Overview
Implement graceful degradation and fallback mechanisms so that KDM remains useful and informative even when Ollama, Python, or individual agents fail.

Part of **Milestone v4.0.0** — Phase 18 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(core): Phase 18 - System Failure Handling, Graceful Degradation & Fallbacks`
> **PR SCOPE**: Resilience, fallback ladder, and crash prevention.

---

## 1. Description of What Has to Be Done
If a user runs `kdm analyze` but their local Ollama server is stopped, Python 3 is not installed, or their machine runs out of memory, KDM must NOT crash with an unhandled exception or stack trace. It must gracefully degrade down the fallback ladder.

Contributors must:
1. Implement the **Fallback Ladder** in `src/analysis/analysis.ts`:
   - Step 1: Multi-Agent Council (Python + Ollama).
   - Step 2 (Fallback if Python/Ollama down): Deterministic Rule Engine.
   - Step 3 (Fallback if rule engine inconclusive): Legacy AI Client (OpenAI/Claude cloud backends).
   - Step 4 (Fallback if zero AI available): Raw Kubernetes event and log summary.
2. Inform the user with an informational badge explaining why the fallback occurred.

---

## 2. Desired Outcome & Expected Behavior

### Expected Behavior on Ollama Outage
```text
$ kdm analyze deployment/checkout-api
ℹ Notice: Local Ollama service is unreachable (http://localhost:11434).
ℹ Running in Deterministic Rule Mode (zero LLM overhead)...

✔ Root Cause Identified: Container Out-Of-Memory (OOMKilled)
  - Exit code 137 detected in container 'checkout'
  - Memory limit 256Mi exceeded
  - Confidence: 100%
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[MODIFY] src/analysis/analysis.ts`: Integrate fallback ladder logic.
- `[NEW] src/__tests__/degraded-mode.test.ts`: Fault injection test suite.

---

## 4. Detailed Task Breakdown

- [ ] **Task 18.1: Implement Dependency Probes (`analysis.ts`)**
  - Check Python availability via `isPythonAgentAvailable()`.
  - Check Ollama HTTP availability with 1s ping timeout.

- [ ] **Task 18.2: Implement Degradation Ladder (`analysis.ts`)**
  - If Python/Ollama fails, run `RuleEngine` directly.
  - If rules find match with confidence >= 0.9, return result immediately.

- [ ] **Task 18.3: Fault Injection Tests (`degraded-mode.test.ts`)**
  - Simulate missing Python -> assert clean fallback to rules.
  - Simulate Ollama connection refused -> assert clean fallback.

---

## 5. Verification & Acceptance Checklist
- [ ] Run `npm test -- src/__tests__/degraded-mode.test.ts` — all tests pass.
- [ ] Zero unhandled rejections on dependency failure.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 19 — Issue #290

## Overview
Implement structured audit logging and incident export (`--export-audit=incident.json`) with automated secret redaction for post-mortem analysis.

Part of **Milestone v4.0.0** — Phase 19 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(observability): Phase 19 - System Observability, Secret Redaction & Audit Logging`
> **PR SCOPE**: Incident export and data sanitization.

---

## 1. Description of What Has to Be Done
Enterprise SRE teams require comprehensive session exports for post-mortems, compliance, and ticketing systems. Running `kdm analyze <workload> --export-audit=incident.json` must dump the complete analysis session: target workload, raw evidence collected, tool execution history with durations, specialist agent reports, and consensus diagnosis.

Contributors must:
1. Implement `exportIncidentAudit` in `src/utils/audit-exporter.ts`.
2. Ensure automated sanitization: Strip passwords, auth tokens, bearer headers, and private keys.
3. Write formatted JSON to the requested file path.

---

## 2. Desired Outcome & Expected Behavior

### Expected Output
A sanitized, human-readable JSON file containing the complete incident timeline:
```json
{
  "sessionId": "an-123",
  "cliVersion": "4.0.0",
  "target": { "kind": "Deployment", "name": "checkout-api", "namespace": "production" },
  "evidence": { ... },
  "toolCalls": [
    { "tool": "get_container_logs", "durationMs": 140, "status": "success" }
  ],
  "consensus": {
    "rootCause": "Container OOMKilled",
    "confidence": "high"
  }
}
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] src/utils/audit-exporter.ts`: Audit exporter and sanitizer.
- `[NEW] src/__tests__/audit-exporter.test.ts`: Sanitization and file export tests.

---

## 4. Detailed Task Breakdown

- [ ] **Task 19.1: Implement Audit Exporter (`audit-exporter.ts`)**
  - Bundle evidence items, tool calls, and consensus diagnosis.
  - Recursively scrub tokens matching `(?i)(password|secret|key|token|auth|bearer)`.
  - Write formatted JSON file to disk.

- [ ] **Task 19.2: Unit Tests (`audit-exporter.test.ts`)**
  - Test export with mock data.
  - Verify that sensitive keys are replaced with `[REDACTED]`.

---

## 5. Verification & Acceptance Checklist
- [ ] Run `npm test -- src/__tests__/audit-exporter.test.ts` — all tests pass.
- [ ] Sensitive tokens scrubbed.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 20 — Issue #291

## Overview
Build a comprehensive test suite with reproducible offline fixtures simulating 5 canonical real-world Kubernetes failure scenarios.

Part of **Milestone v4.0.0** — Phase 20 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `test(agents): Phase 20 - Comprehensive Multi-Agent Test Suite & E2E Fixtures`
> **PR SCOPE**: Real-world SRE outage fixtures and test runners.

---

## 1. Description of What Has to Be Done
Multi-agent systems cannot be reliably developed or tested if tests depend on live clusters or cloud AI APIs that change over time. Phase 20 creates an offline, reproducible benchmark suite containing 5 real-world Kubernetes incident fixtures.

Contributors must:
1. Create 5 fixture directories in `agents/tests/fixtures/`:
   - `oomkill`: Pod status with exit code 137, memory limit 256Mi, and last state OOMKilled.
   - `crashloop`: Pod status with restart count 10, application panic traceback in logs.
   - `missing_secret`: Pod status in `CreateContainerConfigError` due to missing Secret key.
   - `node_pressure`: Node condition `MemoryPressure=True` causing pod eviction.
   - `probe_failure`: Liveness probe failed 3 times causing container kill.
2. Implement an end-to-end evaluation runner `agents/tests/test_e2e_scenarios.py` that passes these bundles through `RuleEngine` and `AgentCouncil` (with mocked Ollama client).
3. Assert that the resulting `ConsensusDiagnosis` accurately identifies the root cause for all 5 scenarios.

---

## 2. Desired Outcome & Expected Behavior

### Expected Outcome
- Tests run completely offline in under 3 seconds in CI.
- All 5 canonical SRE scenarios produce expected root causes with high confidence.

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] agents/tests/fixtures/oomkill/bundle.json`
- `[NEW] agents/tests/fixtures/crashloop/bundle.json`
- `[NEW] agents/tests/fixtures/missing_secret/bundle.json`
- `[NEW] agents/tests/fixtures/node_pressure/bundle.json`
- `[NEW] agents/tests/fixtures/probe_failure/bundle.json`
- `[NEW] agents/tests/test_e2e_scenarios.py`: End-to-end scenario runner.

---

## 4. Detailed Task Breakdown

- [ ] **Task 20.1: Create 5 Canonical Fixture Bundles**
  - Populate realistic Kubernetes manifests, pod statuses, and events in each fixture folder.

- [ ] **Task 20.2: Implement Test Runner (`test_e2e_scenarios.py`)**
  - Iterate over fixtures, feed to rule engine and council, assert expected root cause.

---

## 5. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_e2e_scenarios.py` — all tests pass.
- [ ] 100% offline; zero cluster connection required.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 21 — Issue #292

## Overview
Optimize agent execution latency and memory footprint to ensure full multi-agent analysis completes in under 30 seconds on developer machines.

Part of **Milestone v4.0.0** — Phase 21 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `perf(agents): Phase 21 - Concurrency, Latency & Resource Tuning`
> **PR SCOPE**: Token budgeting, log clipping, and parameter tuning.

---

## 1. Description of What Has to Be Done
Running 4 local LLM prompts (Runtime, Config, Resource, Lead SRE) on an 8GB or 16GB developer laptop can easily exceed 60 seconds if prompts contain unneeded tokens. In Phase 21, contributors tune prompts, implement log clipping, and set optimal Ollama options.

Contributors must:
1. Implement log head/tail clipping in `agents/tools/kubernetes.py`: only send the first 20 and last 80 lines of logs, discarding the repetitive middle lines.
2. Minify specialist agent system prompts by 40% without losing diagnostic accuracy.
3. Configure Ollama options: set `num_ctx: 4096` to avoid default 8192 context buffer allocations in GPU VRAM.
4. Benchmark multi-agent execution with `llama3.1:8b` and verify analysis completes in < 30 seconds.

---

## 2. Desired Outcome & Expected Behavior

### Expected Performance
- Memory footprint during analysis: < 6GB RAM.
- End-to-end council execution duration: < 30 seconds.

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[MODIFY] agents/specialists/base.py`: Minify system prompts and configure `num_ctx`.
- `[MODIFY] agents/tools/kubernetes.py`: Implement head/tail log clipping.
- `[NEW] agents/tests/test_perf_budget.py`: Token budget and clipping tests.

---

## 4. Detailed Task Breakdown

- [ ] **Task 21.1: Implement Log Head/Tail Bounding**
  - If log lines > 100, keep first 20 lines, insert `... [X lines omitted] ...`, and keep last 80 lines.

- [ ] **Task 21.2: Optimize Ollama Chat Parameters**
  - Set `options={"num_ctx": 4096, "temperature": 0.1, "num_predict": 512}`.

- [ ] **Task 21.3: Verification Tests (`test_perf_budget.py`)**
  - Assert prompt token counts stay within budget.

---

## 5. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_perf_budget.py` — all tests pass.
- [ ] Multi-agent analysis completes in < 30s.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 22 — Issue #293

## Overview
Support dynamic, pluggable model configuration per specialist role via `config/agents.yaml` or CLI arguments (e.g. `llama3.1`, `qwen2.5-coder`, `mistral`).

Part of **Milestone v4.0.0** — Phase 22 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(agents): Phase 22 - Dynamic Multi-Model Strategy & Configuration`
> **PR SCOPE**: Per-role model resolution and YAML configuration.

---

## 1. Description of What Has to Be Done
Different LLMs excel at different tasks. For example, `qwen2.5-coder` excels at manifest syntax and diff generation, while `llama3.1` or `mistral` excel at general SRE incident correlation. Users must be able to assign different models to different agent roles.

Contributors must:
1. Create `config/agents.yaml` supporting model mapping per role.
2. In `agents/council.py`, implement `resolve_model(role, config, cli_override)` to dynamically determine which model to instantiate for each agent.
3. Support global CLI override: `kdm analyze --model=qwen2.5-coder` overrides all roles simultaneously.

---

## 2. Desired Outcome & Expected Behavior

### Expected Configuration (`config/agents.yaml`)
```yaml
models:
  default: "llama3.1"
  runtime: "llama3.1"
  config: "qwen2.5-coder"
  resource: "llama3.1"
  synthesizer: "llama3.1"
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] config/agents.yaml`: Default configuration file.
- `[MODIFY] agents/council.py`: Dynamic model resolution per role.
- `[NEW] agents/tests/test_model_config.py`: Model resolution test suite.

---

## 4. Detailed Task Breakdown

- [ ] **Task 22.1: Implement Model Resolver (`council.py`)**
  - Read `config/agents.yaml` if present.
  - Priority order: CLI `--model` > `agents.yaml` role mapping > `agents.yaml` default > fallback `"llama3.1"`.

- [ ] **Task 22.2: Unit Tests (`test_model_config.py`)**
  - Test role resolution with custom YAML.
  - Test CLI flag override takes precedence.

---

## 5. Verification & Acceptance Checklist
- [ ] Run `python3 -m unittest agents/tests/test_model_config.py` — all tests pass.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 23 — Issue #294

## Overview
Add feature flag scaffolding (`--multi-agent` / `kdm config set multi_agent true`) to enable safe, opt-in testing before full rollout.

Part of **Milestone v4.0.0** — Phase 23 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(cli): Phase 23 - Feature Flags, Rollout Modes & Legacy Fallback`
> **PR SCOPE**: CLI argument parsing and config storage.

---

## 1. Description of What Has to Be Done
Before enabling the multi-agent council by default, we must allow users and contributors to opt-in via a CLI flag or configuration key.

Contributors must:
1. Add `--multi-agent` boolean flag to `src/commands/analyze.ts`.
2. Add `multi_agent: boolean` option to the KDM configuration store (`src/config/config.ts`).
3. If `--multi-agent` is true (or config `multi_agent == true`), execute `runAgentCouncilProcess`. Otherwise, route to the frozen legacy pipeline.
4. Add deprecation notice advising users that legacy single-prompt mode will be deprecated in v4.1.0.

---

## 2. Desired Outcome & Expected Behavior

### Expected Behavior
```bash
# Default (Legacy)
$ kdm analyze deployment/api
# Executes frozen single-agent analysis

# Opt-in Multi-Agent
$ kdm analyze deployment/api --multi-agent
# Launches Python Multi-Agent Council with Live Ink UI
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[MODIFY] src/commands/analyze.ts`: Add `--multi-agent` flag.
- `[MODIFY] src/config/config.ts`: Add `multi_agent` schema setting.
- `[MODIFY] src/analysis/analysis.ts`: Route execution based on flag.
- `[NEW] src/__tests__/cli-flags.test.ts`: Flag routing tests.

---

## 4. Detailed Task Breakdown

- [ ] **Task 23.1: Register CLI Flag (`analyze.ts`)**
  - `.option('--multi-agent', 'Enable experimental multi-agent SRE council')`.

- [ ] **Task 23.2: Update Config Store (`config.ts`)**
  - Allow `kdm config set multi_agent true`.

- [ ] **Task 23.3: Write Routing Tests (`cli-flags.test.ts`)**
  - Assert flag routes to multi-agent bridge.
  - Assert absence of flag routes to legacy pipeline.

---

## 5. Verification & Acceptance Checklist
- [ ] Run `npm test -- src/__tests__/cli-flags.test.ts` — all tests pass.
- [ ] PR targets branch `v4.0.0`.

---


# Phase 24 — Issue #295

## Overview
Perform final end-to-end integration and smoke testing across all components: evidence collection -> deterministic rules -> agent council -> validation -> Ink TUI -> safety prompt -> post-fix verification.

Part of **Milestone v4.0.0** — Phase 24 of the Multi-Agent SRE Architecture.

---

### ⚠️ IMPORTANT CONTRIBUTOR & PR INSTRUCTIONS
> **TARGET BRANCH**: All Pull Requests implementing this phase **MUST target branch `v4.0.0`** (DO NOT target `main`).
> **PR TITLE**: `feat(release): Phase 24 - Final System Architecture Integration & E2E Validation`
> **PR SCOPE**: Milestone release integration and validation.

---

## 1. Description of What Has to Be Done
This is the milestone-closing phase that validates the entire multi-agent architecture functioning as an integrated whole.

Contributors must:
1. Verify the complete lifecycle flow:
   ```text
   CLI Command -> Evidence Collector -> Rule Engine (if match -> instant diagnosis)
   -> Specialist Council (Runtime, Config, Resource in parallel)
   -> Lead SRE Hypotheses -> Cross-Agent Validator -> Consensus Diagnosis
   -> Live Ink Dashboard -> Remediation Plan -> Safety Gate [y/N]
   -> Executor -> Post-Fix Verification -> Final Result
   ```
2. Write comprehensive end-to-end smoke tests in `src/__tests__/e2e-system.test.ts`.
3. Update `README.md` and user documentation with architecture diagrams, CLI flags, and video/terminal previews.

---

## 2. Desired Outcome & Expected Behavior

### Expected Product Flow
```text
$ kdm analyze deployment/checkout-api --multi-agent

1. COLLECT
   ✓ Kubernetes evidence collected (14 items)

2. INVESTIGATE
   ✓ Runtime Agent (detected exit code 137)
   ✓ Config Agent (checked limits and probes)
   ✓ Resource Agent (checked node memory pressure)

3. CORRELATE & VALIDATE
   ✓ Lead Investigator formulated root-cause hypothesis
   ✓ Validator confirmed: no contradictions

4. DIAGNOSIS
   Root Cause: Container exceeded 256Mi memory limit under peak load
   Confidence: HIGH · 96%

5. REMEDIATION
   Action: Increase memory limit (256Mi → 512Mi)
   Command: kubectl set resources deployment checkout-api --limits=memory=512Mi
   Apply? [y/N]: y

6. VERIFY
   ✓ Deployment rolled out
   ✓ Pod Ready: 1/1
   ✓ No new restarts detected

Remediation successful.
```

---

## 3. The Implementation Plan & Architectural Blueprint

### Files to Create and Modify
- `[NEW] src/__tests__/e2e-system.test.ts`: End-to-end integration test suite.
- `[MODIFY] README.md`: Update documentation and architecture diagram.

---

## 4. Detailed Task Breakdown

- [ ] **Task 24.1: Implement End-to-End Test (`e2e-system.test.ts`)**
  - Run the entire Node + Python pipeline against mock cluster responses.
  - Verify event emissions, diagnosis synthesis, and remediation confirmation.

- [ ] **Task 24.2: Update Documentation (`README.md`)**
  - Document `--multi-agent` flag.
  - Add multi-agent architecture diagram.

---

## 5. Verification & Acceptance Checklist
- [ ] Run `npm test` — all 33+ test files pass.
- [ ] Run `python3 -m unittest discover agents/` — all agent tests pass.
- [ ] Run `npm run build` — compiles cleanly.
- [ ] PR targets branch `v4.0.0`.

---


# UI Track — Contributor PR Specifications

For frontend engineers focusing on React, Ink, and terminal interfaces, the following sub-phases provide actionable, isolated tasks:

## UI Phase 1: Unidirectional Event-to-State Architecture
- **Title**: `[UI Phase 1] Build Immutable Analysis State Model and Dispatcher`
- **Files**: `[NEW] src/ui/state/analysis-types.ts`, `src/ui/state/analysis-store.ts`
- **Scope**: Define `AnalysisState` containing phase (`collecting`, `investigating`, `synthesizing`, `diagnosed`), agent dictionary, tool execution history, and errors. Ensure all state updates are event-driven.

## UI Phase 2: State Reducer & Event Normalization
- **Title**: `[UI Phase 2] Implement Deterministic Event Reducer`
- **Files**: `[NEW] src/ui/state/analysis-reducer.ts`, `src/__tests__/analysis-reducer.test.ts`
- **Scope**: Pure reducer function `(state, event) => newState`. Must be 100% testable without rendering Ink components.

## UI Phase 3: Multi-Agent Council Live Dashboard Component
- **Title**: `[UI Phase 3] Implement AgentCouncil and AgentCard Ink Components`
- **Files**: `[NEW] src/ui/components/AgentCouncil.tsx`, `src/ui/components/AgentCard.tsx`
- **Scope**: Animated spinners for working agents, green checkmarks for completed agents, red cross for failed agents. Render current active task message.

## UI Phase 4: Deep-Dive Panels (Tools, Evidence, Hypotheses)
- **Title**: `[UI Phase 4] Build Collapsible Tool Activity and Evidence Panels`
- **Files**: `[NEW] src/ui/components/ToolActivity.tsx`, `src/ui/components/EvidencePanel.tsx`
- **Scope**: Shows real-time stream of tool calls (`get_container_logs`, `get_pod_events`) with millisecond execution durations.

## UI Phase 5: Interactive Remediation & Verification TUI
- **Title**: `[UI Phase 5] Build Remediation Review and Confirmation Screen`
- **Files**: `[NEW] src/ui/components/RemediationPanel.tsx`, `src/ui/components/VerificationPanel.tsx`
- **Scope**: Displays proposed CLI command with syntax highlighting, risk badge (`LOW` in green, `HIGH` in red), and interactive `[y/N]` prompt.

## UI Phase 6: Terminal Robustness & Keybindings
- **Title**: `[UI Phase 6] Centralized Keyboard Navigation and Terminal Resize Handling`
- **Files**: `[NEW] src/ui/hooks/useKeyboard.ts`, `src/ui/theme/layout.ts`
- **Scope**: Support `[q]` (cancel), `[e]` (toggle evidence view), `[d]` (toggle details), `[f]` (jump to fix). Handle terminal column widths down to 80 cols gracefully.

## UI Phase 7: Ink UI Component & Snapshot Test Suite
- **Title**: `[UI Phase 7] Component Testing with ink-testing-library`
- **Files**: `[NEW] src/__tests__/ui-components.test.tsx`
- **Scope**: Snapshot tests verifying terminal output for each phase of analysis.

## UI Phase 8: Non-Interactive Fallback & CI Mode
- **Title**: `[UI Phase 8] Support Plain Text & JSON Output for CI/CD Pipelines`
- **Files**: `[MODIFY] src/ui/AnalyzeDashboard.tsx`
- **Scope**: Detect `process.stdout.isTTY == false` or `--json` flag and output clean, machine-readable JSON without ANSI escape sequences.

---

# Production Milestones & Contributor Roadmap

| Milestone | Included Phases | User-Facing Capability |
| :--- | :--- | :--- |
| **Milestone 1 (MVP)** | Phase 0 to 6, 10 to 13, 18, 23, UI 1–3 | Parallel read-only agent council with live Ink dashboard and deterministic rules. Zero cluster mutation. |
| **Milestone 2 (SRE Council)** | Phase 7 to 9, 20, UI 4, UI 6 | Multi-turn progressive tool calling, competing hypothesis generation, and adversarial cross-validation. |
| **Milestone 3 (V1 Self-Healing)**| Phase 14 to 17, UI 5 | Gated remediation with safety policy, interactive `[y/N]` confirmation, and active post-fix verification. |
| **Milestone 4 (Production Polish)**| Phase 19, 21, 22, 24, UI 7–8 | Telemetry export, model customization, CI non-interactive mode, sub-30s latency. |

---

# Verification & Pre-PR Checklist

Before opening your Pull Request, run the following verification commands:

```bash
# 1. Ensure all TypeScript builds cleanly
npm run build

# 2. Run all TypeScript unit and integration tests
npm test

# 3. Run all Python agent unit tests
python3 -m unittest discover agents/

# 4. Check for code formatting and lint
npm run lint 2>/dev/null || true
```
