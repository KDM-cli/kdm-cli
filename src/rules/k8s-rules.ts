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

interface RuleContextOptions {
  text: string;
  context?: WorkloadContext;
}

interface ContainerResolveOptions {
  text: string;
  fallback?: string;
}

interface CrashValidationOptions {
  isLoop: boolean;
  exitCode?: string;
  restartCount?: string;
}

function extractPatternCapture(text: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(text);
  return match ? match[1] : undefined;
}

function resolveContainerName(opts: ContainerResolveOptions): string {
  const match = opts.text.match(/container\s+["']?([a-zA-Z0-9_.\-]+)["']?/i);
  if (match) return match[1];
  if (opts.fallback) return opts.fallback;
  return 'container';
}

function buildTarget(context?: WorkloadContext, fallbackName = 'pod'): { target: string; ns: string } {
  const name = context?.name || fallbackName;
  const ns = context?.namespace ? ` -n ${context.namespace}` : '';
  return { target: name, ns };
}

// ─── OOMKilled Rule ──────────────────────────────────────────────────────────

interface OomFacts {
  container: string;
  hasExit137: boolean;
  hasOomMention: boolean;
  memLimit?: string;
  confidence: number;
}

const OOM_EXIT_PATTERN = /\b137\b|exit\s*code\s*[:=]?\s*137/i;
const OOM_MENTION_PATTERN = /oomkilled|out[\s_-]?of[\s_-]?memory/i;
const OOM_TRIGGER_PATTERN = /\b137\b|oomkilled|out[\s_-]?of[\s_-]?memory|memory\s*limit/i;
const OOM_LIMIT_PATTERN = /memory\s*limit[:\s]*([0-9]+[a-zA-Z]+)/i;

function detectOomFacts(opts: RuleContextOptions): OomFacts | null {
  if (!OOM_TRIGGER_PATTERN.test(opts.text)) {
    return null;
  }

  const hasExit137 = OOM_EXIT_PATTERN.test(opts.text);
  const hasOomMention = OOM_MENTION_PATTERN.test(opts.text);
  const memLimit = extractPatternCapture(opts.text, OOM_LIMIT_PATTERN);

  const isConfirmed = hasOomMention || (hasExit137 && Boolean(memLimit));
  const confidence = isConfirmed ? 1.0 : 0.8;
  const container = resolveContainerName({ text: opts.text, fallback: opts.context?.container });

  return { container, hasExit137, hasOomMention, memLimit, confidence };
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

export class OOMKilledRule implements DiagnosticRule {
  readonly ruleId = 'rule.kubernetes.oom_killed';
  readonly title = 'Container Out-Of-Memory (OOMKilled)';

  evaluate(failureText: string, context?: WorkloadContext): RuleMatch | null {
    const facts = detectOomFacts({ text: failureText, context });
    if (!facts) return null;

    const kind = (context?.kind || 'deployment').toLowerCase();
    const { target, ns } = buildTarget(context, 'workload');

    return {
      ruleId: this.ruleId,
      title: this.title,
      rootCause: `Container '${facts.container}' was terminated due to memory limit exhaustion (OOMKilled, exit code 137).`,
      confidence: facts.confidence,
      details: buildOomDetails(facts),
      suggestedFix: 'Increase container memory request and limit in workload specification.',
      commandToRun: `kubectl set resources ${kind}/${target} --limits=memory=512Mi --requests=memory=256Mi${ns}`,
    };
  }
}

// ─── CrashLoop Rule ──────────────────────────────────────────────────────────

interface CrashFacts {
  container: string;
  exitCode?: string;
  restartCount?: string;
  confidence: number;
}

const CRASH_TRIGGER_PATTERN = /crashloopbackoff|back-off restarting failed container/i;
const EXIT_CODE_PATTERN = /exit\s*code\s*[:=]?\s*(\d+)/i;
const RESTART_COUNT_PATTERN = /restart\s*count\s*[:=]?\s*(\d+)/i;

function isLegitimateCrash(opts: CrashValidationOptions): boolean {
  if (opts.isLoop) return true;
  if (opts.exitCode === '0') return false;
  return Boolean(opts.exitCode || opts.restartCount);
}

function detectCrashFacts(opts: RuleContextOptions): CrashFacts | null {
  const isLoop = CRASH_TRIGGER_PATTERN.test(opts.text);
  const exitCode = extractPatternCapture(opts.text, EXIT_CODE_PATTERN);
  const restartCount = extractPatternCapture(opts.text, RESTART_COUNT_PATTERN);

  if (!isLegitimateCrash({ isLoop, exitCode, restartCount })) {
    return null;
  }

  const container = resolveContainerName({ text: opts.text, fallback: opts.context?.container });
  const confidence = isLoop ? 1.0 : 0.9;

  return { container, exitCode, restartCount, confidence };
}

function buildCrashDetails(facts: CrashFacts): string[] {
  const details = [
    `Container '${facts.container}' repeatedly crashing on startup (CrashLoopBackOff)`,
  ];
  if (facts.exitCode) {
    details.push(`Exit code ${facts.exitCode} detected`);
  }
  if (facts.restartCount) {
    details.push(`Restart count: ${facts.restartCount}`);
  }
  details.push(`Confidence: ${Math.round(facts.confidence * 100)}%`);
  return details;
}

export class CrashLoopRule implements DiagnosticRule {
  readonly ruleId = 'rule.kubernetes.crashloop_backoff';
  readonly title = 'Container CrashLoopBackOff';

  evaluate(failureText: string, context?: WorkloadContext): RuleMatch | null {
    const facts = detectCrashFacts({ text: failureText, context });
    if (!facts) return null;

    const { target, ns } = buildTarget(context, 'pod');
    return {
      ruleId: this.ruleId,
      title: this.title,
      rootCause: `Container '${facts.container}' is in CrashLoopBackOff due to persistent application startup failures.`,
      confidence: facts.confidence,
      details: buildCrashDetails(facts),
      suggestedFix: 'Inspect previous application logs and runtime entrypoint configuration.',
      commandToRun: `kubectl logs ${target} -c ${facts.container}${ns} --previous`,
    };
  }
}

// ─── ImagePull Rule ──────────────────────────────────────────────────────────

const IMAGE_PULL_TRIGGER = /imagepullbackoff|errimagepull|failed to pull image/i;
const IMAGE_PATTERN = /image\s+["']?([^\s"':]+(?::[^\s"']+)?)["']?/i;

export class ImagePullRule implements DiagnosticRule {
  readonly ruleId = 'rule.kubernetes.image_pull';
  readonly title = 'Container Image Pull Failure (ImagePullBackOff)';

  evaluate(failureText: string, context?: WorkloadContext): RuleMatch | null {
    if (!IMAGE_PULL_TRIGGER.test(failureText)) return null;

    const container = resolveContainerName({ text: failureText, fallback: context?.container });
    const image = extractPatternCapture(failureText, IMAGE_PATTERN);
    const imageSuffix = image ? ` '${image}'` : '';

    const details: string[] = [
      `Failed to pull container image${imageSuffix} for container '${container}'`,
      'Verify image repository, tag, and imagePullSecrets',
      'Confidence: 100%',
    ];

    const { target, ns } = buildTarget(context, 'pod');
    return {
      ruleId: this.ruleId,
      title: this.title,
      rootCause: `Container '${container}' failed to pull container image${imageSuffix}.`,
      confidence: 1.0,
      details,
      suggestedFix: 'Verify the container image name, tag, and imagePullSecret permissions in the cluster.',
      commandToRun: `kubectl describe pod ${target}${ns}`,
    };
  }
}

// ─── ProbeFailure Rule ───────────────────────────────────────────────────────

const PROBE_PATTERN = /\b(liveness|readiness|startup)\s+probe\s+failed/i;

export class ProbeFailureRule implements DiagnosticRule {
  readonly ruleId = 'rule.kubernetes.probe_failure';
  readonly title = 'Container Probe Failure';

  evaluate(failureText: string, context?: WorkloadContext): RuleMatch | null {
    const rawType = extractPatternCapture(failureText, PROBE_PATTERN);
    if (!rawType) return null;

    const probeType = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
    const container = resolveContainerName({ text: failureText, fallback: context?.container });

    const details: string[] = [
      `${probeType} probe failed for container '${container}'`,
      'Health check endpoint did not respond successfully within the configured timeout',
      'Confidence: 100%',
    ];

    const { target, ns } = buildTarget(context, 'pod');
    return {
      ruleId: this.ruleId,
      title: `Container ${probeType} Probe Failure`,
      rootCause: `Container '${container}' ${probeType.toLowerCase()} probe failed.`,
      confidence: 1.0,
      details,
      suggestedFix: 'Adjust probe initialDelaySeconds, periodSeconds, or check endpoint responsiveness.',
      commandToRun: `kubectl describe pod ${target}${ns}`,
    };
  }
}

// ─── Scheduling Rule ─────────────────────────────────────────────────────────

const SCHEDULING_PATTERN =
  /failedscheduling|0\/\d+\s+nodes\s+available|insufficient\s+(cpu|memory)|untolerated\s+taint/i;

export class SchedulingRule implements DiagnosticRule {
  readonly ruleId = 'rule.kubernetes.failed_scheduling';
  readonly title = 'Pod Scheduling Failure (FailedScheduling)';

  evaluate(failureText: string, context?: WorkloadContext): RuleMatch | null {
    if (!SCHEDULING_PATTERN.test(failureText)) return null;

    const details: string[] = [
      'Pod cannot be scheduled onto any cluster node (FailedScheduling)',
      'Insufficient node CPU/memory capacity or untolerated node taints detected',
      'Confidence: 100%',
    ];

    const { target, ns } = buildTarget(context, 'pod');
    return {
      ruleId: this.ruleId,
      title: this.title,
      rootCause: `Pod '${target}' cannot be scheduled due to cluster resource exhaustion or node taints.`,
      confidence: 1.0,
      details,
      suggestedFix: 'Inspect cluster node capacity, taints, and workload resource requests.',
      commandToRun: `kubectl describe pod ${target}${ns}`,
    };
  }
}
