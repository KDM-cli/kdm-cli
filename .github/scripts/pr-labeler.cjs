// SPDX-License-Identifier: Apache-2.0
//
// pr-labeler.cjs
//
// Smart PR labeler: computes type, size, module, and complexity labels
// from the PR title and changed files, then applies them via the GitHub API.
//
// Invoked by .github/workflows/labeler.yml via actions/github-script.
// This file is a wrapper that maps the github-script args to the internal
// labeler function so the core logic is testable without the GitHub runner.

const { buildBotContext, addLabels } = require('./helpers/api.cjs');
const { loadAutomationConfig } = require('./helpers/config-loader.cjs');

/**
 * Detects the PR type from its title.
 * Supports:
 *   - KDM title format: [KDM-123-FIX-description]
 *   - Conventional commits: feat:, fix:, refactor:, feat(scope):, fix(scope):
 *   - Plain keywords at the start: "fix ", "feature ", "refactor "
 *
 * @param {string} title - The PR title.
 * @returns {string|null} Type key ('bugFix', 'feature', 'refactor') or null.
 */
function detectType(title) {
  if (!title || typeof title !== 'string') return null;

  const upper = title.toUpperCase();

  // KDM format: [KDM-123-FIX-description]
  const kdmMatch = upper.match(/\[KDM-\d+-(FIX|FEAT|REFACTOR)/);
  if (kdmMatch) {
    const map = { FIX: 'bugFix', FEAT: 'feature', REFACTOR: 'refactor' };
    return map[kdmMatch[1]] || null;
  }

  // Conventional commit: fix:, feat:, refactor:, fix(scope):, feat(scope):
  const ccMatch = title.match(/^(fix|feat|refactor)(\(|:)/i);
  if (ccMatch) {
    const map = { fix: 'bugFix', feat: 'feature', refactor: 'refactor' };
    return map[ccMatch[1].toLowerCase()] || null;
  }

  // Plain keywords at start
  const plainMatch = title.match(/^(fix|feature|refactor)\b/i);
  if (plainMatch) {
    const map = { fix: 'bugFix', feature: 'feature', refactor: 'refactor' };
    return map[plainMatch[1].toLowerCase()] || null;
  }

  return null;
}

/**
 * Determines the size label key based on total line changes.
 *
 * @param {number} totalChanges - additions + deletions.
 * @param {object} sizeConfig - The prLabels.size config object.
 * @returns {string} Size key ('xs', 's', 'm', 'l', 'xl').
 */
function determineSize(totalChanges, sizeConfig) {
  const sizes = ['xs', 's', 'm', 'l', 'xl'];
  for (const key of sizes) {
    const max = sizeConfig[key]?.maxChanges;
    if (max === null) return key; // xl has no upper bound
    if (totalChanges <= max) return key;
  }
  return 'xl';
}

/**
 * Detects modules from the list of changed file paths using
 * the modulePaths pattern configuration.
 *
 * @param {Array<{ filename: string }>} files - List of changed files from the PR.
 * @param {object} modulePaths - The prLabels.modulePaths mapping.
 * @returns {string[]} Deduplicated module keys (e.g. ['cli', 'ui']).
 */
function detectModules(files, modulePaths) {
  const matched = new Set();

  for (const file of files) {
    const filename = file.filename;

    for (const [pattern, moduleName] of Object.entries(modulePaths)) {
      if (matchGlobPattern(filename, pattern)) {
        matched.add(moduleName);
      }
    }
  }

  return Array.from(matched);
}

/**
 * Simple glob pattern matcher. Supports:
 *   - ** (matches any number of directories)
 *   - * (matches within a single path segment)
 *   - Literal characters
 *
 * @param {string} filepath - The file path to check.
 * @param {string} pattern - The glob pattern to match against.
 * @returns {boolean} Whether the filepath matches the pattern.
 */
function matchGlobPattern(filepath, pattern) {
  // Normalize to forward slashes
  const normalizedPath = filepath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Escape regex special chars except * and ?
  let regexStr = '';
  let i = 0;
  while (i < normalizedPattern.length) {
    const ch = normalizedPattern[i];
    if (ch === '*') {
      // Lookahead for **
      if (i + 1 < normalizedPattern.length && normalizedPattern[i + 1] === '*') {
        // ** matches everything
        if (i + 2 < normalizedPattern.length && normalizedPattern[i + 2] === '/') {
          regexStr += '.*';
          i += 3; // skip **/
          continue;
        }
        regexStr += '.*';
        i += 2;
        continue;
      }
      // Single * matches non-slash chars
      regexStr += '[^/]*';
      i++;
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else {
      regexStr += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalizedPath);
}

/**
 * Calculates a review complexity score.
 *
 * Heuristic: score = (files × 2) + (lines / 50) + (modules × 5)
 *
 * @param {number} fileCount - Number of files changed.
 * @param {number} totalChanges - Lines added + deleted.
 * @param {number} moduleCount - Number of modules touched.
 * @returns {number} Complexity score.
 */
function calculateComplexity(fileCount, totalChanges, moduleCount) {
  return Math.round(fileCount * 2 + totalChanges / 50 + moduleCount * 5);
}

/**
 * Determines the complexity label key based on the score.
 *
 * @param {number} score - Complexity score.
 * @param {object} complexityConfig - The prLabels.complexity config object.
 * @returns {string} Complexity key ('easy', 'medium', 'complex').
 */
function determineComplexity(score, complexityConfig) {
  const levels = ['easy', 'medium', 'complex'];
  for (const key of levels) {
    const max = complexityConfig[key]?.maxScore;
    if (max === null) return key; // complex has no upper bound
    if (score <= max) return key;
  }
  return 'complex';
}

/**
 * Main labeler logic. Computes type, size, module, and complexity labels
 * for a PR and applies them.
 *
 * @param {{ github: object, context: object }} args - GitHub API client and workflow context.
 */
async function labelPR({ github, context }) {
  let botContext;
  try {
    botContext = buildBotContext({ github, context });
  } catch (err) {
    console.log(`[pr-labeler] Failed to build bot context: ${err.message}`);
    return;
  }

  const { owner, repo, number } = botContext;
  const title = context.payload.pull_request?.title || '';
  console.log(`[pr-labeler] Labeling PR #${number}: "${title}"`);

  // Load automation config
  let config;
  try {
    config = loadAutomationConfig();
  } catch (err) {
    console.log(`[pr-labeler] Failed to load automation config: ${err.message}`);
    return;
  }

  const prLabels = config.prLabels;
  if (!prLabels) {
    console.log('[pr-labeler] No prLabels section found in kdm-automation.json. Skipping.');
    return;
  }

  // Fetch PR details for additions/deletions total
  let prData;
  try {
    const resp = await github.rest.pulls.get({ owner, repo, pull_number: number });
    prData = resp.data;
  } catch (err) {
    console.log(`[pr-labeler] Failed to fetch PR data: ${err.message}`);
    return;
  }

  const totalChanges = (prData.additions || 0) + (prData.deletions || 0);

  // Fetch changed files for module detection
  let files;
  try {
    const resp = await github.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: number,
      per_page: 100,
    });
    files = resp.data;
  } catch (err) {
    console.log(`[pr-labeler] Failed to list PR files: ${err.message}`);
    return;
  }

  const labelsToAdd = [];

  // 1. Type label (from title)
  const typeKey = detectType(title);
  if (typeKey && prLabels.type?.[typeKey]) {
    labelsToAdd.push(prLabels.type[typeKey]);
    console.log(`[pr-labeler] Type detected: ${typeKey} → ${prLabels.type[typeKey]}`);
  }

  // 2. Size label (from line changes)
  if (prLabels.size) {
    const sizeKey = determineSize(totalChanges, prLabels.size);
    const sizeLabel = prLabels.size[sizeKey]?.label;
    if (sizeLabel) {
      labelsToAdd.push(sizeLabel);
      console.log(`[pr-labeler] Size: ${sizeKey} (${totalChanges} changes) → ${sizeLabel}`);
    }
  }

  // 3. Module labels (from file paths)
  let matchedModules = [];
  if (prLabels.modulePaths) {
    matchedModules = detectModules(files, prLabels.modulePaths);
    for (const moduleKey of matchedModules) {
      const moduleLabel = prLabels.module?.[moduleKey];
      if (moduleLabel) {
        labelsToAdd.push(moduleLabel);
        console.log(`[pr-labeler] Module: ${moduleKey} → ${moduleLabel}`);
      }
    }
    // Add multi-module indicator if >2 modules touched
    if (matchedModules.length > 2) {
      labelsToAdd.push('multi-module');
      console.log('[pr-labeler] Multi-module indicator added');
    }
  }

  // 4. Complexity label (from heuristic)
  if (prLabels.complexity) {
    const score = calculateComplexity(files.length, totalChanges, matchedModules.length);
    const complexityKey = determineComplexity(score, prLabels.complexity);
    const complexityLabel = prLabels.complexity[complexityKey]?.label;
    if (complexityLabel) {
      labelsToAdd.push(complexityLabel);
      console.log(`[pr-labeler] Complexity: ${complexityKey} (score ${score}) → ${complexityLabel}`);
    }
  }

  // Apply labels
  if (labelsToAdd.length > 0) {
    console.log(`[pr-labeler] Adding labels: ${labelsToAdd.join(', ')}`);
    const result = await addLabels(botContext, labelsToAdd);
    if (!result.success) {
      console.log(`[pr-labeler] Failed to add some labels: ${result.error}`);
    }
  } else {
    console.log('[pr-labeler] No labels to add.');
  }
}

module.exports = labelPR;
