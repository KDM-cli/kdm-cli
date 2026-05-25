import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerConfigCommand } from '../commands/config';
import * as configUtils from '../utils/config';
import * as tui from '@vr_patel/tui';

// Mock the modules
vi.mock('../utils/config', () => ({
  setConfig: vi.fn(),
  getConfig: vi.fn(() => ({})),
  clearConfig: vi.fn(),
  clearNotificationCredentials: vi.fn(),
}));

vi.mock('@vr_patel/tui', () => ({
  select: vi.fn(),
  input: vi.fn(),
}));

describe('config command', () => {
  let program: Command;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  const consoleLogOrder = (matcher: RegExp | string) => {
    const callIndex = consoleLogSpy.mock.calls.findIndex(([message]: [string]) =>
      matcher instanceof RegExp ? matcher.test(message) : message.includes(matcher),
    );
    expect(callIndex).toBeGreaterThanOrEqual(0);
    return consoleLogSpy.mock.invocationCallOrder[callIndex];
  };

  const firstInputOrder = () => vi.mocked(tui.input).mock.invocationCallOrder[0];

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    registerConfigCommand(program);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should register config setup, set, list, and clear commands', () => {
    const configCmd = program.commands.find((c) => c.name() === 'config');
    expect(configCmd).toBeDefined();
    const subCommandNames = configCmd?.commands.map((c) => c.name());
    expect(subCommandNames).toContain('setup');
    expect(subCommandNames).toContain('set');
    expect(subCommandNames).toContain('list');
    expect(subCommandNames).toContain('clear');
  });

  it('should clear credentials and set service to none', async () => {
    vi.mocked(tui.select).mockResolvedValue('none');
    
    await program.parseAsync(['node', 'test', 'config', 'setup']);
    
    expect(tui.select).toHaveBeenCalled();
    expect(configUtils.clearNotificationCredentials).toHaveBeenCalled();
    expect(configUtils.setConfig).toHaveBeenCalledWith('notification_service', 'none');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/Notifications disabled/i));
  });

  it('should call select, input and setConfig on discord setup', async () => {
    vi.mocked(tui.select).mockResolvedValue('discord');
    vi.mocked(tui.input).mockResolvedValue('https://discord.com/api/webhooks/123456789/token-here');
    
    await program.parseAsync(['node', 'test', 'config', 'setup']);
    
    expect(tui.select).toHaveBeenCalled();
    expect(tui.input).toHaveBeenCalled();
    expect(configUtils.clearNotificationCredentials).toHaveBeenCalled();
    expect(configUtils.setConfig).toHaveBeenCalledWith('notification_service', 'discord');
    expect(configUtils.setConfig).toHaveBeenCalledWith('discord_webhook', 'https://discord.com/api/webhooks/123456789/token-here');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/Discord webhook setup/i));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Integrations > Webhooks'));

    const guideOrder = consoleLogOrder(/Discord webhook setup/i);
    expect(guideOrder).toBeLessThan(firstInputOrder());
  });

  it('should validate Discord webhook URLs during setup', async () => {
    vi.mocked(tui.select).mockResolvedValue('discord');
    vi.mocked(tui.input).mockResolvedValue('https://discord.com/api/webhooks/123456789/token-here');

    await program.parseAsync(['node', 'test', 'config', 'setup']);

    const webhookPrompt = vi.mocked(tui.input).mock.calls[0][0];
    expect(webhookPrompt.validate('not-a-webhook')).toBe('Must be a valid Discord webhook URL (including ID and Token)');
  });

  it('should call select, multiple inputs and setConfig on email setup without password', async () => {
    vi.mocked(tui.select).mockResolvedValue('email');
    vi.mocked(tui.input)
      .mockResolvedValueOnce('smtp.gmail.com') // host
      .mockResolvedValueOnce('587')            // port
      .mockResolvedValueOnce('user@test.com')  // user
      .mockResolvedValueOnce('to@test.com');   // to

    await program.parseAsync(['node', 'test', 'config', 'setup']);
    
    expect(configUtils.setConfig).toHaveBeenCalledWith('notification_service', 'email');
    expect(configUtils.setConfig).toHaveBeenCalledWith('email_host', 'smtp.gmail.com');
    expect(configUtils.setConfig).toHaveBeenCalledWith('email_port', 587);
    expect(configUtils.setConfig).toHaveBeenCalledWith('email_user', 'user@test.com');
    expect(configUtils.setConfig).toHaveBeenCalledWith('email_to', 'to@test.com');
    expect(configUtils.setConfig).not.toHaveBeenCalledWith('email_password', expect.any(String));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/Email SMTP setup/i));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('KDM_SMTP_PASSWORD'));

    const guideOrder = consoleLogOrder(/Email SMTP setup/i);
    expect(guideOrder).toBeLessThan(firstInputOrder());
  });

  it('should not ask for or persist SMTP password during email setup', async () => {
    vi.mocked(tui.select).mockResolvedValue('email');
    vi.mocked(tui.input)
      .mockResolvedValueOnce('smtp.gmail.com') // host
      .mockResolvedValueOnce('587')            // port
      .mockResolvedValueOnce('user@test.com')  // user
      .mockResolvedValueOnce('to@test.com');   // to

    await program.parseAsync(['node', 'test', 'config', 'setup']);

    expect(tui.input).toHaveBeenCalledTimes(4);
    expect(configUtils.setConfig).not.toHaveBeenCalledWith('email_password', expect.any(String));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('KDM_SMTP_PASSWORD'));
  });

  it('should require an SMTP host during email setup', async () => {
    vi.mocked(tui.select).mockResolvedValue('email');
    vi.mocked(tui.input)
      .mockResolvedValueOnce('smtp.gmail.com')
      .mockResolvedValueOnce('587')
      .mockResolvedValueOnce('user@test.com')
      .mockResolvedValueOnce('to@test.com');

    await program.parseAsync(['node', 'test', 'config', 'setup']);

    const smtpHostPrompt = vi.mocked(tui.input).mock.calls[0][0];
    expect(smtpHostPrompt.validate('')).toBe('Host is required');
  });

  it('should call setConfig on config set', async () => {
    await program.parseAsync(['node', 'test', 'config', 'set', 'alert_email', 'test@test.com']);
    expect(configUtils.setConfig).toHaveBeenCalledWith('alert_email', 'test@test.com');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Set alert_email to test@test.com'));
  });

  it('should parse integer for alert_cooldown', async () => {
    await program.parseAsync(['node', 'test', 'config', 'set', 'alert_cooldown', '123']);
    expect(configUtils.setConfig).toHaveBeenCalledWith('alert_cooldown', 123);
  });

  it('should call getConfig on config list', async () => {
    vi.mocked(configUtils.getConfig).mockReturnValue({ alert_cooldown: 100 });
    await program.parseAsync(['node', 'test', 'config', 'list']);
    expect(configUtils.getConfig).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('alert_cooldown'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('100'));
  });

  it('should call clearConfig on config clear', async () => {
    await program.parseAsync(['node', 'test', 'config', 'clear']);
    expect(configUtils.clearConfig).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration cleared'));
  });
});
