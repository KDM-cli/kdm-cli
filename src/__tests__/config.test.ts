import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerConfigCommand } from '../commands/config';
import * as configUtils from '../utils/config';
import * as tui from '@vr_patel/tui';

// Mock readline — handleDiscordSetup uses readline instead of tui.input
// so that pasted URLs (multi-char stdin chunks) are accepted correctly.
const mockRlInstance = {
  question: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
};
vi.mock('readline', () => ({
  createInterface: vi.fn(() => mockRlInstance),
}));

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

  const firstInputOrder = () => mockRlInstance.question.mock.invocationCallOrder[0];

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    registerConfigCommand(program);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Default readline behaviour: resolve with a valid Discord webhook URL.
    // Individual tests can override mockRlInstance.question as needed.
    mockRlInstance.question.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb('https://discord.com/api/webhooks/123456789012345678/mock-token-abc123');
    });
    mockRlInstance.on.mockImplementation(() => mockRlInstance);
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

  it('should call select, readline and setConfig on discord setup', async () => {
    vi.mocked(tui.select).mockResolvedValue('discord');
    // mockRlInstance.question default resolves with a valid webhook URL (set in beforeEach)

    await program.parseAsync(['node', 'test', 'config', 'setup']);

    expect(tui.select).toHaveBeenCalled();
    expect(mockRlInstance.question).toHaveBeenCalled();
    expect(configUtils.clearNotificationCredentials).toHaveBeenCalled();
    expect(configUtils.setConfig).toHaveBeenCalledWith('notification_service', 'discord');
    expect(configUtils.setConfig).toHaveBeenCalledWith(
      'discord_webhook',
      'https://discord.com/api/webhooks/123456789012345678/mock-token-abc123',
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/Discord webhook setup/i));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Integrations > Webhooks'));

    const guideOrder = consoleLogOrder(/Discord webhook setup/i);
    expect(guideOrder).toBeLessThan(firstInputOrder());
  });

  it('should re-prompt on invalid Discord webhook URL and accept valid one', async () => {
    vi.mocked(tui.select).mockResolvedValue('discord');

    // First call returns invalid URL, second returns valid
    let callCount = 0;
    mockRlInstance.question.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount === 1) {
        cb('not-a-webhook');
      } else {
        cb('https://discord.com/api/webhooks/123456789012345678/mock-token-abc123');
      }
    });

    await program.parseAsync(['node', 'test', 'config', 'setup']);

    expect(mockRlInstance.question).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Must be a valid Discord webhook URL'),
    );
    expect(configUtils.setConfig).toHaveBeenCalledWith('notification_service', 'discord');
  });

  it('should detect existing config and prompt for reconfiguration — cancel keeps current config', async () => {
    vi.mocked(configUtils.getConfig).mockReturnValue({ notification_service: 'discord' });
    vi.mocked(tui.select).mockResolvedValueOnce('no'); // decline reconfiguration

    await program.parseAsync(['node', 'test', 'config', 'setup']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Current notification service is set to'));
    expect(tui.select).toHaveBeenCalledTimes(1); // only reconfiguration prompt
    expect(configUtils.setConfig).not.toHaveBeenCalled();
  });

  it('should proceed with setup when user confirms reconfiguration', async () => {
    vi.mocked(configUtils.getConfig).mockReturnValue({ notification_service: 'discord' });
    vi.mocked(tui.select)
      .mockResolvedValueOnce('yes') // confirm reconfiguration
      .mockResolvedValueOnce('discord'); // select discord service
    // mockRlInstance.question default resolves with a valid webhook URL (set in beforeEach)

    await program.parseAsync(['node', 'test', 'config', 'setup']);

    expect(tui.select).toHaveBeenCalledTimes(2); // reconfiguration + service selection
    expect(configUtils.setConfig).toHaveBeenCalledWith('notification_service', 'discord');
    expect(configUtils.setConfig).toHaveBeenCalledWith(
      'discord_webhook',
      'https://discord.com/api/webhooks/123456789012345678/mock-token-abc123',
    );
  });

  it('should skip reconfiguration prompt when no existing config', async () => {
    vi.mocked(configUtils.getConfig).mockReturnValue({});
    vi.mocked(tui.select).mockResolvedValue('none');

    await program.parseAsync(['node', 'test', 'config', 'setup']);

    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Current notification service is set to'),
    );
    expect(tui.select).toHaveBeenCalledTimes(1); // only service selection
    expect(configUtils.setConfig).toHaveBeenCalledWith('notification_service', 'none');
  });

  it('should handle select rejection gracefully during setup', async () => {
    vi.mocked(tui.select).mockRejectedValueOnce(new Error('select failed'));

    await program.parseAsync(['node', 'test', 'config', 'setup']);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('select failed'));
    expect(configUtils.setConfig).not.toHaveBeenCalled();
  });

  it('should handle setConfig failure gracefully during setup', async () => {
    vi.mocked(tui.select).mockResolvedValue('discord');
    // mockRlInstance.question default resolves with a valid webhook URL (set in beforeEach)
    vi.mocked(configUtils.setConfig).mockImplementationOnce(() => { throw new Error('write failed'); });

    await program.parseAsync(['node', 'test', 'config', 'setup']);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('write failed'));
  });

  it('should call select, multiple inputs and setConfig on email setup without password', async () => {
    vi.mocked(tui.select).mockResolvedValue('email');
    vi.mocked(tui.input)
      .mockResolvedValueOnce('smtp.gmail.com') // host
      .mockResolvedValueOnce('587')            // port
      .mockResolvedValueOnce('user@test.com')  // user
      .mockResolvedValueOnce('to@test.com')    // to
      .mockResolvedValueOnce('');              // password (empty)

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
    const firstTuiInputOrder = vi.mocked(tui.input).mock.invocationCallOrder[0];
    expect(guideOrder).toBeLessThan(firstTuiInputOrder);
  });

  it('should not save email_password if provided during email setup', async () => {
    vi.mocked(tui.select).mockResolvedValue('email');
    vi.mocked(tui.input)
      .mockResolvedValueOnce('smtp.gmail.com') // host
      .mockResolvedValueOnce('587')            // port
      .mockResolvedValueOnce('user@test.com')  // user
      .mockResolvedValueOnce('to@test.com')    // to
      .mockResolvedValueOnce('pass123');       // password

    await program.parseAsync(['node', 'test', 'config', 'setup']);

    const passwordCall = vi.mocked(configUtils.setConfig).mock.calls.find(
      (call) => (call[0] as any) === 'email_password',
    );
    expect(passwordCall).toBeUndefined();
  });

it('should require an SMTP host during email setup and validate optional SMTP password', async () => {
  vi.mocked(tui.select).mockResolvedValue('email');
  vi.mocked(tui.input)
    .mockResolvedValueOnce('smtp.gmail.com')
    .mockResolvedValueOnce('587')
    .mockResolvedValueOnce('user@test.com')
    .mockResolvedValueOnce('to@test.com')
    .mockResolvedValueOnce('');

  await program.parseAsync(['node', 'test', 'config', 'setup']);

  const smtpHostPrompt = vi.mocked(tui.input).mock.calls[0][0];
  expect(smtpHostPrompt.validate?.('')).toBe('Host is required');

  // Find the password prompt by looking for the last input call
  const passwordPromptIndex = vi.mocked(tui.input).mock.calls.length - 1;
  const smtpPasswordPrompt = vi.mocked(tui.input).mock.calls[passwordPromptIndex][0];
  expect(smtpPasswordPrompt.validate?.('')).toBe(true);
  expect(smtpPasswordPrompt.validate?.('anything')).toBe(true);
});

  it('should call setConfig on config set', async () => {
    await program.parseAsync(['node', 'test', 'config', 'set', 'alert_email', 'test@test.com']);
    expect(configUtils.setConfig).toHaveBeenCalledWith('alert_email', 'test@test.com');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Set alert_email to test@test.com'));
  });

  it('should show deprecation warning when setting credential key via config set', async () => {
    await program.parseAsync(['node', 'test', 'config', 'set', 'discord_webhook', 'https://discord.com/api/webhooks/test']);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Deprecation warning'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('kdm config setup'));
    expect(configUtils.setConfig).toHaveBeenCalled(); // still executes (soft deprecation)
  });

  it('should show deprecation warning for all credential keys', async () => {
    const credentialKeys = ['notification_service', 'discord_webhook', 'email_host', 'email_port', 'email_user', 'email_to'];
    for (const key of credentialKeys) {
      vi.clearAllMocks();
      // email_port gets parsed to int by the existing handler logic
      const testValue = key === 'email_port' ? '587' : 'test-value';
      const expectedValue = key === 'email_port' ? 587 : testValue;
      await program.parseAsync(['node', 'test', 'config', 'set', key, testValue]);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Deprecation warning'));
      expect(configUtils.setConfig).toHaveBeenCalledWith(key, expectedValue);
    }
  });

  it('should not show deprecation warning for non-credential keys', async () => {
    await program.parseAsync(['node', 'test', 'config', 'set', 'alert_cooldown', '300']);
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Deprecation warning'));
    expect(configUtils.setConfig).toHaveBeenCalledWith('alert_cooldown', 300);
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
