import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { vi } from 'vitest';
import type { NDJSONEvent, ConsensusDiagnosis } from '../../../agent/types';

export interface MockProcessOptions {
  exitCode?: number;
  emitError?: boolean;
  malformedLines?: string[];
  delayMs?: number;
}

export class MockPythonCouncil {
  /**
   * Creates a mock ChildProcess emitting line-delimited NDJSON events on stdout.
   */
  static createMockProcess(events: NDJSONEvent[], options: MockProcessOptions = {}) {
    const { exitCode = 0, emitError = false, malformedLines = [], delayMs = 5 } = options;

    const proc = new EventEmitter() as any;
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });

    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.stdin = {
      write: vi.fn(),
      end: vi.fn(),
      destroyed: false,
    };
    proc.kill = vi.fn().mockImplementation((signal?: string) => {
      proc.emit('close', signal === 'SIGKILL' ? 137 : 143, signal || 'SIGTERM');
    });

    setTimeout(() => {
      if (emitError) {
        proc.emit('error', new Error('Python Council process crashed: spawn ENOENT'));
        return;
      }

      for (const badLine of malformedLines) {
        stdout.push(badLine + '\n');
      }

      for (const ev of events) {
        stdout.push(JSON.stringify(ev) + '\n');
      }

      stdout.push(null);
      stderr.push(null);

      let closed = false;
      const emitClose = () => {
        if (closed) return;
        closed = true;
        proc.emit('exit', exitCode, null);
        proc.emit('close', exitCode, null);
      };

      // Guaranteed lifecycle ordering: data drained -> stdout emits 'end' -> close emitted
      stdout.once('end', () => {
        setImmediate(emitClose);
      });

      // Flow stream in case no active data listener was attached
      setImmediate(() => {
        stdout.resume();
      });

      // Safety timeout fallback
      setTimeout(emitClose, 50);
    }, delayMs);

    return proc;
  }

  /**
   * Generates a realistic NDJSON sequence for an OOMKilled Pod triage session.
   */
  static createOOMKilledCouncilEvents(podName = 'payment-service-8f4b-2x9p', namespace = 'production'): NDJSONEvent[] {
    const now = new Date().toISOString();
    const consensus: ConsensusDiagnosis = {
      rootCause: `Pod ${podName} killed due to misaligned JVM heap (-Xmx768m) exceeding container cgroup memory limit (512Mi).`,
      confidence: 'high',
      findings: [
        {
          role: 'runtime',
          status: 'confirmed',
          summary: 'Detected exit code 137 (OOMKilled) in container payment-gateway with Java heap space error in logs.',
          evidence: ['exitCode: 137', 'java.lang.OutOfMemoryError: Java heap space'],
        },
        {
          role: 'config',
          status: 'confirmed',
          summary: 'Container limits.memory is configured to 512Mi in production deployment.',
          evidence: ['limits.memory: 512Mi'],
        },
        {
          role: 'resource',
          status: 'confirmed',
          summary: 'Node worker-node-4 has sufficient memory; failure is localized to container cgroup quota.',
          evidence: ['nodeMemoryFree: 8Gi'],
        },
      ],
      bestSolution: {
        actionTitle: 'Align JVM heap size and increase pod memory limit',
        steps: [
          'Increase container resources.limits.memory to 1024Mi',
          'Adjust JAVA_OPTS to -Xmx768m -XX:+UseContainerSupport',
          'Apply deployment patch and verify rollout',
        ],
        commandToRun: `kubectl patch deployment payment-service -n ${namespace} --patch '{"spec":{"template":{"spec":{"containers":[{"name":"payment-gateway","resources":{"limits":{"memory":"1024Mi"}}}]}}}}'`,
        riskLevel: 'medium',
      },
      evidenceCitations: ['ev-log-137', 'ev-manifest-cgroup-512', 'ev-node-mem-ok'],
    };

    return [
      { event: 'analysis_start', analysisId: 'triage-oom-001', timestamp: now },
      { event: 'evidence_collected', count: 3, ids: ['ev-log-137', 'ev-manifest-cgroup-512', 'ev-node-mem-ok'], timestamp: now },
      { event: 'agent_start', role: 'runtime', message: 'Analyzing pod termination reason and logs...', timestamp: now },
      {
        event: 'agent_tool_call',
        role: 'runtime',
        tool: 'k8s_get_logs',
        args: { pod: podName, namespace, tail: 100 },
        timestamp: now,
      },
      {
        event: 'agent_tool_result',
        role: 'runtime',
        tool: 'k8s_get_logs',
        durationMs: 42,
        timestamp: now,
      },
      { event: 'agent_complete', role: 'runtime', summary: 'Found OutOfMemoryError in logs.', timestamp: now },
      { event: 'agent_start', role: 'config', message: 'Verifying container resource limits vs codebase manifests...', timestamp: now },
      {
        event: 'agent_tool_call',
        role: 'config',
        tool: 'inspect_manifests',
        args: { file: 'charts/payment-service/values.yaml' },
        timestamp: now,
      },
      {
        event: 'agent_tool_result',
        role: 'config',
        tool: 'inspect_manifests',
        durationMs: 15,
        timestamp: now,
      },
      { event: 'agent_complete', role: 'config', summary: 'Discovered JAVA_OPTS -Xmx768m exceeding 512Mi limit.', timestamp: now },
      { event: 'diagnosis_ready', consensus, timestamp: now },
    ];
  }

  /**
   * Generates a realistic NDJSON sequence for a CrashLoopBackOff Pod remediation session.
   */
  static createCrashLoopCouncilEvents(podName = 'auth-api-v2-7c91', namespace = 'auth'): NDJSONEvent[] {
    const now = new Date().toISOString();
    const consensus: ConsensusDiagnosis = {
      rootCause: `Pod ${podName} is in CrashLoopBackOff because of mismatched secretKeyRef: secret contains key DATABASE_URL, but deployment expects db-url.`,
      confidence: 'high',
      findings: [
        {
          role: 'runtime',
          status: 'confirmed',
          summary: 'Container auth-server exited with code 1: Missing required environment variable DATABASE_URL',
          evidence: ['exitCode: 1', 'Missing required environment variable DATABASE_URL'],
        },
        {
          role: 'config',
          status: 'confirmed',
          summary: 'secretKeyRef specifies db-url which does not exist in secret auth-secrets',
          evidence: ['secretKeyRef: db-url'],
        },
      ],
      bestSolution: {
        actionTitle: 'Fix secret key reference in deployment manifest',
        steps: [
          'Update deployment manifest secretKeyRef to DATABASE_URL',
          'Apply patch to deployment auth-api-v2',
          'Wait for rollout completion',
        ],
        commandToRun: `kubectl patch deployment auth-api-v2 -n ${namespace} --type=json -p='[{"op":"replace","path":"/spec/template/spec/containers/0/env/0/valueFrom/secretKeyRef/key","value":"DATABASE_URL"}]'`,
        riskLevel: 'medium',
      },
      evidenceCitations: ['ev-missing-env', 'ev-secret-mismatch'],
    };

    return [
      { event: 'analysis_start', analysisId: 'triage-crashloop-002', timestamp: now },
      { event: 'evidence_collected', count: 2, ids: ['ev-missing-env', 'ev-secret-mismatch'], timestamp: now },
      { event: 'agent_start', role: 'runtime', message: 'Inspecting container crash logs...', timestamp: now },
      {
        event: 'agent_tool_call',
        role: 'runtime',
        tool: 'k8s_get_logs',
        args: { pod: podName, namespace },
        timestamp: now,
      },
      { event: 'agent_complete', role: 'runtime', summary: 'Missing required env DATABASE_URL.', timestamp: now },
      { event: 'agent_start', role: 'config', message: 'Checking secret dependencies...', timestamp: now },
      { event: 'agent_complete', role: 'config', summary: 'Found mismatched key reference.', timestamp: now },
      { event: 'diagnosis_ready', consensus, timestamp: now },
    ];
  }

  /**
   * Generates a sequence for Docker container restart loop with destructive proposal.
   */
  static createDockerRestartCouncilEvents(containerName = 'postgres-local'): NDJSONEvent[] {
    const now = new Date().toISOString();
    const consensus: ConsensusDiagnosis = {
      rootCause: `Docker container ${containerName} is failing to start because of a stale postmaster.pid lock file from previous crash.`,
      confidence: 'high',
      findings: [
        {
          role: 'runtime',
          status: 'confirmed',
          summary: 'Container repeatedly exits with code 1. Logs show FATAL: lock file "postmaster.pid" already exists.',
          evidence: ['FATAL: lock file "postmaster.pid" already exists'],
        },
      ],
      bestSolution: {
        actionTitle: 'Remove container and recreate (destructive)',
        steps: [
          'docker rm -f postgres-local',
          'docker run --name postgres-local ...',
        ],
        commandToRun: 'docker rm -f postgres-local',
        riskLevel: 'high',
      },
      evidenceCitations: ['ev-docker-stale-lock'],
    };

    return [
      { event: 'analysis_start', analysisId: 'triage-docker-003', timestamp: now },
      { event: 'agent_start', role: 'runtime', message: 'Inspecting container logs...', timestamp: now },
      {
        event: 'agent_tool_call',
        role: 'runtime',
        tool: 'docker_inspect_container',
        args: { containerId: containerName },
        timestamp: now,
      },
      { event: 'agent_complete', role: 'runtime', summary: 'Stale lock file detected.', timestamp: now },
      { event: 'diagnosis_ready', consensus, timestamp: now },
    ];
  }

  /**
   * Generates a cross-service cascading failure sequence.
   */
  static createCascadingFailureCouncilEvents(): NDJSONEvent[] {
    const now = new Date().toISOString();
    const consensus: ConsensusDiagnosis = {
      rootCause: 'Cascading failure: api-gateway CPU throttling caused liveness probe timeout (>1s), triggering container restart and upstream ingress 502 Bad Gateway drops.',
      confidence: 'high',
      findings: [
        {
          role: 'runtime',
          status: 'confirmed',
          summary: 'Ingress logs show connection refused to api-gateway during liveness restart cycle.',
        },
        {
          role: 'resource',
          status: 'confirmed',
          summary: 'api-gateway CPU utilization at 98% cgroup limit due to regex parsing backlog.',
        },
        {
          role: 'config',
          status: 'confirmed',
          summary: 'Liveness probe timeoutSeconds is set to 1s with failureThreshold 2.',
        },
      ],
      bestSolution: {
        actionTitle: 'Increase liveness probe timeout and scale CPU limits',
        steps: [
          'Increase liveness probe timeoutSeconds to 5',
          'Increase CPU limit to 1500m',
        ],
        commandToRun: 'kubectl patch deployment api-gateway -n prod --patch \'{"spec":{"template":{"spec":{"containers":[{"name":"api","resources":{"limits":{"cpu":"1500m"}}}]}}}}\'',
        riskLevel: 'medium',
      },
    };

    return [
      { event: 'analysis_start', analysisId: 'triage-cascade-005', timestamp: now },
      { event: 'agent_start', role: 'runtime', message: 'Correlating ingress error spikes...', timestamp: now },
      { event: 'agent_complete', role: 'runtime', summary: 'Ingress 502s correlate with gateway restart.', timestamp: now },
      { event: 'agent_start', role: 'resource', message: 'Checking resource throttling...', timestamp: now },
      { event: 'agent_complete', role: 'resource', summary: 'CPU throttling detected.', timestamp: now },
      { event: 'agent_start', role: 'config', message: 'Inspecting probe settings...', timestamp: now },
      { event: 'agent_complete', role: 'config', summary: 'Liveness probe timeout is too aggressive (1s).', timestamp: now },
      { event: 'diagnosis_ready', consensus, timestamp: now },
    ];
  }
}
