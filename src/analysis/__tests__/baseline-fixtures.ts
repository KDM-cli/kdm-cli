/**
 * Frozen baseline fixtures for deterministic offline analysis testing.
 *
 * Each fixture represents a canonical Kubernetes workload failure mode
 * with corresponding mock AnalyzerResult objects and expected LLM responses.
 * These fixtures enable regression testing without a live cluster or active AI server.
 *
 * @module baseline-fixtures
 */
import type { AnalyzerResult } from '../../analyzers/types';
import type { LegacyAnalysisResult } from '../types';

// ─── OOMKilled (exit code 137) ──────────────────────────────────────────────

/**
 * Simulates a pod where the `auth` container was terminated with exit code 137
 * due to exceeding its memory limit (OOMKilled).
 */
export const OOM_KILLED_FIXTURE: AnalyzerResult = {
  kind: 'Pod',
  name: 'auth-service-7bbd8f4b5-9x7q2',
  namespace: 'production',
  parentObject: 'Deployment/auth-service',
  errors: [
    {
      text: 'Container "auth" terminated with exit code 137 (OOMKilled). Last restart 5 minutes ago. Restart count: 5. Memory limit: 256Mi.',
    },
  ],
};

/**
 * Expected legacy analysis result for the OOMKilled failure mode.
 */
export const OOM_KILLED_EXPECTED_RESULT: LegacyAnalysisResult = {
  rootCause: 'Container terminated with exit code 137 due to Out Of Memory (OOMKilled).',
  suggestedFix:
    'Increase the memory limit for container "auth" in Deployment/auth-service. ' +
    'Consider profiling the application to identify memory leaks before simply raising limits.',
  confidence: 1.0,
  rawOutput:
    'Root Cause: Container terminated with exit code 137 due to Out Of Memory (OOMKilled).\n' +
    'Suggested Fix: Increase the memory limit for container "auth" in Deployment/auth-service. ' +
    'Consider profiling the application to identify memory leaks before simply raising limits.\n' +
    'Confidence: 1.0',
  durationMs: 150,
};

/**
 * Mock LLM response text returned when the OOMKilled fixture is sent for explanation.
 */
export const OOM_KILLED_LLM_RESPONSE =
  'Root Cause: Container terminated with exit code 137 due to Out Of Memory (OOMKilled).\n' +
  'Suggested Fix: Increase the memory limit for container "auth" in Deployment/auth-service. ' +
  'Consider profiling the application to identify memory leaks before simply raising limits.\n' +
  'Confidence: 1.0';

// ─── CrashLoopBackOff (exit code 1) ────────────────────────────────────────

/**
 * Simulates a pod stuck in CrashLoopBackOff with a non-zero exit code
 * due to an application panic on startup.
 */
export const CRASH_LOOP_FIXTURE: AnalyzerResult = {
  kind: 'Pod',
  name: 'payment-gateway-6c9d4f5c8-4kp2m',
  namespace: 'payments',
  parentObject: 'Deployment/payment-gateway',
  errors: [
    {
      text: 'Container "payment" in CrashLoopBackOff. Last terminated with exit code 1 (Error). ' +
        'Back-off restarting failed container. Restart count: 12.',
    },
  ],
};

/**
 * Expected legacy analysis result for the CrashLoopBackOff failure mode.
 */
export const CRASH_LOOP_EXPECTED_RESULT: LegacyAnalysisResult = {
  rootCause: 'Container is in CrashLoopBackOff with exit code 1 indicating an application-level error on startup.',
  suggestedFix:
    'Check application logs with `kubectl logs payment-gateway-6c9d4f5c8-4kp2m -n payments -c payment --previous`. ' +
    'Verify environment variables, config maps, and database connectivity.',
  confidence: 0.9,
  rawOutput:
    'Root Cause: Container is in CrashLoopBackOff with exit code 1 indicating an application-level error on startup.\n' +
    'Suggested Fix: Check application logs with `kubectl logs payment-gateway-6c9d4f5c8-4kp2m -n payments -c payment --previous`. ' +
    'Verify environment variables, config maps, and database connectivity.\n' +
    'Confidence: 0.9',
  durationMs: 200,
};

/**
 * Mock LLM response text for the CrashLoopBackOff fixture.
 */
export const CRASH_LOOP_LLM_RESPONSE =
  'Root Cause: Container is in CrashLoopBackOff with exit code 1 indicating an application-level error on startup.\n' +
  'Suggested Fix: Check application logs with `kubectl logs payment-gateway-6c9d4f5c8-4kp2m -n payments -c payment --previous`. ' +
  'Verify environment variables, config maps, and database connectivity.\n' +
  'Confidence: 0.9';

// ─── ImagePullBackOff (registry auth failure) ───────────────────────────────

/**
 * Simulates a pod with ImagePullBackOff caused by invalid registry credentials
 * or a missing image pull secret.
 */
export const IMAGE_PULL_BACKOFF_FIXTURE: AnalyzerResult = {
  kind: 'Pod',
  name: 'frontend-app-5b7d6f4a3-2zt8n',
  namespace: 'staging',
  parentObject: 'Deployment/frontend-app',
  errors: [
    {
      text: 'Container "frontend" image pull failed: ImagePullBackOff. ' +
        'Failed to pull image "private-registry.example.com/frontend:v2.3.1": ' +
        'rpc error: code = Unknown desc = Error response from daemon: unauthorized: authentication required.',
    },
  ],
};

/**
 * Expected legacy analysis result for the ImagePullBackOff failure mode.
 */
export const IMAGE_PULL_BACKOFF_EXPECTED_RESULT: LegacyAnalysisResult = {
  rootCause:
    'Image pull failed due to authentication failure against private registry. ' +
    'The image pull secret is either missing, expired, or misconfigured.',
  suggestedFix:
    'Verify the imagePullSecrets configuration in the pod spec. ' +
    'Ensure a valid docker-registry secret exists in namespace "staging" with correct credentials for private-registry.example.com.',
  confidence: 0.95,
  rawOutput:
    'Root Cause: Image pull failed due to authentication failure against private registry. ' +
    'The image pull secret is either missing, expired, or misconfigured.\n' +
    'Suggested Fix: Verify the imagePullSecrets configuration in the pod spec. ' +
    'Ensure a valid docker-registry secret exists in namespace "staging" with correct credentials for private-registry.example.com.\n' +
    'Confidence: 0.95',
  durationMs: 180,
};

/**
 * Mock LLM response text for the ImagePullBackOff fixture.
 */
export const IMAGE_PULL_BACKOFF_LLM_RESPONSE =
  'Root Cause: Image pull failed due to authentication failure against private registry. ' +
  'The image pull secret is either missing, expired, or misconfigured.\n' +
  'Suggested Fix: Verify the imagePullSecrets configuration in the pod spec. ' +
  'Ensure a valid docker-registry secret exists in namespace "staging" with correct credentials for private-registry.example.com.\n' +
  'Confidence: 0.95';

// ─── Readiness Probe Failure (HTTP 500 on /healthz) ─────────────────────────

/**
 * Simulates a pod whose readiness probe consistently fails with HTTP 500,
 * causing the pod to be removed from service endpoints.
 */
export const PROBE_FAILURE_FIXTURE: AnalyzerResult = {
  kind: 'Pod',
  name: 'api-server-8f6d5c4a2-7mk3p',
  namespace: 'default',
  parentObject: 'Deployment/api-server',
  errors: [
    {
      text: 'Readiness probe failed: HTTP probe failed with statuscode: 500. ' +
        'Probe endpoint: GET /healthz:8080. Failure threshold: 3. ' +
        'Pod removed from service endpoints.',
    },
  ],
};

/**
 * Expected legacy analysis result for the readiness probe failure mode.
 */
export const PROBE_FAILURE_EXPECTED_RESULT: LegacyAnalysisResult = {
  rootCause:
    'Readiness probe failing with HTTP 500 on /healthz. The application is running but not healthy. ' +
    'Pod has been removed from service endpoints.',
  suggestedFix:
    'Check the application health endpoint `/healthz` for errors. ' +
    'Review application logs for startup failures, dependency timeouts, or database connection issues. ' +
    'Consider adjusting initialDelaySeconds if the application needs more time to initialize.',
  confidence: 0.85,
  rawOutput:
    'Root Cause: Readiness probe failing with HTTP 500 on /healthz. The application is running but not healthy. ' +
    'Pod has been removed from service endpoints.\n' +
    'Suggested Fix: Check the application health endpoint `/healthz` for errors. ' +
    'Review application logs for startup failures, dependency timeouts, or database connection issues. ' +
    'Consider adjusting initialDelaySeconds if the application needs more time to initialize.\n' +
    'Confidence: 0.85',
  durationMs: 170,
};

/**
 * Mock LLM response text for the readiness probe failure fixture.
 */
export const PROBE_FAILURE_LLM_RESPONSE =
  'Root Cause: Readiness probe failing with HTTP 500 on /healthz. The application is running but not healthy. ' +
  'Pod has been removed from service endpoints.\n' +
  'Suggested Fix: Check the application health endpoint `/healthz` for errors. ' +
  'Review application logs for startup failures, dependency timeouts, or database connection issues. ' +
  'Consider adjusting initialDelaySeconds if the application needs more time to initialize.\n' +
  'Confidence: 0.85';

// ─── Fixture Collection ─────────────────────────────────────────────────────

/**
 * Unified collection of all baseline fixtures for iteration in tests.
 */
export const ALL_FIXTURES = [
  {
    name: 'OOMKilled',
    analyzerResult: OOM_KILLED_FIXTURE,
    expectedResult: OOM_KILLED_EXPECTED_RESULT,
    llmResponse: OOM_KILLED_LLM_RESPONSE,
  },
  {
    name: 'CrashLoopBackOff',
    analyzerResult: CRASH_LOOP_FIXTURE,
    expectedResult: CRASH_LOOP_EXPECTED_RESULT,
    llmResponse: CRASH_LOOP_LLM_RESPONSE,
  },
  {
    name: 'ImagePullBackOff',
    analyzerResult: IMAGE_PULL_BACKOFF_FIXTURE,
    expectedResult: IMAGE_PULL_BACKOFF_EXPECTED_RESULT,
    llmResponse: IMAGE_PULL_BACKOFF_LLM_RESPONSE,
  },
  {
    name: 'ProbeFailure',
    analyzerResult: PROBE_FAILURE_FIXTURE,
    expectedResult: PROBE_FAILURE_EXPECTED_RESULT,
    llmResponse: PROBE_FAILURE_LLM_RESPONSE,
  },
] as const;
