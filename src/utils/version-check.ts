import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from './logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the actual package.json version at runtime
export function getInstalledVersion(): string {
  const paths = [
    join(__dirname, '..', 'package.json'),      // production: dist/../package.json
    join(__dirname, '..', '..', 'package.json') // development: src/utils/../../package.json
  ];
  for (const pkgPath of paths) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
    } catch {
      // Try next path
    }
  }
  return '0.0.0';
}

// Compare two semver strings; returns 'lt' if a < b, 'gt' if a > b, 'eq' if equal
export function compareSemver(a: string, b: string): 'lt' | 'gt' | 'eq' {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 < b1 ? 'lt' : 'gt';
  if (a2 !== b2) return a2 < b2 ? 'lt' : 'gt';
  if (a3 !== b3) return a3 < b3 ? 'lt' : 'gt';
  return 'eq';
}

// Determine update type for messaging
export function getUpdateType(installed: string, latest: string): string {
  const cmp = compareSemver(installed, latest);
  if (cmp === 'eq' || cmp === 'gt') return '';
  const [i1 = 0, i2 = 0] = installed.replace(/^v/, '').split('.').map(Number);
  const [l1 = 0, l2 = 0] = latest.replace(/^v/, '').split('.').map(Number);
  if (l1 > i1) return 'major';
  if (l2 > i2) return 'minor';
  return 'patch';
}

export async function checkForUpdates(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonOutput = args.some((arg, index) =>
    arg === '--output=json' || (arg === '--output' && args[index + 1] === 'json') ||
    (arg === '-o' && args[index + 1] === 'json') || arg === '-ojson'
  );
  if (process.stdout.isTTY === false || jsonOutput) return;

  try {
    const response = await fetch('https://registry.npmjs.org/kdm-cli/latest', {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return;

    const data = (await response.json()) as unknown;
    
    if (!data || typeof data !== 'object' || !('version' in data) || typeof data.version !== 'string') {
      logger.error('Invalid registry response: version not found');
      return;
    }

    const latestVersion = data.version;
    const installedVersion = getInstalledVersion();

    const cmp = compareSemver(installedVersion, latestVersion);
    if (cmp === 'lt') {
      const updateType = getUpdateType(installedVersion, latestVersion);
      const typeLabel = updateType === 'major' ? 'Major' : updateType === 'minor' ? 'Minor' : 'New';

      console.log();
      console.log(chalk.bold(chalk.yellow(`  ${typeLabel} update available!`)));
      console.log(chalk.white(`  Current Version : v${installedVersion}`));
      console.log(chalk.white(`  Latest Version  : v${latestVersion}`));
      console.log(chalk.cyan(`  Update using    : npm install -g kdm-cli@latest`));
      console.log();
    }
  } catch {
    // Silently fail — version check is non-critical
  }
}
