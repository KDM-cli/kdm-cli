# `kdm logs` — Show Logs

> **Version:** `v1.2.1`

---

## Overview

The `kdm logs` command retrieves and displays logs from a specified Docker container or Kubernetes pod. Docker is tried first, and Kubernetes is used automatically as a fallback if no matching container is found.

> **Fix (Issue #1):**  
> This command previously returned only a placeholder message. It now fetches real logs from Docker containers with automatic fallback to Kubernetes pods.

---

# Syntax

```bash
kdm logs <name>
```

---

# Parameters

| Parameter | Description |
| :--- | :--- |
| `name` | Container ID prefix, Docker container name, or Kubernetes pod name |

---

# Usage

---

## `kdm logs <name>`

Fetches and displays the last 100 lines of logs for the specified workload.

---

### Example (Docker Container)

```bash
kdm logs test-nginx
```

### Expected Output

```text
✔ Fetching logs for test-nginx... (0.0s)

/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration
/docker-entrypoint.sh: Looking for shell scripts in /docker-entrypoint.d/
2026/05/17 06:43:38 [notice] 1#1: nginx/1.31.0
2026/05/17 06:43:38 [notice] 1#1: start worker processes
```

---

### Example (Kubernetes Pod)

```bash
kdm logs node-app-6f65c56b74-7tkvf
```

### Expected Output

```text
✔ Fetching logs for node-app-6f65c56b74-7tkvf... (0.0s)

Server listening on port 3000
Connected to database
GET /api/health 200 12ms
```

---

### Example (Container ID Prefix)

```bash
kdm logs a1b2c3d4
```

---

# How It Works

```text
Docker containers ──► match found? ──► show logs
        │
        ▼ no match
Kubernetes pods ──► match found? ──► show logs
        │
        ▼ no match
"No container or pod named X found"
```

### Workflow

1. **Docker First**
   - Searches running and stopped containers by ID prefix or container name

2. **Kubernetes Fallback**
   - If no Docker match is found, searches all Kubernetes pods across namespaces

3. **Error Handling**
   - Displays an error if neither Docker nor Kubernetes has a matching workload

---

# Finding the Right Name

```bash
# List Docker containers
docker ps

# List Kubernetes pods
kubectl get pods --all-namespaces

# Or use KDM itself
kdm show containers
kdm show pods
```

---

# Common Errors

| Error | Cause | Fix |
| :--- | :--- | :--- |
| `No container or pod named X found` | Name does not match any workload | Use `kdm show containers` or `kdm show pods` |
| `Docker unavailable` | Docker daemon is not running | Run `sudo systemctl start docker` |
| `Failed to fetch logs` | Kubernetes API unreachable | Run `minikube start` or configure `kubectl` |

---

# Notes

- Automatically falls back from Docker to Kubernetes
- Supports container name and ID prefix matching
- Displays real-time logs directly from workloads
- Retrieves the last 100 log lines for faster debugging