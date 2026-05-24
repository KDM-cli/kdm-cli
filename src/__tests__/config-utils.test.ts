import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('conf', () => {
  const mockConfigStore = new Map<string, any>();
  const mockConfInstance = {
    store: {},
    set: vi.fn((key, val) => {
      mockConfigStore.set(key, val);
    }),
    get: vi.fn((key) => {
      return mockConfigStore.get(key);
    }),
    delete: vi.fn((key) => {
      mockConfigStore.delete(key);
    }),
    clear: vi.fn(() => {
      mockConfigStore.clear();
    }),
  };

  (globalThis as any).mockConfigStore = mockConfigStore;
  (globalThis as any).mockConfInstance = mockConfInstance;

  return {
    default: class MockConf {
      constructor() {
        return mockConfInstance;
      }
    },
  };
});

import { getSMTPSettings, clearNotificationCredentials } from '../utils/config';

describe('config utils', () => {
  const originalEnv = process.env;
  let mockConfInstance: any;
  let mockConfigStore: any;

  beforeEach(() => {
    mockConfInstance = (globalThis as any).mockConfInstance;
    mockConfigStore = (globalThis as any).mockConfigStore;
    mockConfigStore.clear();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should clear all notification credentials, including email_password', () => {
    mockConfigStore.set('discord_webhook', 'http://webhook');
    mockConfigStore.set('email_host', 'smtp.test.com');
    mockConfigStore.set('email_port', 587);
    mockConfigStore.set('email_user', 'user@test.com');
    mockConfigStore.set('email_to', 'to@test.com');
    mockConfigStore.set('email_password', 'secret');

    clearNotificationCredentials();

    expect(mockConfInstance.delete).toHaveBeenCalledWith('discord_webhook');
    expect(mockConfInstance.delete).toHaveBeenCalledWith('email_host');
    expect(mockConfInstance.delete).toHaveBeenCalledWith('email_port');
    expect(mockConfInstance.delete).toHaveBeenCalledWith('email_user');
    expect(mockConfInstance.delete).toHaveBeenCalledWith('email_to');
    expect(mockConfInstance.delete).toHaveBeenCalledWith('email_password');
  });

  it('should get SMTP settings with precedence given to environment variables over email_password', () => {
    mockConfigStore.set('email_host', 'smtp.test.com');
    mockConfigStore.set('email_port', 587);
    mockConfigStore.set('email_user', 'user@test.com');
    mockConfigStore.set('email_to', 'to@test.com');
    mockConfigStore.set('email_password', 'config-password');

    // Case 1: No env variable set, should use stored config password
    delete process.env.KDM_SMTP_PASSWORD;
    let settings = getSMTPSettings();
    expect(settings.auth.pass).toBe('config-password');

    // Case 2: Env variable set, should take precedence
    process.env.KDM_SMTP_PASSWORD = 'env-password';
    settings = getSMTPSettings();
    expect(settings.auth.pass).toBe('env-password');
  });
});
