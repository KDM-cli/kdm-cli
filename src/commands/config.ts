import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { setConfig, getConfig, clearConfig, clearNotificationCredentials } from '../utils/config';
import { select, input } from '@vr_patel/tui';

/**
 * Paste-safe text input using Node's readline.
 * The @vr_patel/tui `input` component processes stdin one character at a time,
 * which causes pasted multi-character strings to be silently dropped.
 * readline.createInterface reads the full line regardless of how it arrives.
 */
const readlineInput = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // Resolve with empty string on EOF (Ctrl+D) so the caller's
    // while-loop can detect it and throw instead of hanging forever.
    rl.on('close', () => {
      resolve('');
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
};

const readlineSelect = (
  message: string,
  options: Array<{ label: string; value: string }>,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    let index = 0;

    const render = () => {
      console.log(`\n${message}`);

      options.forEach((option, i) => {
        const marker = i === index ? '❯' : ' ';
        console.log(`${marker} ${option.label}`);
      });

      console.log(chalk.dim('Use ↑/↓ to navigate, Enter to select.'));
    };

    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode?.(false);
      }

      process.stdin.pause();
      process.stdin.removeListener('data', onData);
    };

    const onData = (chunk: Buffer) => {
      const key = chunk.toString();

      if (key === '\u0003') {
        cleanup();
        reject(new Error('Cancelled'));
        return;
      }

      if (key === '\r' || key === '\n') {
        const selected = options[index];
        cleanup();
        resolve(selected.value);
        return;
      }

      if (key === '\u001b[A') {
        index = (index - 1 + options.length) % options.length;
        console.clear();
        render();
        return;
      }

      if (key === '\u001b[B') {
        index = (index + 1) % options.length;
        console.clear();
        render();
      }
    };

    if (!process.stdin.isTTY) {
      reject(new Error('Interactive terminal is required.'));
      return;
    }

    process.stdin.resume();
    process.stdin.setRawMode?.(true);
    process.stdin.on('data', onData);

    render();
  });
};

const promptSelect = async (
  message: string,
  options: Array<{ label: string; value: string; description?: string }>,
): Promise<string> => {
  try {
    return await select({
      message,
      options,
    });
  } catch (error) {
    if ((error as Error).message !== 'Cancelled') {
      throw error;
    }

    return readlineSelect(
      message,
      options.map(({ label, value }) => ({
        label,
        value,
      })),
    );
  }
};

const promptReconfigurationIfNeeded = async (): Promise<boolean> => {
  const currentConfig = getConfig();
  if (!currentConfig.notification_service || currentConfig.notification_service === 'none') {
    return true;
  }
  const serviceLabel = currentConfig.notification_service === 'discord' ? 'Discord' : 'Email (SMTP)';
  console.log(chalk.yellow(`\n⚠ Current notification service is set to: ${chalk.bold(serviceLabel)}`));
  const shouldReconfigure = await promptSelect('Would you like to reconfigure?', [
    { label: 'Yes', value: 'yes' },
    { label: 'No', value: 'no' },
  ]);

  if (shouldReconfigure === 'no') {
    console.log(chalk.dim('Setup cancelled. Current configuration unchanged.'));
    return false;
  }

  return true;
};

const handleNoneSetup = async () => {
  clearNotificationCredentials();
  setConfig('notification_service', 'none');
  console.log(chalk.green('\n✓ Notifications disabled.'));
};

const handleDiscordSetup = async () => {
  printDiscordWebhookGuide();

  const discordWebhookRegex = /^https:\/\/(?:ptb\.|canary\.)?discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;
  const question = chalk.bold.green('? ') + chalk.bold('Discord Webhook URL: ');

  // Use readline instead of @vr_patel/tui `input` to support pasting.
  // The TUI input component handles stdin one character at a time; pasted text
  // arrives as a multi-character chunk and is silently dropped, causing the
  // prompt to glitch and re-display without accepting any value.
  let webhook = '';
  while (true) {
    webhook = await readlineInput(question);
    if (!webhook) {
      throw new Error('Setup cancelled: no input received (EOF).');
    }
    if (discordWebhookRegex.test(webhook)) break;
    console.log(chalk.red('  ✖ Must be a valid Discord webhook URL (including ID and Token)'));
  }

  clearNotificationCredentials();
  setConfig('discord_webhook', webhook);
  setConfig('notification_service', 'discord');

  console.log(chalk.green('\n✓ Discord Webhook configured.'));
};

const handleEmailSetup = async () => {
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

  clearNotificationCredentials();
  setConfig('email_host', host);
  setConfig('email_port', parseInt(portStr, 10));
  setConfig('email_user', user);
  setConfig('email_to', to);
  setConfig('notification_service', 'email');

  console.log(chalk.dim('  Set the SMTP password via the KDM_SMTP_PASSWORD environment variable.'));
  console.log(chalk.green('\n✓ Email SMTP configured.'));
};
const handleConfigSetup = async (): Promise<void> => {
  try {
    if (!(await promptReconfigurationIfNeeded())) return;

    const choice = await promptSelect('Select notification service:', [
      {
        label: 'Discord',
        value: 'discord',
        description: 'Send alerts to a Discord channel via Webhook',
      },
      {
        label: 'Email (SMTP)',
        value: 'email',
        description: 'Send alerts via Email SMTP',
      },
      {
        label: 'None',
        value: 'none',
        description: 'Disable notifications',
      },
    ]);

    const handlers: Record<string, () => Promise<void>> = {
      none: handleNoneSetup,
      discord: handleDiscordSetup,
      email: handleEmailSetup,
    };

    await handlers[choice]();
  } catch (error) {
    console.error(`✖ ${(error as Error).message}`);
  }
};

/**
 * Registers the config CLI command group and subcommands on the Commander program.
 * @param program Commander program instance.
 */
const registerConfigSetupCommand = (config: Command) => {
  config
    .command('setup')
    .description('Interactively set up notification service')
    .action(handleConfigSetup);
};

const registerConfigSetCommand = (config: Command) => {
  config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key, value) => {
      try {
        checkDeprecation(key);
        const finalValue = parseConfigValue(key, value);
        setConfig(key as any, finalValue);
        console.log(chalk.green(`✓ Set ${key} to ${finalValue}`));
      } catch (error) {
        console.error(
          chalk.red(`✗ Failed to set config: ${(error as Error).message}`),
        );
      }
    });
};

const registerConfigListCommand = (config: Command) => {
  config
    .command('list')
    .description('List current configuration')
    .action(() => {
      const current = getConfig();

      console.log(chalk.bold('\nCurrent KDM Configuration:'));
      console.log(
        chalk.gray('──────────────────────────────────────────────────'),
      );

      if (Object.keys(current).length === 0) {
        console.log(
          chalk.yellow(
            ' No configuration found. Use "kdm config set <key> <value>"',
          ),
        );
      } else {
        Object.entries(current).forEach(([key, value]) => {
          console.log(
            `${chalk.cyan(key.padEnd(20))} : ${chalk.white(value)}`,
          );
        });
      }

      console.log(
        chalk.gray('──────────────────────────────────────────────────'),
      );

      console.log(
        chalk.dim(
          '\n Note: SMTP password can be set either in config or via the KDM_SMTP_PASSWORD environment variable, which takes precedence if both are set.\n',
        ),
      );
    });
};

const registerConfigClearCommand = (config: Command) => {
  config
    .command('clear')
    .description('Clear all configuration')
    .action(() => {
      clearConfig();
      console.log(chalk.green('✓ Configuration cleared.'));
    });
};

export const registerConfigCommand = (program: Command) => {
  const config = program
    .command('config')
    .description('Manage KDM configuration');

  registerConfigSetupCommand(config);
  registerConfigSetCommand(config);
  registerConfigListCommand(config);
  registerConfigClearCommand(config);
};

const checkDeprecation = (key: string) => {
  const credentialKeys = ['notification_service', 'discord_webhook', 'email_host', 'email_port', 'email_user', 'email_to'];
  if (credentialKeys.includes(key)) {
    console.log(chalk.yellow(`\n⚠ Deprecation warning: Setting "${key}" via "kdm config set" is deprecated.`));
    console.log(chalk.yellow(`Use ${chalk.bold('kdm config setup')} for guided configuration.\n`));
  }
};

const parseConfigValue = (key: string, value: string): string | number => {
  if (key === 'alert_cooldown' || key === 'email_port') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid numeric value for "${key}"`);
    }
    return parsed;
  }
  return value;
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
  console.log(chalk.white('  4. Set the SMTP password via the KDM_SMTP_PASSWORD environment variable.'));
  console.log(chalk.dim('     Gmail accounts with 2FA usually require an App Password.'));
  console.log(chalk.gray('──────────────────────────────────────────────────\n'));
};
