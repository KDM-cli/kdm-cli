# KDM CLI Command Reference

This document provides a comprehensive command reference for the KDM (Kubernetes Docker Monitor) CLI, detailing every command group, subcommand, option flag, and usage example.

---

## 📌 Global Options

These options apply when invoking the main `kdm` executable:

| Flag | Description |
|------|-------------|
| `-v, --version` | Output the current version of KDM CLI |
| `-h, --help` | Display general help and command listings |

---

## 1. `kdm show`
Retrieve and display workload resources or cluster metadata in clean, formatted tables.

### Subcommands:
- **`kdm show runners`**
  Displays a combined table of all active Kubernetes pods and Docker containers.
- **`kdm show pods`**
  Displays only Kubernetes pods.
- **`kdm show containers`**
  Displays only Docker containers.
- **`kdm show nodes`**
  Displays details of Kubernetes cluster nodes.
- **`kdm show minikube`**
  Checks and prints local Minikube profile and connection status.

### Examples:
```bash
kdm show runners
kdm show pods
kdm show minikube
```

---

## 2. `kdm health`
Checks the health of workloads and outputs color-coded logs and details.

### Options:
- `-w, --watch`: Run in watch mode to continuously refresh the terminal output.
- `-i, --interval <seconds>`: Refresh interval in seconds (default: `5`).

### Subcommands:
- **`kdm health all`**
  Unified health check of both containers and pods.
- **`kdm health pods`**
  Health checks for pods only.
- **`kdm health containers`**
  Health checks for Docker containers only.

### Examples:
```bash
kdm health all
kdm health pods -w           # Continuous watch mode (5s refresh)
kdm health containers -w -i 2 # Continuous watch mode (2s refresh)
```

---

## 3. `kdm watch`
Launches the interactive real-time terminal user interface (TUI) dashboard. Refreshes status and metrics automatically (Ctrl+C to exit).

### Example:
```bash
kdm watch
```

---

## 4. `kdm logs <name>`
Retrieves logs from a workload. KDM attempts a Docker container prefix match first, falling back to Kubernetes pods if no matching container is found.

### Parameters:
- `<name>`: The container name/ID prefix or the Kubernetes pod name.

### Example:
```bash
kdm logs auth-api
```

---

## 5. `kdm analyze`
Scans Kubernetes resources for configuration errors and operational problems. Supports AI-powered troubleshooting explanations.

### Options:
- `-n, --namespace <namespace>`: Limit check to a specific Kubernetes namespace.
- `-L, --selector <selector>`: Limit check to resources matching a label selector.
- `-f, --filter <filter>`: Run a specific analyzer only (e.g. `Pod`, `Ingress`, `Deployment`). Can be specified multiple times.
- `-o, --output <format>`: Output format choice: `text` (default) or `json`.
- `-m, --max-concurrency <num>`: Max concurrency count for analyzers (default: `10`).
- `-s, --with-stat`: Print execution diagnostics statistics.
- `--with-doc`: Retrieve Kubernetes documentation lookups for detected problems.
- `-e, --explain`: Request AI-powered diagnosis explanations.
- `-b, --backend <backend>`: Force a specific AI backend provider to query.
- `-l, --language <lang>`: Request AI response in a target language (default: `english`).
- `-a, --anonymize`: Mask resource names and identifiers in prompt payload to protect privacy.
- `-c, --no-cache`: Skip looking up or saving to the local AI cache.
- `--kubeconfig <path>`: Specify an alternative kubeconfig file path.
- `--kubecontext <context>`: Specify target Kubernetes context.

### Examples:
```bash
kdm analyze
kdm analyze -n default --explain
kdm analyze --explain --backend ollama --language spanish
kdm analyze -o json --anonymize
```

---

## 6. `kdm auth`
Manage credentials, models, and endpoints for AI backend providers. KDM supports **10+** AI providers (OpenAI, Anthropic, Gemini, Vertex AI, WatsonX, OCI GenAI, Cohere, Bedrock, Groq, HuggingFace, etc.).

### Subcommands:

- **`kdm auth add`**
  Register credentials for a provider.
  - Options:
    - `-b, --backend <backend>`: Target backend name (e.g. `openai`, `ollama`, `anthropic`, `google-gemini`, `google-vertex`, etc.).
    - `-m, --model <model>`: Target model name (e.g. `gpt-4o`, `claude-3-5-sonnet-latest`).
    - `-p, --password <password>`: API Key or password credential.
    - `-u, --baseurl <baseurl>`: Custom API base URL.
    - `-t, --temperature <value>`: Model generation temperature.
    - `--topp <value>`: Top-P sampling threshold.
    - `--topk <value>`: Top-K sampling threshold.
    - `--maxtokens <value>`: Max tokens limit.
    - `--custom-header <Header=Value>`: Add custom HTTP request header. Can be specified multiple times.

- **`kdm auth list`**
  Lists all configured providers and their parameters (API keys are safely masked).

- **`kdm auth default <backend>`**
  Sets the active default AI provider.

- **`kdm auth remove <backend>`**
  Removes configured settings for a provider.

- **`kdm auth update <backend>`**
  Updates settings on an already registered provider (supports the same options as `add`).

### Examples:
```bash
kdm auth add -b openai -m gpt-4o -p sk-...
kdm auth add -b ollama -m llama3.1
kdm auth default ollama
kdm auth update ollama -t 0.2
kdm auth list
```

---

## 7. `kdm cache`
Manage locally cached AI explanations to save tokens and avoid duplicate network requests.

### Subcommands:
- **`kdm cache list`**
  Lists all cached explanation keys.
- **`kdm cache get <key>`**
  Retrieves and prints cached markdown explanation for a key.
- **`kdm cache remove <key>`**
  Deletes a specific cache entry.
- **`kdm cache purge`**
  Deletes all locally cached explanations.

### Examples:
```bash
kdm cache list
kdm cache purge
```

---

## 8. `kdm filters`
Configure default active analyzers to filter what `kdm analyze` checks.

### Subcommands:
- **`kdm filters list`**
  Lists all active default analyzers and available inactive ones.
- **`kdm filters add <name>`**
  Adds an analyzer (e.g. `Ingress`, `CronJob`) to default active check list.
- **`kdm filters remove <name>`**
  Removes an analyzer from the active list.

### Examples:
```bash
kdm filters list
kdm filters add Ingress
```

---

## 9. `kdm custom-analyzer`
Register custom shell commands or HTTP webhooks to analyze arbitrary custom resources (CRDs).

### Subcommands:

- **`kdm custom-analyzer add <name>`**
  Register a new analyzer. Requires either `--command` or `--url`.
  - Options:
    - `--command <cmd>`: External CLI command to execute.
    - `--url <url>`: HTTP endpoint URL to call.

- **`kdm custom-analyzer list`**
  Lists all registered custom analyzers.

- **`kdm custom-analyzer remove <name>`**
  Deletes a registered custom analyzer.

### Examples:
```bash
kdm custom-analyzer add keda --command "kubectl get scaledobjects -A -o json"
kdm custom-analyzer list
kdm custom-analyzer remove keda
```

---

## 10. `kdm serve`
Starts the KDM server daemon in either REST API mode or JSON-RPC Model Context Protocol (MCP) mode.

### Options:
- `-p, --port <port>`: HTTP server port (default: `8080`).
- `--metrics-port <port>`: Metrics server port.
- `-b, --backend <backend>`: Default active AI backend provider.
- `-f, --filter <filter>`: Default analyzer filter limit.
- `--http`: Force HTTP mode (default).
- `--mcp`: Start in MCP mode (JSON-RPC stdio).

### Examples:
```bash
kdm serve --port 8080 # Starts HTTP REST API on http://localhost:8080
kdm serve --mcp       # Starts JSON-RPC MCP server over stdio
```

---

## 11. `kdm config`
Interactively set up alerting notifications or directly update config properties.

### Subcommands:
- **`kdm config setup`**
  Launches interactive CLI wizard to configure alerting notifications (Discord Webhook, Email SMTP settings).
- **`kdm config list`**
  Lists all general configurations.
- **`kdm config set <key> <value>`**
  Manually sets a config parameter.
- **`kdm config clear`**
  Resets all configurations to default.

### Examples:
```bash
kdm config setup
kdm config set alert_cooldown 600
kdm config list
```
