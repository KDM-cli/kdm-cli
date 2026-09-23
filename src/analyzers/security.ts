import type * as k8s from '@kubernetes/client-node';
import type { Analyzer, AnalyzerContext, AnalyzerResult, Failure } from './types';
import { listPods } from '../kubernetes/resources';

/**
 * Checks if a container runs as root (runAsNonRoot is not set).
 * @param container The container spec.
 * @param podSecCtx The pod-level security context.
 * @returns Array of failures found.
 */
const checkRunAsRoot = (
  container: k8s.V1Container,
  podSecCtx: k8s.V1PodSecurityContext | undefined,
): Failure[] => {
  const containerCtx = container.securityContext;
  const runAsNonRoot = containerCtx?.runAsNonRoot ?? podSecCtx?.runAsNonRoot;
  if (runAsNonRoot !== true) {
    return [{ text: `Container ${container.name} may run as root (runAsNonRoot not set)` }];
  }
  return [];
};

/**
 * Checks if a container runs in privileged mode.
 * @param container The container spec.
 * @returns Array of failures found.
 */
const checkPrivileged = (container: k8s.V1Container): Failure[] => {
  if (container.securityContext?.privileged) {
    return [{ text: `Container ${container.name} is running in privileged mode` }];
  }
  return [];
};

/**
 * Checks if a container has a read-only root filesystem.
 * @param container The container spec.
 * @returns Array of failures found.
 */
const checkReadOnlyRootFS = (container: k8s.V1Container): Failure[] => {
  if (!container.securityContext?.readOnlyRootFilesystem) {
    return [{ text: `Container ${container.name} does not have a read-only root filesystem` }];
  }
  return [];
};

/**
 * Analyzer implementation focused on Pod security best practices.
 * Checks containers for root user, privileged mode, and read-only filesystem.
 */
export const SecurityAnalyzer: Analyzer = {
  name: 'Security',
  async analyze(context: AnalyzerContext): Promise<AnalyzerResult[]> {
    const pods = await listPods(context);
    return pods.flatMap((pod) => {
      const podSecCtx = pod.spec?.securityContext;
      const allErrors: Failure[] = [];
      const allContainers = [
        ...(pod.spec?.containers ?? []),
        ...(pod.spec?.initContainers ?? []),
      ];
      for (const container of allContainers) {
        allErrors.push(
          ...checkRunAsRoot(container, podSecCtx),
          ...checkPrivileged(container),
          ...checkReadOnlyRootFS(container),
        );
      }
      if (!allErrors.length) return [];
      return [{
        kind: 'Security',
        name: pod.metadata?.name ?? 'unknown-pod',
        namespace: pod.metadata?.namespace ?? 'default',
        errors: allErrors,
      }];
    });
  },
};
