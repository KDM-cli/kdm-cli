import { Analyzer } from './types';
import { PodAnalyzer } from './pod';
import { DeploymentAnalyzer } from './deployment';
import { ServiceAnalyzer } from './service';
import { PersistentVolumeClaimAnalyzer } from './pvc';
import { NodeAnalyzer } from './node';
import { ReplicaSetAnalyzer } from './replicaset';
import { StatefulSetAnalyzer } from './statefulset';
import { DaemonSetAnalyzer } from './daemonset';
import { JobAnalyzer } from './job';
import { CronJobAnalyzer } from './cronjob';
import { IngressAnalyzer } from './ingress';
import { ConfigMapAnalyzer } from './configmap';
import { HPAAnalyzer } from './hpa';
import { PDBAnalyzer } from './pdb';
import { NetworkPolicyAnalyzer } from './networkpolicy';
import { EventsAnalyzer } from './events';
import { LogAnalyzer } from './log-analyzer';
import { SecurityAnalyzer } from './security';
import { StorageAnalyzer } from './storage';
import { GatewayClassAnalyzer } from './gatewayclass';
import { GatewayAnalyzer } from './gateway';
import { HTTPRouteAnalyzer } from './httproute';

class AnalyzerRegistry {
  private analyzers = new Map<string, Analyzer>();

  register(analyzer: Analyzer): void {
    this.analyzers.set(analyzer.name, analyzer);
  }

  get(name: string): Analyzer | undefined {
    return this.analyzers.get(name);
  }

  list(): Analyzer[] {
    return Array.from(this.analyzers.values());
  }

  has(name: string): boolean {
    return this.analyzers.has(name);
  }

  unregister(name: string): boolean {
    return this.analyzers.delete(name);
  }

  clear(): void {
    this.analyzers.clear();
  }
}

export const registry = new AnalyzerRegistry();

// Register core analyzers (Phase 2)
registry.register(PodAnalyzer);
registry.register(DeploymentAnalyzer);
registry.register(ServiceAnalyzer);
registry.register(PersistentVolumeClaimAnalyzer);
registry.register(NodeAnalyzer);

// Register expanded analyzers (Phase 8)
registry.register(ReplicaSetAnalyzer);
registry.register(StatefulSetAnalyzer);
registry.register(DaemonSetAnalyzer);
registry.register(JobAnalyzer);
registry.register(CronJobAnalyzer);
registry.register(IngressAnalyzer);
registry.register(ConfigMapAnalyzer);
registry.register(HPAAnalyzer);
registry.register(PDBAnalyzer);
registry.register(NetworkPolicyAnalyzer);
registry.register(EventsAnalyzer);
registry.register(LogAnalyzer);
registry.register(SecurityAnalyzer);
registry.register(StorageAnalyzer);
registry.register(GatewayClassAnalyzer);
registry.register(GatewayAnalyzer);
registry.register(HTTPRouteAnalyzer);

export {
  PodAnalyzer,
  DeploymentAnalyzer,
  ServiceAnalyzer,
  PersistentVolumeClaimAnalyzer,
  NodeAnalyzer,
  ReplicaSetAnalyzer,
  StatefulSetAnalyzer,
  DaemonSetAnalyzer,
  JobAnalyzer,
  CronJobAnalyzer,
  IngressAnalyzer,
  ConfigMapAnalyzer,
  HPAAnalyzer,
  PDBAnalyzer,
  NetworkPolicyAnalyzer,
  EventsAnalyzer,
  LogAnalyzer,
  SecurityAnalyzer,
  StorageAnalyzer,
  GatewayClassAnalyzer,
  GatewayAnalyzer,
  HTTPRouteAnalyzer,
};
