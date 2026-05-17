# `kdm health` — Health Status

> **Version:** `v1.2.1`

---

## Overview

The `kdm health` command checks and reports the health status of Kubernetes pods or Docker containers. It provides a clean, color-coded table with real-time status fetched directly from Docker and Kubernetes clients.

> **Fix (Issue #1):**  
> This command previously returned only a placeholder message. It now displays real health data from Docker containers and Kubernetes pods.

---

# Syntax

```bash
kdm health <target>
```

---

# Parameters

| Parameter | Description | Valid Values |
| :--- | :--- | :--- |
| `target` | The workload type to check | `pods`, `containers`, `all` |

---

# Usage

---

## `kdm health pods`

Checks the health status of all Kubernetes pods.

### Example

```bash
kdm health pods
```

### Expected Output

```text
╭──────┬─────────────────────────────┬─────────┬──────────────────────────────────────╮
│ TYPE │ NAME                        │ HEALTH  │ DETAILS                              │
├──────┼─────────────────────────────┼─────────┼──────────────────────────────────────┤
│ pod  │ node-app-6f65c56b74-7tkvf   │ Running │ namespace: default, restarts: 0      │
│ pod  │ nginx-deployment-abc123     │ Failed  │ namespace: production, restarts: 5   │
╰──────┴─────────────────────────────┴─────────┴──────────────────────────────────────╯
```

### Health Indicators

| Status Color | Meaning |
| :--- | :--- |
| 🟢 Green | `healthy`, `running`, `Running` |
| 🔴 Red | `unhealthy`, `exited`, `Failed` |
| 🟡 Yellow | Other states like `Pending`, `paused` |

### Use Cases

- Monitor pod health in real time
- Identify failing services before outages occur

---

## `kdm health containers`

Checks the health status of all Docker containers.

### Example

```bash
kdm health containers
```

### Expected Output

```text
╭───────────┬────────────┬─────────┬───────────────╮
│ TYPE      │ NAME       │ HEALTH  │ DETAILS       │
├───────────┼────────────┼─────────┼───────────────┤
│ container │ test-nginx │ running │ Up 8 minutes  │
│ container │ my-app     │ exited  │ Exited (1)    │
╰───────────┴────────────┴─────────┴───────────────╯
```

### Use Cases

- Verify container health
- Detect unhealthy or restarting containers

---

## `kdm health all`

Checks health for both pods and containers in a single command. If one source (Docker or Kubernetes) is unavailable, the other still renders successfully.

### Example

```bash
kdm health all
```

---

### Expected Output (Kubernetes unavailable)

```text
⚠ Kubernetes unavailable: connect ECONNREFUSED 127.0.0.1:8080

╭───────────┬────────────┬─────────┬──────────────╮
│ TYPE      │ NAME       │ HEALTH  │ DETAILS      │
├───────────┼────────────┼─────────┼──────────────┤
│ container │ test-nginx │ running │ Up 8 minutes │
╰───────────┴────────────┴─────────┴──────────────╯
```

---

### Expected Output (Both available)

```text
╭───────────┬───────────────────────────┬─────────┬──────────────────────────────────────╮
│ TYPE      │ NAME                      │ HEALTH  │ DETAILS                              │
├───────────┼───────────────────────────┼─────────┼──────────────────────────────────────┤
│ container │ test-nginx                │ running │ Up 8 minutes                         │
│ pod       │ node-app-6f65c56b74-7tkvf │ Running │ namespace: default, restarts: 0      │
╰───────────┴───────────────────────────┴─────────┴──────────────────────────────────────╯
```

---

# Common Errors

| Error | Cause | Fix |
| :--- | :--- | :--- |
| `Unknown target` | Invalid target passed | Use `pods`, `containers`, or `all` |
| `No workloads found` | No containers or pods running | Start Docker containers or Kubernetes pods |
| `Docker unavailable` | Docker daemon not running | Run `sudo systemctl start docker` |
| `Kubernetes unavailable` | No cluster connection | Run `minikube start` or configure `kubectl` |

---

# Notes

- Supports both Docker and Kubernetes environments
- Displays partial results even if one backend fails
- Provides readable CLI tables for faster debugging and monitoring