import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('conf', () => {
  const mockConfigStore = new Map<string, any>();
  const mockConfInstance = {
    get store() {
      return Object.fromEntries(mockConfigStore.entries());
    },
    set: vi.fn((key, val) => {
      mockConfigStore.set(key, val);
    }),
    get: vi.fn((key) => mockConfigStore.get(key)),
    delete: vi.fn((key) => {
      mockConfigStore.delete(key);
    }),
    clear: vi.fn(() => {
      mockConfigStore.clear();
    }),
  };

  (globalThis as any).mockConfigStore = mockConfigStore;

  return {
    default: class MockConf {
      constructor() {
        return mockConfInstance;
      }
    },
  };
});
import {
  clearConfig,
  getActiveFilters,
  getCacheConfig,
  getConfig,
  getLegacyConfig,
  getLegacyValue,
  getOutputConfig,
  setActiveFilters,
  setAIConfig,
  setCacheConfig,
  setConfigValue,
  setKubernetesConfig,
  setLegacyValue,
  setOutputConfig,
} from '../config/store';

describe('config store', () => {
  beforeEach(() => {
    clearConfig();
    vi.clearAllMocks();
  });

  it('returns defaults for new configuration sections', () => {
    expect(getActiveFilters()).toEqual([]);
    expect(getCacheConfig()).toEqual({ type: 'file', enabled: true });
    expect(getOutputConfig()).toEqual({ format: 'text', language: 'english' });
  });

  it('stores and reads new typed configuration sections', () => {
    setAIConfig({
      providers: [{ name: 'openai', model: 'gpt-4o' }],
      defaultProvider: 'openai',
    });
    setActiveFilters(['Pod', 'Deployment']);
    setKubernetesConfig({ namespace: 'default', kubecontext: 'minikube' });
    setCacheConfig({ type: 'file', enabled: false, path: '/tmp/kdm-cache' });
    setOutputConfig({ format: 'json', language: 'english' });

    expect(getConfig()).toMatchObject({
      ai: {
        providers: [{ name: 'openai', model: 'gpt-4o' }],
        defaultProvider: 'openai',
      },
      activeFilters: ['Pod', 'Deployment'],
      kubernetes: { namespace: 'default', kubecontext: 'minikube' },
      cache: { type: 'file', enabled: false, path: '/tmp/kdm-cache' },
      output: { format: 'json', language: 'english' },
    });
  });

  it('keeps legacy notification reads compatible', () => {
    setLegacyValue('notification_service', 'discord');
    setLegacyValue('discord_webhook', 'https://discord.com/api/webhooks/123/token');
    setLegacyValue('alert_cooldown', 300);

    expect(getLegacyConfig()).toEqual({
      notification_service: 'discord',
      discord_webhook: 'https://discord.com/api/webhooks/123/token',
      alert_cooldown: 300,
      email_host: undefined,
      email_port: undefined,
      email_user: undefined,
      email_to: undefined,
      email_password: undefined,
    });
  });

  it('keeps legacy value reads compatible with migrated notification config', () => {
    setConfigValue('notifications', {
      service: 'email',
      emailHost: 'smtp.test.com',
      emailPort: 587,
      emailUser: 'user@test.com',
      emailTo: 'to@test.com',
    });

    expect(getLegacyValue('notification_service')).toBe('email');
    expect(getLegacyValue('email_host')).toBe('smtp.test.com');
    expect(getLegacyValue('email_port')).toBe(587);
  });

  it('returns safe legacy defaults for malformed notification values', () => {
    setLegacyValue('notification_service', { invalid: 'object' } as never);
    setLegacyValue('alert_cooldown', 'not-a-number' as never);

    expect(getLegacyConfig()).toMatchObject({
      notification_service: 'none',
      alert_cooldown: undefined,
    });
  });
});
