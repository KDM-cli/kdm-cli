import type * as k8s from '@kubernetes/client-node';
import type { Analyzer, AnalyzerContext, AnalyzerResult, Failure } from './types';
import { listPersistentVolumeClaims } from '../kubernetes/resources';

const pvcName = (pvc: k8s.V1PersistentVolumeClaim) => pvc.metadata?.name ?? 'unknown-pvc';
const pvcNamespace = (pvc: k8s.V1PersistentVolumeClaim) => pvc.metadata?.namespace ?? 'default';

const getPvcFailures = (pvc: k8s.V1PersistentVolumeClaim): Failure[] => {
  const failures: Failure[] = [];
  const phase = pvc.status?.phase;

  if (phase === 'Pending') {
    if (!pvc.spec?.storageClassName) {
      failures.push({ text: 'PersistentVolumeClaim is pending without a storage class' });
    } else {
      failures.push({ text: 'PersistentVolumeClaim is Pending' });
    }
  }

  if (phase === 'Lost') {
    failures.push({ text: 'PersistentVolumeClaim is Lost' });
  }

  for (const condition of pvc.status?.conditions ?? []) {
    if (condition.message) {
      failures.push({
        text: `PersistentVolumeClaim condition ${condition.type} is ${condition.status}${condition.reason ? ` (${condition.reason})` : ''}: ${condition.message}`,
      });
    }
  }

  return failures;
};

export const PersistentVolumeClaimAnalyzer: Analyzer = {
  name: 'PersistentVolumeClaim',
  async analyze(context: AnalyzerContext): Promise<AnalyzerResult[]> {
    const pvcs = await listPersistentVolumeClaims(context);
    return pvcs.flatMap((pvc) => {
      const errors = getPvcFailures(pvc);
      if (!errors.length) return [];
      return [{
        kind: 'PersistentVolumeClaim',
        name: pvcName(pvc),
        namespace: pvcNamespace(pvc),
        errors,
      }];
    });
  },
};

