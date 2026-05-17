import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compareSemver, getUpdateType, checkForUpdates } from '../utils/version-check';
import { logger } from '../utils/logger';

vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('version-check utilities', () => {
  describe('compareSemver', () => {
    it('should return "lt" if a < b', () => {
      expect(compareSemver('1.0.0', '1.0.1')).toBe('lt');
      expect(compareSemver('1.0.0', '1.1.0')).toBe('lt');
      expect(compareSemver('1.0.0', '2.0.0')).toBe('lt');
    });

    it('should return "gt" if a > b', () => {
      expect(compareSemver('1.0.1', '1.0.0')).toBe('gt');
      expect(compareSemver('1.1.0', '1.0.0')).toBe('gt');
      expect(compareSemver('2.0.0', '1.0.0')).toBe('gt');
    });

    it('should return "eq" if a === b', () => {
      expect(compareSemver('1.0.0', '1.0.0')).toBe('eq');
      expect(compareSemver('v1.0.0', '1.0.0')).toBe('eq');
    });
  });

  describe('getUpdateType', () => {
    it('should return "major" for major updates', () => {
      expect(getUpdateType('1.0.0', '2.0.0')).toBe('major');
    });

    it('should return "minor" for minor updates', () => {
      expect(getUpdateType('1.0.0', '1.1.0')).toBe('minor');
    });

    it('should return "patch" for patch updates', () => {
      expect(getUpdateType('1.0.0', '1.0.1')).toBe('patch');
    });

    it('should return empty string if versions are equal', () => {
      expect(getUpdateType('1.0.0', '1.0.0')).toBe('');
    });

    it('should return empty string for downgrades', () => {
      expect(getUpdateType('2.0.0', '1.0.0')).toBe('');
      expect(getUpdateType('1.1.0', '1.0.0')).toBe('');
      expect(getUpdateType('1.0.1', '1.0.0')).toBe('');
    });
  });

  describe('checkForUpdates', () => {
    const fetchMock = vi.fn();
    
    beforeEach(() => {
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.mocked(logger.error).mockReset();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('should log an error if registry response is invalid', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ not_a_version: '1.2.3' }),
      });

      await checkForUpdates();

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid registry response'));
    });

    it('should handle fetch timeout/error gracefully', async () => {
      fetchMock.mockRejectedValue(new Error('Timeout'));

      await checkForUpdates();
      // Should not throw and should not log error (it fails silently in the catch block for network errors)
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should log update message if a newer version is available', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '9.9.9' }),
      });

      const consoleSpy = vi.spyOn(console, 'log');
      await checkForUpdates();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('update available!'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('v9.9.9'));
    });
  });
});
