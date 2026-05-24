import { Command } from 'commander';
import chalk from 'chalk';
import { setConfig, getConfig, clearConfig, clearNotificationCredentials } from '../utils/config';
import { select, input } from '@vr_patel/tui';

export const registerConfigCommand = (program: Command) => {
  const config = program
    .command('config')
    .description('Manage KDM configuration');

  config
    .command('setup')
    .description('Interactively set up notification service')
    .action(async () => {
      try {
        const choice = await select({
          message: 'Select notification service:',
          options: [
            { label: 'Discord', value: 'discord', description: 'Send alerts to a Discord channel via Webhook' },
            { label: 'Email (SMTP)', value: 'email', description: 'Send alerts via Email SMTP' },
            { label: 'None', value: 'none', description: 'Disable notifications' },
          ],
        });

        if (choice === 'none') {
          clearNotificationCredentials();
          setConfig('notification_service', 'none');
          console.log(chalk.green('\n✓ Notifications disabled.'));
          return;
        }

        if (choice === 'discord') {
          printDiscordWebhookGuide();

          const webhook = await input({
            message: 'Discord Webhook URL:',
            validate: (v) => {
              const discordWebhookRegex = /^https:\/\/(?:ptb\.|canary\.)?discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;
              return discordWebhookRegex.test(v) || 'Must be a valid Discord webhook URL (including ID and Token)';
            },
          });
          
          clearNotificationCredentials();
          setConfig('discord_webhook', webhook);
          setConfig('notification_service', 'discord');
          console.log(chalk.green('\n✓ Discord Webhook configured.'));
        } else if (choice === 'email') {
          printEmailSmtpGuide();

          const host = await input({
            message: 'SMTP Host:',
            placeholder: 'smtp.gmail.com',
            validate: (v) => v.length > 0 || 'Host is required',
          });
          const portStr = await input({
            message: 'SMTP Port:',
            defaultValue: '587',
            validate: (v) => {
              const port = parseInt(v, 10);
              return (/^\d+$/.test(v) && port > 0 && port <= 65535) || 'Must be a valid port number (1-65535)';
            },
          });
          const user = await input({
            message: 'SMTP User:',
            validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Must be a valid email address',
          });
          const to = await input({
            message: 'Alert Recipient Email:',
            validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Must be a valid email address',
          });
          const password = await input({
            message: 'SMTP Password (optional, press Enter to skip):',
            validate: () => true,
          });

          clearNotificationCredentials();
          setConfig('email_host', host);
          setConfig('email_port', parseInt(portStr, 10));
          setConfig('email_user', user);
          setConfig('email_to', to);
          if (password) {
            setConfig('email_password', password);
          }
          setConfig('notification_service', 'email');
          
          console.log(chalk.green('\n✓ Email SMTP configured.'));
        }

        console.log(chalk.green(`✓ Notification service set to: ${chalk.bold(choice.toUpperCase())}`));
      } catch (error) {
        console.error(chalk.red(`✗ Set up cancelled or failed: ${(error as Error).message}`));
      }
    });

  config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key, value) => {
      try {
        // Convert value to number if key is alert_cooldown or email_port
        let finalValue = value;
        if (key === 'alert_cooldown' || key === 'email_port') {
          finalValue = parseInt(value, 10);
        }
        
        setConfig(key as any, finalValue);
        console.log(chalk.green(`✓ Set ${key} to ${finalValue}`));
      } catch (error) {
        console.error(chalk.red(`✗ Failed to set config: ${(error as Error).message}`));
      }
    });

  config
    .command('list')
    .description('List current configuration')
    .action(() => {
      const current = getConfig();
      console.log(chalk.bold('\nCurrent KDM Configuration:'));
      console.log(chalk.gray('──────────────────────────────────────────────────'));
      
      if (Object.keys(current).length === 0) {
        console.log(chalk.yellow(' No configuration found. Use "kdm config set <key> <value>"'));
      } else {
        Object.entries(current).forEach(([key, value]) => {
          console.log(` ${chalk.cyan(key.padEnd(20))} : ${chalk.white(value)}`);
        });
      }
      
      console.log(chalk.gray('──────────────────────────────────────────────────'));
      console.log(chalk.dim('\n Note: SMTP password can be set either in config or via the KDM_SMTP_PASSWORD environment variable, which takes precedence if both are set.\n'));
    });

  config
    .command('clear')
    .description('Clear all configuration')
    .action(() => {
      clearConfig();
      console.log(chalk.green('✓ Configuration cleared.'));
    });
};

const printDiscordWebhookGuide = () => {
  console.log(chalk.gray('\n──────────────────────────────────────────────────'));
  console.log(chalk.cyan('Discord webhook setup'));
  console.log(chalk.white('  1. Open your Discord server settings.'));
  console.log(chalk.white('  2. Go to Integrations > Webhooks.'));
  console.log(chalk.white('  3. Create a new webhook and choose the alert channel.'));
  console.log(chalk.white('  4. Copy the webhook URL and paste it below.'));
  console.log(chalk.dim('     The URL should start with https://discord.com/api/webhooks/.'));
  console.log(chalk.gray('──────────────────────────────────────────────────\n'));
};

const printEmailSmtpGuide = () => {
  console.log(chalk.gray('\n──────────────────────────────────────────────────'));
  console.log(chalk.cyan('Email SMTP setup'));
  console.log(chalk.white('  1. Find your provider SMTP settings before continuing.'));
  console.log(chalk.white('  2. Common hosts: smtp.gmail.com for Gmail, smtp.office365.com for Outlook.'));
  console.log(chalk.white('  3. Use port 587 for STARTTLS unless your provider says otherwise.'));
  console.log(chalk.white('  4. Provide the SMTP password during setup or via the KDM_SMTP_PASSWORD environment variable.'));
  console.log(chalk.dim('     Gmail accounts with 2FA usually require an App Password.'));
  console.log(chalk.gray('──────────────────────────────────────────────────\n'));
};
