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
  private builtInAnalyzers = new Set<string>();

  register(analyzer: Analyzer): void {
    this.analyzers.set(analyzer.name, analyzer);
  }

  registerBuiltIn(analyzer: Analyzer): void {
    this.register(analyzer);
    this.builtInAnalyzers.add(analyzer.name);
  }

  isBuiltIn(name: string): boolean {
    return this.builtInAnalyzers.has(name);
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
    if (this.isBuiltIn(name)) return false;
    return this.analyzers.delete(name);
  }

  clear(): void {
    this.analyzers.clear();
  }
}

export const registry = new AnalyzerRegistry();

// Register core analyzers (Phase 2)
registry.registerBuiltIn(PodAnalyzer);
registry.registerBuiltIn(DeploymentAnalyzer);
registry.registerBuiltIn(ServiceAnalyzer);
registry.registerBuiltIn(PersistentVolumeClaimAnalyzer);
registry.registerBuiltIn(NodeAnalyzer);

// Register expanded analyzers (Phase 8)
registry.registerBuiltIn(ReplicaSetAnalyzer);
registry.registerBuiltIn(StatefulSetAnalyzer);
registry.registerBuiltIn(DaemonSetAnalyzer);
registry.registerBuiltIn(JobAnalyzer);
registry.registerBuiltIn(CronJobAnalyzer);
registry.registerBuiltIn(IngressAnalyzer);
registry.registerBuiltIn(ConfigMapAnalyzer);
registry.registerBuiltIn(HPAAnalyzer);
registry.registerBuiltIn(PDBAnalyzer);
registry.registerBuiltIn(NetworkPolicyAnalyzer);
registry.registerBuiltIn(EventsAnalyzer);
registry.registerBuiltIn(LogAnalyzer);
registry.registerBuiltIn(SecurityAnalyzer);
registry.registerBuiltIn(StorageAnalyzer);
registry.registerBuiltIn(GatewayClassAnalyzer);
registry.registerBuiltIn(GatewayAnalyzer);
registry.registerBuiltIn(HTTPRouteAnalyzer);

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
