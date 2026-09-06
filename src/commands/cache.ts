import { Command } from 'commander';
import chalk from 'chalk';
import { getCacheConfig } from '../config/store';
import { createCacheProvider } from '../cache';
import { logger } from '../utils/logger';

/**
 * Creates a cache provider instance from the current config.
 * @returns A configured CacheProvider.
 */
const getCache = () => createCacheProvider(getCacheConfig());

/**
 * Handles the `kdm cache list` command, printing all cached entries.
 */
async function handleCacheList(): Promise<void> {
  try {
    const cache = getCache();
    const entries = await cache.list();
    if (entries.length === 0) {
      logger.info('Cache is empty');
      return;
    }
    console.log(chalk.cyan(`\nCached entries (${entries.length}):\n`));
    for (const entry of entries) {
      const size = entry.sizeBytes ? ` (${entry.sizeBytes} bytes)` : '';
      const date = entry.createdAt ? ` [${entry.createdAt}]` : '';
      console.log(`  ${chalk.yellow(entry.key)}${size}${date}`);
    }
    console.log();
  } catch (error) {
    logger.error(`Failed to list cache: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

/**
 * Handles the `kdm cache get <key>` command, printing the cached value.
 * @param key The cache key to retrieve.
 */
async function handleCacheGet(key: string): Promise<void> {
  try {
    const cache = getCache();
    const data = await cache.load(key);
    if (data === null) {
      logger.warn(`Cache entry not found: ${key}`);
      process.exitCode = 1;
      return;
    }
    console.log(data);
  } catch (error) {
    logger.error(`Failed to read cache: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

/**
 * Handles the `kdm cache remove <key>` command, deleting a single entry.
 * @param key The cache key to remove.
 */
async function handleCacheRemove(key: string): Promise<void> {
  try {
    const cache = getCache();
    await cache.remove(key);
    logger.success(`Removed cache entry: ${key}`);
  } catch (error) {
    logger.error(`Failed to remove cache entry: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

/**
 * Handles the `kdm cache purge` command, clearing all cache entries.
 */
async function handleCachePurge(): Promise<void> {
  try {
    const cache = getCache();
    await cache.purge();
    logger.success('Cache purged successfully');
  } catch (error) {
    logger.error(`Failed to purge cache: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

/**
 * Registers the `cache` command group and its subcommands on the Commander program.
 * @param program Commander program instance.
 */
export const registerCacheCommand = (program: Command) => {
  const cacheCmd = program
    .command('cache')
    .description('Manage the AI explanation cache')
    .action(async () => {
      const { default: React } = await import('react');
      const { render } = await import('ink');
      const { CacheDashboard } = await import('../ui/CacheDashboard.js');
      const app = render(React.createElement(CacheDashboard));
      await app.waitUntilExit();
    });

  cacheCmd
    .command('list')
    .description('List all cached AI explanation entries')
    .action(handleCacheList);

  cacheCmd
    .command('get <key>')
    .description('Retrieve a cached AI explanation by key')
    .action(handleCacheGet);

  cacheCmd
    .command('remove <key>')
    .description('Remove a cached AI explanation entry')
    .action(handleCacheRemove);

  cacheCmd
    .command('purge')
    .description('Clear all cached AI explanations')
    .action(handleCachePurge);
};
