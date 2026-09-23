import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { triggerBack, triggerExit } from '../ui/navigation-utils';

describe('navigation-utils', () => {
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalExit = process.exit;
    process.exit = vi.fn() as any;
  });

  afterEach(() => {
    process.exit = originalExit;
    vi.clearAllMocks();
  });

  describe('triggerBack', () => {
    it('calls onBack when provided and does not exit', () => {
      const onBackSpy = vi.fn();
      const exitFnSpy = vi.fn();

      triggerBack(onBackSpy, exitFnSpy);

      expect(onBackSpy).toHaveBeenCalledTimes(1);
      expect(exitFnSpy).not.toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('calls exitFn and process.exit(0) when onBack is not provided', () => {
      const exitFnSpy = vi.fn();

      triggerBack(undefined, exitFnSpy);

      expect(exitFnSpy).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('handles undefined exitFn gracefully', () => {
      triggerBack(undefined, undefined);

      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('triggerExit', () => {
    it('calls onExit when provided and does not exit process', () => {
      const onExitSpy = vi.fn();
      const exitFnSpy = vi.fn();

      triggerExit(onExitSpy, exitFnSpy);

      expect(onExitSpy).toHaveBeenCalledTimes(1);
      expect(exitFnSpy).not.toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('calls exitFn and process.exit(0) when onExit is not provided', () => {
      const exitFnSpy = vi.fn();

      triggerExit(undefined, exitFnSpy);

      expect(exitFnSpy).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('handles undefined exitFn gracefully', () => {
      triggerExit(undefined, undefined);

      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });
});
