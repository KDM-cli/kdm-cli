import type * as k8s from '@kubernetes/client-node';
import type { Analyzer, AnalyzerContext, AnalyzerResult, Failure } from './types';
import { listPods } from '../kubernetes/resources';

const RESTART_WARNING_THRESHOLD = 3;
const WAITING_FAILURE_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerConfigError',
]);

/**
 * Resolves the name of the Pod resource, defaulting to 'unknown-pod' if missing.
 * @param pod The Pod object.
 */
const podName = (pod: k8s.V1Pod) => pod.metadata?.name ?? 'unknown-pod';

/**
 * Resolves the namespace of the Pod resource, defaulting to 'default' if missing.
 * @param pod The Pod object.
 */
const podNamespace = (pod: k8s.V1Pod) => pod.metadata?.namespace ?? 'default';

/**
 * Validates the Pod's overall phase, flagging it as a failure if phase is Failed.
 * @param pod The Pod object to validate.
 * @returns Array of failures found.
 */
const checkPodPhase = (pod: k8s.V1Pod): Failure[] => {
  if (pod.status?.phase === 'Failed') {
    return [{ text: `Pod phase is Failed${pod.status?.reason ? `: ${pod.status.reason}` : ''}` }];
  }
  return [];
};

/**
 * Checks for scheduling bottlenecks in Pending pods by inspecting the PodScheduled condition.
 * @param pod The Pod object.
 * @returns Failures relating to scheduling issues.
 */
const checkPodScheduling = (pod: k8s.V1Pod): Failure[] => {
  if (pod.status?.phase !== 'Pending') return [];
  const scheduled = pod.status?.conditions?.find((condition) => condition.type === 'PodScheduled');
  if (scheduled?.status === 'False') {
    return [{
      text: `Pod is pending and unschedulable${scheduled.reason ? `: ${scheduled.reason}` : ''}${scheduled.message ? ` - ${scheduled.message}` : ''}`,
    }];
  }
  return [];
};

/**
 * Validates the state of a single container status, checking for waiting failures,
 * readiness, and restart count threshold breaches.
 * @param status The container status object.
 * @returns Array of failures found.
 */
const checkSingleContainerState = (status: k8s.V1ContainerStatus): Failure[] => {
  const failures: Failure[] = [];
  const waiting = status.state?.waiting;
  if (waiting?.reason && WAITING_FAILURE_REASONS.has(waiting.reason)) {
    failures.push({
      text: `Container ${status.name} is waiting in ${waiting.reason}${waiting.message ? `: ${waiting.message}` : ''}`,
    });
  }

  if (!status.ready && status.state?.terminated?.reason !== 'Completed') {
    failures.push({ text: `Container ${status.name} is not ready` });
  }

  if ((status.restartCount ?? 0) > RESTART_WARNING_THRESHOLD) {
    failures.push({ text: `Container ${status.name} restarted ${status.restartCount} times` });
  }
  return failures;
};

/**
 * Validates states of containers inside a pod, assessing waiting statuses, readiness,
 * and high restart counts.
 * @param pod The Pod object.
 * @returns Array of container validation failures.
 */
const checkContainerStates = (pod: k8s.V1Pod): Failure[] => {
  if (pod.status?.phase === 'Succeeded') return [];
  return [
    ...(pod.status?.initContainerStatuses ?? []),
    ...(pod.status?.containerStatuses ?? []),
  ].flatMap(checkSingleContainerState);
};

/**
 * Aggregates all Pod related validation checks: phase, scheduling, and container states.
 * @param pod The Pod object.
 * @returns Array of aggregated failures.
 */
const getPodFailures = (pod: k8s.V1Pod): Failure[] => [
  ...checkPodPhase(pod),
  ...checkPodScheduling(pod),
  ...checkContainerStates(pod),
];

/**
 * Analyzer implementation focused on Kubernetes Pods.
 */
export const PodAnalyzer: Analyzer = {
  name: 'Pod',
  async analyze(context: AnalyzerContext): Promise<AnalyzerResult[]> {
    const pods = await listPods(context);
    return pods.flatMap((pod) => {
      const errors = getPodFailures(pod);
      if (!errors.length) return [];
      return [{
        kind: 'Pod',
        name: podName(pod),
        namespace: podNamespace(pod),
        errors,
      }];
    });
  },
};
