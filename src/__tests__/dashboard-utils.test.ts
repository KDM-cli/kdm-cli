import { describe, it, expect } from 'vitest';
import { truncateName } from '../ui/WatchDashboard';

describe('WatchDashboard utility functions', () => {
  describe('truncateName', () => {
    it('should return the original name if it is shorter than or equal to maxLength', () => {
      expect(truncateName('my-pod', 10)).toBe('my-pod');
      expect(truncateName('my-pod', 6)).toBe('my-pod');
    });

    it('should truncate and add ellipses if name is longer than maxLength', () => {
      expect(truncateName('my-very-long-pod-name', 10)).toBe('my-very...');
      expect(truncateName('some-container-name', 15)).toBe('some-contain...');
    });

    it('should handle small max lengths gracefully', () => {
      expect(truncateName('abcde', 4)).toBe('a...');
    });
  });
});
