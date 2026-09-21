import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileCacheProvider } from '../cache/file-cache';

describe('File Cache Provider', () => {
  let cache: FileCacheProvider;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `kdm-cache-test-${Date.now()}`);
    cache = new FileCacheProvider();
    await cache.configure({ type: 'file', enabled: true, path: testDir });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('stores and loads a cache entry', async () => {
    await cache.store('test-key', 'test-value');
    const result = await cache.load('test-key');
    expect(result).toBe('test-value');
  });

  it('returns null for non-existent keys', async () => {
    const result = await cache.load('missing-key');
    expect(result).toBeNull();
  });

  it('lists stored entries', async () => {
    await cache.store('key-1', 'value-1');
    await cache.store('key-2', 'value-2');
    const entries = await cache.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.key).sort()).toEqual(['key-1', 'key-2']);
  });

  it('removes a specific entry', async () => {
    await cache.store('to-remove', 'data');
    await cache.remove('to-remove');
    const result = await cache.load('to-remove');
    expect(result).toBeNull();
  });

  it('checks if a key exists', async () => {
    await cache.store('exists-key', 'data');
    expect(await cache.exists('exists-key')).toBe(true);
    expect(await cache.exists('missing-key')).toBe(false);
  });

  it('purges all entries', async () => {
    await cache.store('key-a', 'data-a');
    await cache.store('key-b', 'data-b');
    await cache.purge();
    const entries = await cache.list();
    expect(entries).toHaveLength(0);
  });

  it('handles corrupt cache entries gracefully', async () => {
    // Directly write a corrupt file
    const filePath = path.join(testDir, 'corrupt-key');
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(filePath);

    const result = await cache.load('corrupt-key');
    expect(result).toBeNull();
  });

  it('prevents path traversal vulnerabilities for cache keys', async () => {
    const maliciousKey = '../../../etc/passwd';
    await expect(cache.store(maliciousKey, 'data')).rejects.toThrow(/path traversal/);
    await expect(cache.load(maliciousKey)).rejects.toThrow(/path traversal/);
    await expect(cache.remove(maliciousKey)).rejects.toThrow(/path traversal/);
    await expect(cache.exists(maliciousKey)).rejects.toThrow(/path traversal/);
  });

  it.each([
    { key: 'key-with-data', data: 'hello world', expectedSize: 11 },
    { key: 'empty-data', data: '', expectedSize: 0 },
  ])('stores entry $key with correct size metadata', async ({ key, data, expectedSize }) => {
    await cache.store(key, data);
    const entries = await cache.list();
    const entry = entries.find((e) => e.key === key);
    expect(entry).toBeDefined();
    expect(entry?.sizeBytes).toBe(expectedSize);
  });
});
