import Conf from 'conf';
import {
  defaultKDMConfig,
  type AIConfig,
  type CacheConfig,
  type KDMConfig,
  type KubernetesConfig,
  type LegacyNotificationConfig,
  type NotificationConfig,
  type OutputConfig,
  type StoredKDMConfig,
} from './schema';
import { mergeLegacyConfig } from './migration';

const config = new Conf<StoredKDMConfig>({
  projectName: 'kdm-cli',
});

const withDefaults = (stored: StoredKDMConfig): KDMConfig => ({
  ...defaultKDMConfig,
  ...mergeLegacyConfig(stored),
  cache: {
    ...defaultKDMConfig.cache,
    ...stored.cache,
  },
  output: {
    ...defaultKDMConfig.output,
    ...stored.output,
  },
  activeFilters: stored.activeFilters ?? defaultKDMConfig.activeFilters,
});

export const getConfig = (): KDMConfig => withDefaults(config.store);

export const updateConfig = (nextConfig: KDMConfig) => {
  Object.entries(nextConfig).forEach(([key, value]) => {
    config.set(key as keyof StoredKDMConfig, value as never);
  });
};

export const setConfigValue = <Key extends keyof KDMConfig>(key: Key, value: KDMConfig[Key]) => {
  config.set(key as keyof StoredKDMConfig, value as never);
};

export const clearConfig = () => config.clear();

export const getAIConfig = (): AIConfig => getConfig().ai ?? { providers: [] };
export const setAIConfig = (ai: AIConfig) => setConfigValue('ai', ai);

export const getActiveFilters = (): string[] => getConfig().activeFilters ?? [];
export const setActiveFilters = (activeFilters: string[]) => setConfigValue('activeFilters', activeFilters);

export const getKubernetesConfig = (): KubernetesConfig => getConfig().kubernetes ?? {};
export const setKubernetesConfig = (kubernetes: KubernetesConfig) =>
  setConfigValue('kubernetes', kubernetes);

export const getCacheConfig = (): CacheConfig => getConfig().cache ?? defaultKDMConfig.cache;
export const setCacheConfig = (cache: CacheConfig) => setConfigValue('cache', cache);

export const getOutputConfig = (): OutputConfig => getConfig().output ?? defaultKDMConfig.output;
export const setOutputConfig = (output: OutputConfig) => setConfigValue('output', output);

export const getNotificationConfig = (): NotificationConfig => ({
  service: 'none',
  ...getConfig().notifications,
});

export const setNotificationConfig = (notifications: NotificationConfig) =>
  setConfigValue('notifications', {
    ...notifications,
    emailPassword: undefined,
  });

export const getLegacyConfig = (): LegacyNotificationConfig => {
  const notifications = getNotificationConfig();
  return {
    notification_service: notifications.service,
    discord_webhook: notifications.discordWebhook,
    email_host: notifications.emailHost,
    email_port: notifications.emailPort,
    email_user: notifications.emailUser,
    email_to: notifications.emailTo,
    // SMTP password must come from KDM_SMTP_PASSWORD env var only.
    email_password: undefined,
    alert_cooldown: notifications.alertCooldown,
  };
};

export const getLegacyValue = <Key extends keyof LegacyNotificationConfig>(
  key: Key,
): LegacyNotificationConfig[Key] => {
  const legacy = getLegacyConfig();
  return legacy[key];
};

export const setLegacyValue = <Key extends keyof LegacyNotificationConfig>(
  key: Key,
  value: LegacyNotificationConfig[Key],
) => {
  config.set(key, value as never);
};

export const deleteLegacyValue = (key: keyof LegacyNotificationConfig) => {
  config.delete(key);
};

export const rawConfigStore = config;
