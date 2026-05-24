import Conf from 'conf';

interface KDMConfig {
  notification_service?: 'discord' | 'email' | 'none';
  discord_webhook?: string;
  email_host?: string;
  email_port?: number;
  email_user?: string;
  email_to?: string;
  email_password?: string;
  alert_cooldown?: number; // in seconds
}

const config = new Conf<KDMConfig>({
  projectName: 'kdm-cli',
});

export const getConfig = () => config.store;
export const setConfig = (key: keyof KDMConfig, value: any) => config.set(key, value);
export const deleteConfig = (key: keyof KDMConfig) => config.delete(key);
export const clearConfig = () => config.clear();

export const clearNotificationCredentials = () => {
  config.delete('discord_webhook');
  config.delete('email_host');
  config.delete('email_port');
  config.delete('email_user');
  config.delete('email_to');
  config.delete('email_password');
};

// Helper for sensitive data - always use environment variables
export const getSMTPSettings = () => {
  return {
    host: config.get('email_host'),
    port: config.get('email_port') || 587,
    auth: {
      user: config.get('email_user'),
      pass: process.env.KDM_SMTP_PASSWORD || config.get('email_password'),
    },
    to: config.get('email_to'),
  };
};
