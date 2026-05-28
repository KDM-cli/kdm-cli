import { describe, expect, it } from 'vitest';
import { mergeLegacyConfig, notificationFromLegacy } from '../config/migration';

describe('config migration', () => {
  it('returns undefined for empty legacy input', () => {
    expect(notificationFromLegacy({})).toBeUndefined();
  });

  it('converts legacy notification keys into the new notification shape', () => {
    const notifications = notificationFromLegacy({
      notification_service: 'email',
      discord_webhook: 'https://discord.com/api/webhooks/123/token',
      email_host: 'smtp.test.com',
      email_port: 587,
      email_user: 'user@test.com',
      email_to: 'to@test.com',
      email_password: 'secret',
      alert_cooldown: 120,
    });

    expect(notifications).toEqual({
      service: 'email',
      discordWebhook: 'https://discord.com/api/webhooks/123/token',
      emailHost: 'smtp.test.com',
      emailPort: 587,
      emailUser: 'user@test.com',
      emailTo: 'to@test.com',
      emailPassword: 'secret',
      alertCooldown: 120,
    });
  });

  it('prefers explicit new notification config over migrated legacy values', () => {
    const config = mergeLegacyConfig({
      notification_service: 'discord',
      discord_webhook: 'legacy-webhook',
      notifications: {
        service: 'email',
        discordWebhook: 'new-webhook',
      },
    });

    expect(config.notifications).toMatchObject({
      service: 'email',
      discordWebhook: 'new-webhook',
    });
  });

  it('ignores malformed legacy notification values', () => {
    const notifications = notificationFromLegacy({
      notification_service: { invalid: 'object' } as never,
      email_port: 'not-a-number' as never,
      alert_cooldown: 'not-a-number' as never,
    });

    expect(notifications).toEqual({
      service: 'none',
      emailPort: undefined,
      alertCooldown: undefined,
      discordWebhook: undefined,
      emailHost: undefined,
      emailUser: undefined,
      emailTo: undefined,
      emailPassword: undefined,
    });
  });

  it('mergeLegacyConfig falls back safely with malformed legacy fields', () => {
    const config = mergeLegacyConfig({
      notification_service: 42 as never,
      discord_webhook: 123 as never,
      email_port: 'not-a-number' as never,
    });

    expect(config.notifications).toBeDefined();
    expect(config.notifications!.service).toBe('none');
    expect(config.notifications!.discordWebhook).toBeUndefined();
    expect(config.notifications!.emailPort).toBeUndefined();
  });

  it('mergeLegacyConfig returns undefined notifications when no config sources exist', () => {
    const config = mergeLegacyConfig({});

    expect(config.notifications).toBeUndefined();
  });
});
