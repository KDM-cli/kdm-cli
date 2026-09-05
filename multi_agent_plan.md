# Multi-Agent Collaborative Analysis with Python & Ollama Python SDK for `kdm analyze`

Build a **Multi-Agent Collaborative Analysis System** using **Python** and the official **[Ollama Python SDK](https://github.com/ollama/ollama-python)** (`ollama`) to diagnose Kubernetes and Docker workload failures during `kdm analyze`. The Python agent engine streams real-time status events over an NDJSON IPC bridge to KDM CLI's Ink dashboard, which displays live per-agent loaders (`X agent is working`, `finding best solution`) and presents the final consensus remediation plan.

---

## 1. Architecture Overview (Python + Ollama SDK + Ink Bridge)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ KDM CLI (Node.js & Ink TUI)                                                 │
│                                                                             │
│  AnalyzeDashboard.tsx                                                       │
│    ├─ Live Multi-Agent Loader:                                              │
│    │    ⠋ [Runtime Agent is working] Analyzing container logs & signals...  │
│    │    ⠋ [Config Agent is working] Checking ConfigMaps & probe timeouts... │
│    │    ⠋ [Resource Agent is working] Evaluating node pressure & OOM...    │
│    │    ⠋ [Lead Synthesizer is finding best solution] Correlating reports...│
│    └─ Final Consensus Diagnosis & Suggested Fix [f]                         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            JSON Input (Workload Data) │ Stdin / CLI Args
            NDJSON Stream (Events)     │ Stdout (Line-by-Line)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Python Multi-Agent Engine (`agents/`)                                       │
│                                                                             │
│  council.py (Orchestrator)                                                  │
│    ├─ RuntimeLogAgent (specialists.py) ──► ollama.Client.chat(...)          │
│    ├─ ConfigAgent     (specialists.py) ──► ollama.Client.chat(...)          │
│    ├─ ResourceAgent   (specialists.py) ──► ollama.Client.chat(...)          │
│    └─ SynthesizerAgent(specialists.py) ──► ollama.Client.chat(...)          │
│                                                                             │
│  Ollama Local Server (http://localhost:11434)                              │
│    └─ Models: llama3.1, qwen2.5-coder, deepseek-r1, mistral                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The Python Specialist Agents (`agents/specialists.py`)

Using the official `ollama` Python library (`import ollama`):

```python
import ollama

client = ollama.Client(host=base_url)
```

| Agent | Focus Area | What It Checks |
| :--- | :--- | :--- |
| **🔍 Runtime & Log Agent** | Process & Container Lifecycle | Exit codes (`137` OOMKill, `1` Crash, `126` Permission, `143` SIGTERM), panic traces, stderr outputs. |
| **⚙️ Config & Dependency Agent** | Declarative Configuration | Missing ConfigMaps/Secrets, unresolvable DNS names, invalid env vars, and probe threshold timeouts. |
| **🛡️ Cluster & Resource Agent** | Node & Capacity Constraints | Node memory/disk pressure, QoS classes (`Burstable` vs `Guaranteed`), OOMKilled cgroups, CPU throttling. |
| **🎯 Lead SRE Synthesizer** | Consensus & Remediation | Cross-examines specialist findings, discards misleading symptoms, identifies true root cause, and ranks the optimal fix. |

---

## 3. Live Agent Loader UX in `AnalyzeDashboard.tsx`

While the Python agents run, `council.py` streams progress events line-by-line in NDJSON format:

```json
{"event": "start", "agent": "Runtime Agent", "message": "Runtime Agent is working: Analyzing container logs & exit codes..."}
{"event": "progress", "agent": "Config Agent", "message": "Config Agent is working: Checking ConfigMaps, Secrets & probe thresholds..."}
{"event": "progress", "agent": "Resource Agent", "message": "Resource Agent is working: Evaluating node pressure & memory limits..."}
{"event": "progress", "agent": "Lead Synthesizer", "message": "Lead Synthesizer is finding best solution..."}
{"event": "complete", "consensus": {"rootCause": "...", "confidence": "high", "bestSolution": {...}, "findings": [...]}}
```

The right-hand pane in `AnalyzeDashboard.tsx` renders an animated loader reflecting each agent's active step:

```text
┌─ Multi-Agent Triaging (Python + Ollama) ─────────────────────────────────┐
│                                                                          │
│  ✔ 🔍 Runtime Agent: Finished inspecting container logs & exit code 137  │
│  ⠋ ⚙️ Config Agent: Checking ConfigMaps, Secrets & probe thresholds...    │
│  ⏳ 🛡️ Resource Agent: Waiting to evaluate node memory limits...         │
│  ⏳ 🎯 Lead Synthesizer: Waiting to correlate evidence...                │
│                                                                          │
│  ⚡ Active: [Config Agent is working] Finding configuration mismatches... │
└──────────────────────────────────────────────────────────────────────────┘
```

When the specialist agents finish, the Synthesizer activates:

```text
┌─ Multi-Agent Triaging (Python + Ollama) ─────────────────────────────────┐
│                                                                          │
│  ✔ 🔍 Runtime Agent: Completed                                           │
│  ✔ ⚙️ Config Agent:  Completed                                           │
│  ✔ 🛡️ Resource Agent: Completed                                          │
│  ⠋ 🎯 Lead Synthesizer: Reconciling evidence & finding best solution... │
│                                                                          │
│  ⚡ Active: [Lead Synthesizer is finding best solution]                  │
└──────────────────────────────────────────────────────────────────────────┘
```

Once the Python process emits the `complete` event, the dashboard displays:
- **Consensus Root Cause** with confidence level.
- **Ranked Best Remediation Solution** with step-by-step instructions.
- **One-Click Fix Execution**: Pressing **`[f]`** prompts the user (`⚠️ Confirm Remediation [y/N]`) before applying any changes.

---

## 4. Implementation Structure

1. **`agents/requirements.txt`**:
   - `ollama>=0.4.0`
2. **`agents/specialists.py`**:
   - Agent implementations querying `ollama.Client.chat(...)`.
3. **`agents/council.py`**:
   - Orchestration script emitting NDJSON events to stdout.
4. **`src/agent/python-bridge.ts`**:
   - Child process runner in Node.js reading NDJSON lines and triggering `onAgentProgress`.
5. **`src/ui/AnalyzeDashboard.tsx`**:
   - Animated per-agent loader with dynamic message display and consensus rendering.
6. **`src/analysis/analysis.ts`**:
   - Delegation to `runPythonAgentCouncil` when `backend === 'ollama'`, with fallback to direct completion if Python is not installed.

---

## 5. Verification Plan

1. **Python Unit Tests** (`agents/test_council.py`):
   - Mock `ollama.Client` to verify agent calls and NDJSON stream output.
2. **TypeScript Bridge Tests** (`src/__tests__/python-bridge.test.ts`):
   - Test child process execution, NDJSON parsing, and callback emission.
3. **Dashboard Tests** (`src/__tests__/analyze-dashboard.test.tsx`):
   - Test live loader rendering (`X agent is working`, `finding best solution`) and consensus resolution.
4. **Full Suite**:
   - `npm test` across all test files.
