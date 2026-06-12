import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { triggerAlert } from '../monitor/alerts';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';

// Mock config
vi.mock('../utils/config', () => ({
  getConfig: vi.fn(() => ({
    alert_cooldown: 300,
    discord_webhook: 'https://discord.com/api/webhooks/dummy',
  })),
  getSMTPSettings: vi.fn(() => ({
    host: '',
    port: 587,
    auth: { user: '', pass: '' },
    to: '',
  })),
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fetch globally
const mockFetch = vi.fn().mockResolvedValue({ ok: true });

describe('alerts monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should trigger alert on first invocation', async () => {
    const alertId = 'container:test-first:failure';
    await triggerAlert({
      id: alertId,
      message: 'Container crashed',
      type: 'container',
      severity: 'critical',
    });

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`Triggering alert for ${alertId}`));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should respect cooldown but bypass it if the force option is true', async () => {
    const alertId = 'container:test-flow:failure';
    
    // 1. First trigger - should send
    await triggerAlert({
      id: alertId,
      message: 'Container crashed first time',
      type: 'container',
      severity: 'critical',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    
    // 2. Second trigger within cooldown without force - should be suppressed
    await triggerAlert({
      id: alertId,
      message: 'Container crashed second time',
      type: 'container',
      severity: 'critical',
    });
    // Call count should still be 1
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 3. Third trigger within cooldown with force: true - should send regardless of cooldown
    await triggerAlert({
      id: alertId,
      message: 'Container crashed third time',
      type: 'container',
      severity: 'critical',
    }, { force: true });
    
    // Call count should be 2 now
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
