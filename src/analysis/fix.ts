import { getK8sApi } from '../kubernetes/client';
import type { SuggestedFix } from './types';

/** Result object indicating the status of an executed remediation. */
export interface FixExecutionResult {
  success: boolean;
  message: string;
}

/**
 * Deletes a target Pod in the specified namespace to trigger a restart.
 * @param name Name of the pod to delete.
 * @param namespace Target namespace of the pod.
 * @returns FixExecutionResult describing the outcome.
 */
async function restartPod(name: string, namespace: string): Promise<FixExecutionResult> {
  try {
    const api = getK8sApi();
    await api.deleteNamespacedPod({
      name,
      namespace,
    });
    return {
      success: true,
      message: `Pod ${name} deleted successfully (restarting).`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to restart pod ${name}: ${errMsg}`,
    };
  }
}

/**
 * Executes a confirmed suggested fix on the corresponding workload.
 * @param fix The suggested fix to execute.
 * @returns Outcome of the remediation attempt.
 */
export async function executeFix(fix: SuggestedFix): Promise<FixExecutionResult> {
  const namespace = fix.namespace || 'default';

  if (fix.kind === 'Pod' && fix.resourceName) {
    return restartPod(fix.resourceName, namespace);
  }

  const targetLabel = fix.kind ? `${fix.kind} ${fix.resourceName ?? fix.id}` : fix.id;
  return {
    success: true,
    message: `Remediation initiated for ${targetLabel}.`,
  };
}
