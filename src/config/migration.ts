import type { KDMConfig, LegacyNotificationConfig, NotificationConfig, StoredKDMConfig } from './schema';

const isNotificationService = (value: unknown): value is NotificationConfig['service'] =>
  value === 'discord' || value === 'email' || value === 'none';

const stringOrUndefined = (value: unknown) => (typeof value === 'string' ? value : undefined);
const numberOrUndefined = (value: unknown) => (typeof value === 'number' ? value : undefined);

const hasLegacyNotificationConfig = (config: LegacyNotificationConfig) =>
  config.notification_service !== undefined ||
  config.discord_webhook !== undefined ||
  config.email_host !== undefined ||
  config.email_port !== undefined ||
  config.email_user !== undefined ||
  config.email_to !== undefined ||
  config.email_password !== undefined ||
  config.alert_cooldown !== undefined;

export const notificationFromLegacy = (
  legacy: LegacyNotificationConfig,
): NotificationConfig | undefined => {
  if (!hasLegacyNotificationConfig(legacy)) {
    return undefined;
  }

  return {
    service: isNotificationService(legacy.notification_service) ? legacy.notification_service : 'none',
    discordWebhook: stringOrUndefined(legacy.discord_webhook),
    emailHost: stringOrUndefined(legacy.email_host),
    emailPort: numberOrUndefined(legacy.email_port),
    emailUser: stringOrUndefined(legacy.email_user),
    emailTo: stringOrUndefined(legacy.email_to),
    emailPassword: stringOrUndefined(legacy.email_password),
    alertCooldown: numberOrUndefined(legacy.alert_cooldown),
  };
};
export const mergeLegacyConfig = (stored: StoredKDMConfig): KDMConfig => {
  const legacyNotifications = notificationFromLegacy(stored);

  return {
    ai: stored.ai,
    activeFilters: stored.activeFilters,
    kubernetes: stored.kubernetes,
    cache: stored.cache,
    output: stored.output,
    notifications: {
      ...legacyNotifications,
      ...stored.notifications,
    },
  };
};
