import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRunningContainers } from '../docker/containers';
import { getRunningPods } from '../kubernetes/pods';
import { logger } from '../utils/logger';
import { showRunners, showPods } from '../commands/show';
import * as tableUtils from '../ui/table';

// Mock dependencies
vi.mock('../docker/containers', () => ({
  getRunningContainers: vi.fn(),
}));
vi.mock('../kubernetes/pods', () => ({
  getRunningPods: vi.fn(),
}));
vi.mock('../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock('../ui/spinner', () => ({
  createSpinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  })),
}));
vi.mock('../ui/table', () => ({
  renderTable: vi.fn(),
}));

describe('show command runners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle Kubernetes connection failure gracefully in showRunners', async () => {
    // Setup: Docker succeeds, Kubernetes fails
    (getRunningContainers as any).mockResolvedValue([{ id: '123', name: 'web', image: 'nginx', state: 'running', status: 'Up' }]);
    (getRunningPods as any).mockRejectedValue(new Error('EHOSTUNREACH'));

    await showRunners();

    // Verify: Warning was logged for Kubernetes, but no crash
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Kubernetes is unreachable'));
    // Verify: Table still rendered with Docker data
    expect(tableUtils.renderTable).toHaveBeenCalled();
  });

  it('should handle both services failing gracefully in showRunners', async () => {
    (getRunningContainers as any).mockRejectedValue(new Error('Docker down'));
    (getRunningPods as any).mockRejectedValue(new Error('K8s down'));

    await showRunners();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Docker is unreachable'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Kubernetes is unreachable'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No running containers or pods found'));
  });

  it('should handle Kubernetes connection failure gracefully in showPods', async () => {
    (getRunningPods as any).mockRejectedValue(new Error('EHOSTUNREACH'));

    // Should not throw
    await expect(showPods()).resolves.not.toThrow();
  });
});
