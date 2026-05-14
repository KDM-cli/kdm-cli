import { Command } from 'commander';
import chalk from 'chalk';
import { setConfig, getConfig, clearConfig } from '../utils/config';
import { select } from '@vr_patel/tui';

export const registerConfigCommand = (program: Command) => {
  const config = program
    .command('config')
    .description('Manage KDM configuration');

  config
    .command('setup')
    .description('Interactively setup notification service')
    .action(async () => {
      try {
        const choice = await select({
          message: "Select notification service:",
          options: [
            { label: "Discord", value: "discord", description: "Send alerts to a Discord channel via Webhook" },
            { label: "Email (SMTP)", value: "email", description: "Send alerts via Email SMTP" },
            { label: "None", value: "none", description: "Disable notifications" },
          ],
        });

        setConfig('notification_service', choice);
        console.log(chalk.green(`\n✓ Notification service set to: ${chalk.bold(choice.toUpperCase())}`));
        
        if (choice === 'discord') {
          console.log(chalk.yellow('! Remember to set your webhook URL:'), chalk.cyan('kdm config set discord_webhook <url>'));
        } else if (choice === 'email') {
          console.log(chalk.yellow('! Remember to set your SMTP details (email_host, email_port, email_user, email_to)'));
        }
      } catch (error) {
        console.error(chalk.red(`✗ Setup cancelled or failed: ${(error as Error).message}`));
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
      console.log(chalk.dim('\n Note: SMTP passwords must be set via KDM_SMTP_PASSWORD env var.\n'));
    });

  config
    .command('clear')
    .description('Clear all configuration')
    .action(() => {
      clearConfig();
      console.log(chalk.green('✓ Configuration cleared.'));
    });
};
