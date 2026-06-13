<div align="center">
<pre>
██╗  ██╗██████╗ ███╗   ███╗
██║ ██╔╝██╔══██╗████╗ ████║
█████╔╝ ██║  ██║██╔████╔██║
██╔═██╗ ██║  ██║██║╚██╔╝██║
██║  ██╗██████╔╝██║ ╚═╝ ██║
╚═╝  ╚═╝╚═════╝ ╚═╝     ╚═╝
</pre>
</div>

<div align="center">

# KDM — Kubernetes + Docker Monitoring CLI

**Monitor Docker containers and Kubernetes pods from a single terminal interface.**

[![npm version](https://img.shields.io/npm/v/kdm-cli?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/kdm-cli)
[![npm downloads](https://img.shields.io/npm/dm/kdm-cli?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/kdm-cli)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![All Contributors](https://img.shields.io/github/all-contributors/KDM-cli/kdm-cli?color=ee8449&style=flat-square)](#contributors)
[![GitHub stars](https://img.shields.io/github/stars/KDM-cli/kdm-cli?style=flat-square&logo=github)](https://github.com/KDM-cli/kdm-cli)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](CONTRIBUTING.md)

</div>

---

## Overview

KDM (Kubernetes Docker Monitor) is a lightweight CLI tool that automatically detects and monitors running Docker containers and Kubernetes pods. It provides real-time health status, live dashboards, log fetching, and alert notifications — all from your terminal.

Unlike tools that focus on a single runtime ([k9s] for Kubernetes or [lazydocker] for Docker), KDM gives you a **unified view** of both worlds.

[k9s]: https://k9scli.io/
[lazydocker]: https://github.com/jesseduffield/lazydocker

---

## Features

| Feature | Description |
|---------|-------------|
| **Auto-Detection** | Automatically discovers Docker containers and Kubernetes pods in your environment |
| **Unified Runner View** | Combined table of Docker and Kubernetes workloads in a single command |
| **Health Monitoring** | Color-coded health status with watch mode for continuous polling |
| **Live Dashboard** | Real-time Ink-based TUI that refreshes every 3 seconds |
| **Log Fetching** | Retrieve logs from containers or pods with automatic Docker-to-Kubernetes fallback |
| **Alert Notifications** | Send alerts via Discord webhook or email SMTP on failures |
| **Minikube Support** | Check Minikube profile status and connectivity |
| **AI Diagnostics** | Scan cluster workload configuration errors (`kdm analyze`) with AI explanations (`--explain`) |
| **AI Providers** | Multi-backend credentials (`kdm auth`) supporting OpenAI, Anthropic, Gemini, WatsonX, Ollama, etc. |
| **Local Cache** | Cache system (`kdm cache`) to save AI explanation API tokens and reduce network latency |
| **Dynamic Filters** | Customize default active analyzers list (`kdm filters`) |
| **Custom Analyzers** | Run scripts or webhooks (`kdm custom-analyzer`) to analyze CustomResourceDefinitions (e.g. KEDA, Kyverno) |
| **MCP & HTTP Server** | Run KDM as a REST API or Model Context Protocol (MCP) server (`kdm serve`) for agent integrations |

---

## Installation

<div align="center">

### Global Install

```bash
npm install -g kdm-cli
```

### Run Directly

```bash
npx kdm-cli
```

</div>

**Requirements:**

- [Node.js](https://nodejs.org) >= 18
- Docker daemon (for container features)
- Kubernetes cluster or [Minikube](https://minikube.sigs.k8s.io) (for pod features)

---

## Quick Start

Once installed, run KDM with no arguments to display the welcome banner, connection status, and available commands:

```bash
kdm
```

You should see output similar to:

```
Docker:      ✔ CONNECTED  (3 running)
Kubernetes:  ✔ CONNECTED  (5 running)
Minikube:    ✔ RUNNING
```

---

## Usage

### Show Workloads

Display running containers, pods, or both in a formatted table.

```bash
kdm show runners       # Combined view: pods + containers
kdm show pods          # Kubernetes pods only
kdm show containers    # Docker containers only
kdm show minikube      # Minikube profile status
```

### Health Status

Check and monitor the health of your workloads with color-coded output.

```bash
kdm health all          # Both pods and containers
kdm health pods         # Pods only
kdm health containers   # Containers only
kdm health all -w       # Watch mode: auto-refresh every 5 seconds
kdm health pods -w -i 2  # Watch mode: refresh every 2 seconds
```

### Live Dashboard

Monitor all workloads in real time with an interactive terminal dashboard.

```bash
kdm watch               # Opens Ink-based live dashboard (Ctrl+C to exit)
```

### Log Fetching

Retrieve the last 100 lines of logs from a container or pod. Docker is tried first; Kubernetes is used as a fallback.

```bash
kdm logs <name>         # Container name/ID prefix or pod name
```

### Diagnostics & AI Analysis

Scan your Kubernetes cluster for common workload issues (mismatched replicas, crashing containers, invalid Gateway routes, etc.) and get AI-powered troubleshooting advice in plain English.

```bash
kdm analyze                          # Run cluster diagnostics and output color-coded report
kdm analyze -n default               # Analyze resources in the 'default' namespace only
kdm analyze --explain                # Run diagnostics and fetch AI explanation
kdm analyze --explain --backend ollama # Force specific active AI backend provider
kdm analyze --explain --anonymize    # Anonymize resource names in prompt to protect sensitive data
kdm analyze --output json            # Output results in structured JSON format
```

### AI Providers (Auth)

Manage AI backend settings and credentials. KDM supports **10+** AI providers including OpenAI, Anthropic, Gemini, Vertex, OCI GenAI, HuggingFace, Groq, WatsonX, and Ollama.

```bash
kdm auth add -b openai -m gpt-4o -p <key> # Configure OpenAI gpt-4o with API key
kdm auth add -b ollama -m llama3.1       # Configure local Ollama llama3.1
kdm auth list                            # List configured AI backends and settings
kdm auth default ollama                  # Set default active AI backend
kdm auth remove openai                   # Remove backend credentials from config
kdm auth update ollama -t 0.2            # Update settings (e.g. set temperature to 0.2)
```

### Local Explanation Cache

KDM caches AI explanations locally to save API tokens and reduce network latency.

```bash
kdm cache list              # List all cached AI explanation keys
kdm cache get <key>         # Retrieve cached text for a key
kdm cache remove <key>      # Delete a specific cached entry
kdm cache purge             # Clear all cached AI explanations
```

### Analyzer Filters

By default, KDM runs all core resource analyzers. You can customize which analyzers are active.

```bash
kdm filters list            # List active filters and available inactive ones
kdm filters add Ingress     # Add Ingress analyzer to active default filters list
kdm filters remove Ingress  # Remove analyzer from active list (falls back to defaults)
```

### Custom Analyzers

Register custom scripts/commands or HTTP webhooks to analyze arbitrary custom resources (CRDs) like Kyverno, KEDA, and Prometheus.

```bash
kdm custom-analyzer add keda --command "kubectl get scaledobjects -A -o json" # Add custom analyzer command
kdm custom-analyzer add my-webhook --url "https://api.my-org.internal/check"  # Add custom HTTP analyzer
kdm custom-analyzer list                                                     # List all custom analyzers
kdm custom-analyzer remove keda                                              # Remove custom analyzer
```

### HTTP & MCP Server

Run KDM in server mode. KDM can run as a standard REST API or as a **Model Context Protocol (MCP)** server, enabling seamless integration with AI agents (like Claude Desktop).

```bash
kdm serve --port 8080       # Start KDM HTTP REST server on port 8080
kdm serve --mcp             # Start KDM JSON-RPC MCP server over stdio
```

### Configuration

Set up notification services and manage configuration interactively.

```bash
kdm config setup        # Interactive setup (Discord webhook / Email SMTP)
kdm config list         # Show current configuration
kdm config set <key> <value>   # Set a specific value
kdm config clear        # Clear all configuration
```

### Help

```bash
kdm --help              # Show all commands and options
kdm <command> --help    # Show help for a specific command
```

---

## Configuration

KDM stores configuration locally using the [`conf`](https://github.com/sindresorhus/conf) package.

### Config File Location

| OS      | Path |
|---------|------|
| macOS   | `~/Library/Application Support/kdm-cli` |
| Linux   | `~/.config/kdm-cli` |
| Windows | `%APPDATA%\kdm-cli` |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `KDM_SMTP_PASSWORD` | SMTP password (overrides stored config for security) |

### Notification Services

Set up alerts to be notified when containers restart or pods enter failure states (`CrashLoopBackOff`, `ImagePullBackOff`, `Failed`, etc.).

```bash
kdm config setup
```

Supports:

- **Discord** — via webhook URL
- **Email (SMTP)** — via SMTP credentials

Alerts are rate-limited with a configurable cooldown (default: 300 seconds).

```bash
kdm config set alert_cooldown 600   # 10 minutes between alerts
```

---

## Alert Monitoring

KDM automatically checks for failure conditions and sends notifications when configured:

| Condition | Severity | Source |
|-----------|----------|--------|
| Container restarting | Warning | Docker |
| Container non-zero exit | Critical | Docker |
| Pod phase is `Failed` | Critical | Kubernetes |
| `CrashLoopBackOff` | Critical | Kubernetes |
| `ImagePullBackOff` | Critical | Kubernetes |
| `CreateContainerConfigError` | Critical | Kubernetes |

---

## Technical Stack

| Technology | Purpose |
|------------|---------|
| [TypeScript] + [Node.js] | Runtime and language |
| [Commander.js] | CLI framework and argument parsing |
| [dockerode] | Docker daemon API client |
| [@kubernetes/client-node] | Kubernetes API client |
| [Ink] + [React] | Interactive terminal UI (watch mode) |
| [chalk] | Terminal string coloring |
| [cli-table3] | Table rendering |
| [conf] | Persistent configuration |
| [nodemailer] | Email alerts |
| [tsup] | High-performance bundler |

[TypeScript]: https://www.typescriptlang.org
[Node.js]: https://nodejs.org
[Commander.js]: https://github.com/tj/commander.js
[dockerode]: https://github.com/apocas/dockerode
[@kubernetes/client-node]: https://github.com/kubernetes-client/javascript
[Ink]: https://github.com/vadimdemedes/ink
[React]: https://react.dev
[chalk]: https://github.com/chalk/chalk
[cli-table3]: https://github.com/cli-table/cli-table3
[conf]: https://github.com/sindresorhus/conf
[nodemailer]: https://nodemailer.com
[tsup]: https://tsup.egoist.dev

---

## Documentation

For detailed command reference, see:

- [Contribution Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Changelog](docs/README.md)

---

## Contributing

We welcome contributions of all kinds — bug reports, feature suggestions, and pull requests.

Please read our [Contribution Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

### Development Setup

```bash
git clone https://github.com/KDM-cli/kdm-cli.git
cd kdm-cli
npm install
npm run dev        # Watch mode for development
npm test           # Run test suite
npm run build      # Production build
```

---

## Contributors

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<div align="center">

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%">
        <a href="https://yuvraj-sarathe.github.io/Portfolio/">
          <img src="https://avatars.githubusercontent.com/u/216678101?v=4" width="100px;" alt="Yuvraj Sarathe"/><br/>
          <sub><b>Yuvraj Sarathe</b></sub>
        </a>
        <br/>
        <a href="#infra-Yuvraj-Sarathe" title="Infrastructure">🚇</a>
        <a href="https://github.com/KDM-cli/kdm-cli/pull/43" title="Documentation Automation">📖</a>
      </td>
      <td align="center" valign="top" width="14.28%">
        <a href="https://github.com/utkarsh232005">
          <img src="https://avatars.githubusercontent.com/u/137105846?v=4" width="100px;" alt="Utkarsh Patrikar"/><br/>
          <sub><b>Utkarsh Patrikar</b></sub>
        </a>
        <br/>
        <a href="#code-utkarsh232005" title="Code">💻</a>
        <a href="#infra-utkarsh232005" title="CI/CD & Infrastructure">🚇</a>
        <a href="#maintenance-utkarsh232005" title="Maintenance">🚧</a>
      </td>
      <td align="center" valign="top" width="14.28%">
        <a href="https://github.com/blut-agent">
          <img src="https://avatars.githubusercontent.com/u/278569635?v=4" width="100px;" alt="blut-agent"/><br/>
          <sub><b>blut-agent</b></sub>
        </a>
        <br/>
        <a href="https://github.com/KDM-cli/kdm-cli/pull/29" title="Version Check Feature">✨</a>
        <a href="https://github.com/KDM-cli/kdm-cli/pull/28" title="Docs Structure">📖</a>
        <a href="https://github.com/KDM-cli/kdm-cli/pull/23" title="Credential Setup">🔐</a>
      </td>
      <td align="center" valign="top" width="14.28%">
        <a href="https://github.com/Rishiraj-Pathak-27">
          <img src="https://avatars.githubusercontent.com/u/180004050?v=4" width="100px;" alt="Rishiraj Pathak"/><br/>
          <sub><b>Rishiraj Pathak</b></sub>
        </a>
        <br/>
        <a href="https://github.com/KDM-cli/kdm-cli/pull/40" title="Logs & Health Implementation">💻</a>
      </td>
      <td align="center" valign="top" width="14.28%">
        <a href="https://github.com/fizyxbt">
          <img src="https://avatars.githubusercontent.com/u/17788586?v=4" width="100px;" alt="fizyxbt"/><br/>
          <sub><b>fizyxbt</b></sub>
        </a>
        <br/>
        <a href="https://github.com/KDM-cli/kdm-cli/pull/23" title="Credential Setup Guidance">✨</a>
      </td>
    </tr>
  </tbody>
</table>
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

</div>

This project follows the [All Contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind are welcome!

---

## License

[GNU Affero General Public License v3.0](LICENSE) — See [LICENSE](LICENSE) for full terms.

<div align="center">

**Maintained by [KDM-cli](https://github.com/KDM-cli)** &middot; Built with ❤️ by the community

</div>
