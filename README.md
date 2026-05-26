# KDM — Kubernetes + Docker Monitoring CLI

[![All Contributors](https://img.shields.io/github/all-contributors/KDM-cli/kdm-cli?color=ee8449&style=flat-square)](#contributors)

KDM (Kubernetes Docker Monitor) is a lightweight, terminal-based monitoring CLI tool that automatically detects and monitors running Docker containers and Kubernetes pods. It provides real-time resource usage, health status, and unified views of your runners.

## Features

- **Auto-Detection**: Automatically detects Docker containers and Kubernetes pods in your local environment.
- **Unified Runner View**: Combined view of Docker and Kubernetes workloads.
- **Health Monitoring**: Advanced health status for both containers and pods (Ready, Unhealthy, CrashLoopBackOff, etc.).
- **Live Watch Mode**: Real-time monitoring of resource usage.
- **Logs**: Easily fetch logs from both Docker and Kubernetes sources.
- **Beautiful UI**: Interactive terminal UI powered by Ink and Commander.

## Installation

Install kdm-cli via npm:
```bash
npm install -g kdm-cli
```

Run directly with npx:

```bash
npx kdm-cli
```

## Usage

### Show Workloads

```bash
kdm show runners     # Show all running pods + containers
kdm show pods        # Show kubernetes pods
kdm show containers  # Show docker containers
kdm show minikube    # Show minikube status
```

### Health Status

```bash
kdm health pods      # Show health status for pods
kdm health containers # Show health status for containers
```

### Monitoring & Logs

```bash
kdm watch            # Live monitoring mode
kdm logs <name>      # Show logs for a container or pod
```

### Help

```bash
kdm --help
```

## Technical Details

KDM is built with:
- **TypeScript** & **Node.js**
- **Commander.js** for CLI orchestration
- **dockerode** for Docker integration
- **@kubernetes/client-node** for Kubernetes integration
- **Ink** for terminal UI
- **tsup** for high-performance bundling

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://yuvraj-sarathe.github.io/Portfolio/"><img src="https://avatars.githubusercontent.com/u/216678101?v=4?s=100" width="100px;" alt="Yuvraj Sarathe"/><br /><sub><b>Yuvraj Sarathe</b></sub></a><br /><a href="#infra-Yuvraj-Sarathe" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License

MIT
