export interface KDMConfig {
  ai?: AIConfig;
  activeFilters?: string[];
  kubernetes?: KubernetesConfig;
  cache?: CacheConfig;
  output?: OutputConfig;
  notifications?: NotificationConfig;
}

export interface AIConfig {
  providers: AIProviderConfig[];
  defaultProvider?: string;
}

export interface AIProviderConfig {
  name: string;
  model: string;
  password?: string;
  baseUrl?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  customHeaders?: Record<string, string>;
}

export interface KubernetesConfig {
  kubeconfig?: string;
  kubecontext?: string;
  namespace?: string;
}

export interface CacheConfig {
  type: 'file' | 'memory' | 's3' | 'gcs' | 'azure';
  enabled: boolean;
  path?: string;
  bucket?: string;
  region?: string;
}

export interface OutputConfig {
  format: 'text' | 'json';
  language: string;
}

export interface NotificationConfig {
  service: 'discord' | 'email' | 'none';
  discordWebhook?: string;
  emailHost?: string;
  emailPort?: number;
  emailUser?: string;
  emailTo?: string;
  emailPassword?: string;
  alertCooldown?: number;
}

export type LegacyNotificationConfig = {
  notification_service?: 'discord' | 'email' | 'none';
  discord_webhook?: string;
  email_host?: string;
  email_port?: number;
  email_user?: string;
  email_to?: string;
  email_password?: string;
  alert_cooldown?: number;
};
export type StoredKDMConfig = KDMConfig & LegacyNotificationConfig;

export const defaultKDMConfig: Required<Pick<KDMConfig, 'activeFilters' | 'cache' | 'output'>> = {
  activeFilters: [],
  cache: {
    type: 'file',
    enabled: true,
  },
  output: {
    format: 'text',
    language: 'english',
  },
};
