import {
  clearConfig as clearStoredConfig,
  deleteLegacyValue,
  getLegacyConfig,
  getLegacyValue,
  setLegacyValue,
} from '../config/store';
import type { LegacyNotificationConfig } from '../config/schema';

export const getConfig = () => getLegacyConfig();

type SensitiveLegacyKey = 'email_password';

const sensitiveLegacyKeys = new Set<keyof LegacyNotificationConfig>(['email_password']);

export const setConfig = <Key extends Exclude<keyof LegacyNotificationConfig, SensitiveLegacyKey>>(
  key: Key,
  value: LegacyNotificationConfig[Key],
) => {
  if (sensitiveLegacyKeys.has(key)) {
    throw new Error(`${key} must not be stored in config. Use the KDM_SMTP_PASSWORD environment variable instead.`);
  }
  setLegacyValue(key, value);
};

export const deleteConfig = (key: keyof LegacyNotificationConfig) => deleteLegacyValue(key);
export const clearConfig = () => clearStoredConfig();

export const clearNotificationCredentials = () => {
  deleteLegacyValue('discord_webhook');
  deleteLegacyValue('email_host');
  deleteLegacyValue('email_port');
  deleteLegacyValue('email_user');
  deleteLegacyValue('email_to');
  deleteLegacyValue('email_password');
};

// Helper for sensitive data - always use environment variables
export const getSMTPSettings = () => {
  return {
    host: getLegacyValue('email_host'),
    port: getLegacyValue('email_port') || 587,
    auth: {
      user: getLegacyValue('email_user'),
      // SMTP password must come from KDM_SMTP_PASSWORD env var only.
      pass: process.env.KDM_SMTP_PASSWORD,
    },
    to: getLegacyValue('email_to'),
  };
};
