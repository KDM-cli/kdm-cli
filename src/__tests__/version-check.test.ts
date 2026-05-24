import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compareSemver, getUpdateType, checkForUpdates, getInstalledVersion } from '../utils/version-check';
import { logger } from '../utils/logger';
import { readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify({ version: '1.2.2' })),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

const hasPathSuffix = (path: string, suffix: string) =>
  path.replaceAll('\\', '/').endsWith(suffix);

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

  describe('getInstalledVersion', () => {
    afterEach(() => {
      vi.mocked(readFileSync).mockReset();
    });

    it('should treat Windows and POSIX separators the same when matching package paths', () => {
      expect(hasPathSuffix('C:\\repo\\src\\package.json', 'src/package.json')).toBe(true);
      expect(hasPathSuffix('/repo/src/package.json', 'src/package.json')).toBe(true);
      expect(hasPathSuffix('/repo/src/package.json', 'src/other.json')).toBe(false);
    });

    it('should resolve and return the version if package.json in production path is valid', () => {
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (typeof path === 'string' && hasPathSuffix(path, 'src/package.json')) {
          return JSON.stringify({ version: '2.3.4' });
        }
        throw new Error('File not found');
      });

      expect(getInstalledVersion()).toBe('2.3.4');
    });

    it('should resolve and return the version if production path fails but development path succeeds', () => {
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (typeof path === 'string' && hasPathSuffix(path, 'package.json') && !hasPathSuffix(path, 'src/package.json')) {
          return JSON.stringify({ version: '1.2.3' });
        }
        throw new Error('File not found');
      });

      expect(getInstalledVersion()).toBe('1.2.3');
    });

    it('should advance to the next path if JSON is malformed', () => {
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (typeof path === 'string' && hasPathSuffix(path, 'src/package.json')) {
          return '{ malformed json';
        }
        if (typeof path === 'string' && hasPathSuffix(path, 'package.json') && !hasPathSuffix(path, 'src/package.json')) {
          return JSON.stringify({ version: '1.2.9' });
        }
        throw new Error('File not found');
      });

      expect(getInstalledVersion()).toBe('1.2.9');
    });

    it('should advance to next path if version is not a string or missing', () => {
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (typeof path === 'string' && hasPathSuffix(path, 'src/package.json')) {
          return JSON.stringify({ version: 12345 }); // non-string version
        }
        if (typeof path === 'string' && hasPathSuffix(path, 'package.json') && !hasPathSuffix(path, 'src/package.json')) {
          return JSON.stringify({ version: '1.2.8' });
        }
        throw new Error('File not found');
      });

      expect(getInstalledVersion()).toBe('1.2.8');
    });

    it('should fallback to 0.0.0 if both paths fail', () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Read failed');
      });

      expect(getInstalledVersion()).toBe('0.0.0');
    });
  });
});
