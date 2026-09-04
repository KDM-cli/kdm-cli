/**
 * Utility functions for navigation and exit handling across interactive dashboards.
 */

/**
 * Executes the onBack callback if provided; otherwise unmounts and exits the process.
 *
 * @param onBack - Optional callback to navigate back to a parent screen.
 * @param exitFn - Optional Ink useApp exit unmount function.
 */
export function triggerBack(onBack?: () => void, exitFn?: () => void): void {
  if (onBack) {
    onBack();
    return;
  }
  exitFn?.();
  process.exit(0);
}

/**
 * Executes the onExit callback if provided; otherwise unmounts and exits the process.
 *
 * @param onExit - Optional callback to handle CLI process termination.
 * @param exitFn - Optional Ink useApp exit unmount function.
 */
export function triggerExit(onExit?: () => void, exitFn?: () => void): void {
  if (onExit) {
    onExit();
    return;
  }
  exitFn?.();
  process.exit(0);
}
