/**
 * Canonical Kubernetes failure diagnostic rules.
 *
 * Implements deterministic pattern matching for:
 * - OOMKilled (exit code 137, memory limit exceeded)
 * - CrashLoopBackOff (process restart loops, non-zero exits)
 * - ImagePullBackOff / ErrImagePull (repository/manifest failures)
 * - ProbeFailure (liveness/readiness/startup health check failures)
 * - Scheduling Failure (resource exhaustion, unschedulable pod)
 */

import type { DiagnosticRule, RuleMatch, WorkloadContext } from './types';

function extractContainerName(text: string, fallback?: string): string {
  const match = text.match(/container\s+["']?([a-zA-Z0-9_.\-]+)["']?/i);
  return match?.[1] || fallback || 'container';
}

interface OomFacts {
  container: string;
  hasExit137: boolean;
  hasOomMention: boolean;
  memLimit?: string;
  confidence: number;
}

function detectOomFacts(text: string, context?: WorkloadContext): OomFacts | null {
  const hasExit137 = /\b137\b/.test(text) || /exit\s*code\s*[:=]?\s*137/i.test(text);
  const hasOomMention = /oomkilled|out[\s_-]?of[\s_-]?memory/i.test(text);
  const memLimitMatch = text.match(/memory\s*limit[:\s]*([0-9]+[a-zA-Z]+)/i);

  if (!hasExit137 && !hasOomMention && !memLimitMatch) {
    return null;
  }

  const container = extractContainerName(text, context?.container);
  const memLimit = memLimitMatch?.[1];
  const confidence = hasOomMention || (hasExit137 && Boolean(memLimit)) ? 1.0 : 0.8;

  return {
    container,
    hasExit137,
    hasOomMention,
    memLimit,
    confidence,
  };
}

function buildOomDetails(facts: OomFacts): string[] {
  const details: string[] = [];
  if (facts.hasExit137) {
    details.push(`Exit code 137 detected in container '${facts.container}'`);
  } else {
    details.push(`OOMKilled termination detected in container '${facts.container}'`);
  }

  if (facts.memLimit) {
    details.push(`Memory limit ${facts.memLimit} exceeded`);
  } else if (facts.hasOomMention) {
    details.push('Container memory limit exceeded');
  }

  details.push(`Confidence: ${Math.round(facts.confidence * 100)}%`);
  return details;
}

function buildWorkloadTarget(context?: WorkloadContext): { target: string; ns: string } {
  const kind = (context?.kind || 'deployment').toLowerCase();
  const name = context?.name || 'workload';
  const ns = context?.namespace ? ` -n ${context.namespace}` : '';
  return { target: `${kind}/${name}`, ns };
}

/**
 * Diagnoses container terminations caused by exceeding memory limits.
 */
export class OOMKilledRule implements DiagnosticRule {
  readonly ruleId = 'rule.kubernetes.oom_killed';
  readonly title = 'Container Out-Of-Memory (OOMKilled)';

  evaluate(failureText: string, context?: WorkloadContext): RuleMatch | null {
    const facts = detectOomFacts(failureText, context);
    if (!facts) return null;

    const { target, ns } = buildWorkloadTarget(context);
    return {
      ruleId: this.ruleId,
      title: this.title,
      rootCause: `Container '${facts.container}' was terminated due to memory limit exhaustion (OOMKilled, exit code 137).`,
      confidence: facts.confidence,
      details: buildOomDetails(facts),
      suggestedFix: 'Increase container memory request and limit in workload specification.',
      commandToRun: `kubectl set resources ${target} --limits=memory=512Mi --requests=memory=256Mi${ns}`,
    };
  }
}

/**
 * Diagnoses containers repeatedly crashing upon startup.
 */
export class CrashLoopRule implements DiagnosticRule {
  readonly ruleId = 'rule.kubernetes.crashloop_backoff';
  readonly title = 'Container CrashLoopBackOff';

  evaluate(failureText: string, context?: WorkloadContext): RuleMatch | null {
    const isCrashLoop = /crashloopbackoff|back-off restarting failed container/i.test(failureText);
    const exitMatch = failureText.match(/exit\s*code\s*[:=]?\s*(\d+)/i);
    const restartMatch = failureText.match(/restart\s*count\s*[:=]?\s*(\d+)/i);

    if (!isCrashLoop && !restartMatch && !exitMatch) return null;
    const exitCode = exitMatch?.[1];
    if (!isCrashLoop && exitCode === '0') return null;

    const container = extractContainerName(failureText, context?.container);
    const details: string[] = [
      `Container '${container}' repeatedly crashing on startup (CrashLoopBackOff)`,
    ];

    if (exitCode) details.push(`Exit code ${exitCode} detected`);
    if (restartMatch?.[1]) details.push(`Restart count: ${restartMatch[1]}`);

    const confidence = isCrashLoop ? 1.0 : 0.9;
    details.push(`Confidence: ${Math.round(confidence * 100)}%`);

    const podName = context?.name || 'pod';
    const ns = context?.namespace ? ` -n ${context.namespace}` : '';

    return {
      ruleId: this.ruleId,
      title: this.title,
      rootCause: `Container '${container}' is in CrashLoopBackOff due to persistent application startup failures.`,
      confidence,
      details,
      suggestedFix: 'Inspect previous application logs and runtime entrypoint configuration.',
      commandToRun: `kubectl logs ${podName} -c ${container}${ns} --previous`,
    };
  }
}

/**
 * Diagnoses container startup stalls caused by failed image pulls.
 */
export class ImagePullRule implements DiagnosticRule {
  readonly ruleId = 'rule.kubernetes.image_pull';
  readonly title = 'Container Image Pull Failure (ImagePullBackOff)';

  evaluate(failureText: string, context?: WorkloadContext): RuleMatch | null {
    const isImagePull = /imagepullbackoff|errimagepull|failed to pull image/i.test(failureText);
    if (!isImagePull) return null;

    const container = extractContainerName(failureText, context?.container);
    const imageMatch = failureText.match(/image\s+["']?([^\s"':]+(?::[^\s"']+)?)["']?/i);
    const image = imageMatch?.[1];

    const details: string[] = [
      `Failed to pull container image${image ? ` '${image}'` : ''} for container '${container}'`,
      'Verify image repository, tag, and imagePullSecrets',
      'Confidence: 100%',
    ];

    const podName = context?.name || 'pod';
    const ns = context?.namespace ? ` -n ${context.namespace}` : '';

    return {
      ruleId: this.ruleId,
      title: this.title,
      rootCause: `Container '${container}' failed to pull container image${image ? ` '${image}'` : ''}.`,
      confidence: 1.0,
      details,
      suggestedFix: 'Verify the container image name, tag, and imagePullSecret permissions in the cluster.',
      commandToRun: `kubectl describe pod ${podName}${ns}`,
    };
  }
}

/**
 * Diagnoses container health probe check failures.
 */
export class ProbeFailureRule implements DiagnosticRule {
  readonly ruleId = 'rule.kubernetes.probe_failure';
  readonly title = 'Container Probe Failure';

  evaluate(failureText: string, context?: WorkloadContext): RuleMatch | null {
    const probeMatch = failureText.match(/\b(liveness|readiness|startup)\s+probe\s+failed/i);
    if (!probeMatch) return null;

    const rawType = probeMatch[1];
    const probeType = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
    const container = extractContainerName(failureText, context?.container);

    const details: string[] = [
      `${probeType} probe failed for container '${container}'`,
      'Health check endpoint did not respond successfully within the configured timeout',
      'Confidence: 100%',
    ];

    const podName = context?.name || 'pod';
    const ns = context?.namespace ? ` -n ${context.namespace}` : '';

    return {
      ruleId: this.ruleId,
      title: `Container ${probeType} Probe Failure`,
      rootCause: `Container '${container}' ${probeType.toLowerCase()} probe failed.`,
      confidence: 1.0,
      details,
      suggestedFix: 'Adjust probe initialDelaySeconds, periodSeconds, or check endpoint responsiveness.',
      commandToRun: `kubectl describe pod ${podName}${ns}`,
    };
  }
}

/**
 * Diagnoses pod scheduling failures where pods remain stuck in Pending.
 */
export class SchedulingRule implements DiagnosticRule {
  readonly ruleId = 'rule.kubernetes.failed_scheduling';
  readonly title = 'Pod Scheduling Failure (FailedScheduling)';

  evaluate(failureText: string, context?: WorkloadContext): RuleMatch | null {
    const isScheduling =
      /failedscheduling|0\/\d+\s+nodes\s+available|insufficient\s+(cpu|memory)|untolerated\s+taint/i.test(
        failureText
      );
    if (!isScheduling) return null;

    const details: string[] = [
      'Pod cannot be scheduled onto any cluster node (FailedScheduling)',
      'Insufficient node CPU/memory capacity or untolerated node taints detected',
      'Confidence: 100%',
    ];

    const podName = context?.name || 'pod';
    const ns = context?.namespace ? ` -n ${context.namespace}` : '';

    return {
      ruleId: this.ruleId,
      title: this.title,
      rootCause: `Pod '${podName}' cannot be scheduled due to cluster resource exhaustion or node taints.`,
      confidence: 1.0,
      details,
      suggestedFix: 'Inspect cluster node capacity, taints, and workload resource requests.',
      commandToRun: `kubectl describe pod ${podName}${ns}`,
    };
  }
}
