## 2023-11-20 - [Missing input length limits and security headers in local HTTP server]
**Vulnerability:** The local CLI dashboard HTTP server did not limit the length of POST request bodies, introducing a DoS risk. In addition, it lacked basic security headers.
**Learning:** Even local CLI HTTP servers require fundamental HTTP security controls (like payload limits and headers) to prevent exploitation, particularly since they may interact with browsers or external services via custom endpoints.
**Prevention:** Always enforce a request size limit on raw Node.js streams and return generic security headers for JSON API responses.
## 2024-05-24 - [Critical] Path Traversal in File Cache
**Vulnerability:** Path Traversal vulnerability in FileCacheProvider due to unsanitized cache keys.
**Learning:** User input acting as filenames must always be validated to ensure it cannot escape the intended directory.
**Prevention:** Always use path.resolve and verify the resulting path starts with the intended base directory.
## 2024-05-24 - [CRITICAL] Node.js Local HTTP Server Binding
**Vulnerability:** The local bridge HTTP server used to integrate with the Python Ollama Multi-Agent Council (`src/server/server.ts`) was listening on `options.port` without specifying a host interface.
**Learning:** In Node.js, `server.listen(port)` without a host binds to `0.0.0.0` (all IPv4 addresses) by default, exposing the local server (and its unauthenticated `/analyze` and `/config` endpoints) to the entire local network, rather than just `127.0.0.1`.
**Prevention:** Always explicitly bind local-only servers to `127.0.0.1` (`server.listen(port, '127.0.0.1')`) to prevent unintended network exposure.
## 2024-11-06 - Local Server CSRF & Caching Gap
**Vulnerability:** The local CLI server exposed `POST /analyze` without CSRF protection and sent sensitive configuration data without `Cache-Control: no-store` headers.
**Learning:** Local CLIs exposing HTTP endpoints for Dashboards/MCP are vulnerable to CSRF via simple requests if `Content-Type` is not strictly enforced.
**Prevention:** Always strictly validate `Content-Type: application/json` to trigger preflight requests, and add `Cache-Control: no-store` to all JSON API responses.

## YYYY-MM-DD - [CRITICAL] Prevent Command Injection in minikube client
**Vulnerability:** Used `exec` to execute internal minikube commands which can be vulnerable to command injection if user inputs are ever appended.
**Learning:** Internal system commands should prefer `execFile` or `spawn` instead of `exec` to prevent command injection risks.
**Prevention:** Always use `execFile` or `spawn` for known internal commands, reserving `exec` only for user-configurable custom analyzers.
## 2023-11-20 - [DoS vulnerability in Custom HTTP Analyzers]
**Vulnerability:** Unbounded fetch requests in custom HTTP analyzers
**Learning:** External webhook analyzers (`config.url`) lacked connection timeouts. As these URLs might be user-configured or target external services, hanging connections could cause the CLI process to wait indefinitely, resulting in a Denial of Service (DoS) vulnerability.
**Prevention:** Always provide an `AbortSignal.timeout()` when making native `fetch` requests to external services, especially those provided by users.
