import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the actual package.json version at runtime
function getInstalledVersion(): string {
  const pkgPath = join(__dirname, '..', '..', 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Compare two semver strings; returns 'lt' if a < b, 'gt' if a > b, 'eq' if equal
function compareSemver(a: string, b: string): 'lt' | 'gt' | 'eq' {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 < b1 ? 'lt' : 'gt';
  if (a2 !== b2) return a2 < b2 ? 'lt' : 'gt';
  if (a3 !== b3) return a3 < b3 ? 'lt' : 'gt';
  return 'eq';
}

// Determine update type for messaging
function getUpdateType(installed: string, latest: string): string {
  const cmp = compareSemver(installed, latest);
  if (cmp === 'eq') return '';
  const [i1] = installed.replace(/^v/, '').split('.').map(Number);
  const [l1] = latest.replace(/^v/, '').split('.').map(Number);
  if (l1 > i1) return 'major';
function getUpdateType(installed: string, latest: string): string {
  const cmp = compareSemver(installed, latest);
  if (cmp === 'eq') return '';
  const [i1 = 0, i2 = 0] = installed.replace(/^v/, '').split('.').map(Number);
  const [l1 = 0, l2 = 0] = latest.replace(/^v/, '').split('.').map(Number);
  if (l1 > i1) return 'major';
  if (l2 > i2) return 'minor';
  return 'patch';
}
  return 'patch';
}

export async function checkForUpdates(): Promise<void> {
  try {
    const response = await fetch('https://registry.npmjs.org/kdm-cli/latest', {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return;

    const data = await response.json() as { version: string };
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
