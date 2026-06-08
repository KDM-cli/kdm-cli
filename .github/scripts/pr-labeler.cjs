// SPDX-License-Identifier: Apache-2.0

const { buildBotContext, addLabels } = require('./helpers/api.cjs');
const { loadAutomationConfig } = require('./helpers/config-loader.cjs');

function detectType(title) {
  if (!title || typeof title !== 'string') return null;
  const upper = title.toUpperCase();

  const kdm = upper.match(/\[KDM-\d+-(FIX|FEAT|REFACTOR)/);
  if (kdm) {
    const map = { FIX: 'bugFix', FEAT: 'feature', REFACTOR: 'refactor' };
    return map[kdm[1]] || null;
  }

  const cc = title.match(/^(fix|feat|refactor)(\(|:)/i);
  if (cc) {
    const map = { fix: 'bugFix', feat: 'feature', refactor: 'refactor' };
    return map[cc[1].toLowerCase()] || null;
  }

  const plain = title.match(/^(fix|feature|refactor)\b/i);
  if (plain) {
    const map = { fix: 'bugFix', feature: 'feature', refactor: 'refactor' };
    return map[plain[1].toLowerCase()] || null;
  }

  return null;
}

function determineSize(totalChanges, sizeConfig) {
  for (const key of ['xs', 's', 'm', 'l', 'xl']) {
    const max = sizeConfig[key]?.maxChanges;
    if (max === null) return key;
    if (totalChanges <= max) return key;
  }
  return 'xl';
}

function matchGlobPattern(filepath, pattern) {
  const normPath = filepath.replace(/\\/g, '/');
  const normPat = pattern.replace(/\\/g, '/');

  let re = '';
  for (let i = 0; i < normPat.length; i++) {
    const ch = normPat[i];
    if (ch === '*' && normPat[i + 1] === '*') {
      re += '.*';
      i += normPat[i + 2] === '/' ? 2 : 1;
    } else if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$').test(normPath);
}

function detectModules(files, modulePaths) {
  const matched = new Set();
  for (const file of files) {
    for (const [pattern, mod] of Object.entries(modulePaths)) {
      if (matchGlobPattern(file.filename, pattern)) matched.add(mod);
    }
  }
  return Array.from(matched);
}

function calculateComplexity(fileCount, totalChanges, moduleCount) {
  return Math.round(fileCount * 2 + totalChanges / 50 + moduleCount * 5);
}

function determineComplexity(score, complexityConfig) {
  for (const key of ['easy', 'medium', 'complex']) {
    const max = complexityConfig[key]?.maxScore;
    if (max === null) return key;
    if (score <= max) return key;
  }
  return 'complex';
}

async function labelPR({ github, context }) {
  let botContext;
  try {
    botContext = buildBotContext({ github, context });
  } catch (err) {
    return void console.log(`[pr-labeler] Failed to build bot context: ${err.message}`);
  }

  const { owner, repo, number } = botContext;
  const title = context.payload.pull_request?.title || '';
  console.log(`[pr-labeler] Labeling PR #${number}: "${title}"`);

  let config;
  try {
    config = loadAutomationConfig();
  } catch (err) {
    return void console.log(`[pr-labeler] Failed to load automation config: ${err.message}`);
  }

  const prLabels = config.prLabels;
  if (!prLabels) return void console.log('[pr-labeler] No prLabels in kdm-automation.json. Skipping.');

  let prData;
  try {
    prData = (await github.rest.pulls.get({ owner, repo, pull_number: number })).data;
  } catch (err) {
    return void console.log(`[pr-labeler] Failed to fetch PR data: ${err.message}`);
  }

  const totalChanges = (prData.additions || 0) + (prData.deletions || 0);

  let files;
  try {
    files = (await github.rest.pulls.listFiles({ owner, repo, pull_number: number, per_page: 100 })).data;
  } catch (err) {
    return void console.log(`[pr-labeler] Failed to list PR files: ${err.message}`);
  }

  const labelsToAdd = [];

  const typeKey = detectType(title);
  if (typeKey && prLabels.type?.[typeKey]) {
    labelsToAdd.push(prLabels.type[typeKey]);
    console.log(`[pr-labeler] Type: ${typeKey} → ${prLabels.type[typeKey]}`);
  }

  if (prLabels.size) {
    const key = determineSize(totalChanges, prLabels.size);
    const label = prLabels.size[key]?.label;
    if (label) {
      labelsToAdd.push(label);
      console.log(`[pr-labeler] Size: ${key} (${totalChanges} changes) → ${label}`);
    }
  }

  let matchedModules = [];
  if (prLabels.modulePaths) {
    matchedModules = detectModules(files, prLabels.modulePaths);
    for (const mod of matchedModules) {
      const label = prLabels.module?.[mod];
      if (label) {
        labelsToAdd.push(label);
        console.log(`[pr-labeler] Module: ${mod} → ${label}`);
      }
    }
    if (matchedModules.length > 2) {
      labelsToAdd.push('multi-module');
      console.log('[pr-labeler] Multi-module indicator added');
    }
  }

  if (prLabels.complexity) {
    const score = calculateComplexity(files.length, totalChanges, matchedModules.length);
    const key = determineComplexity(score, prLabels.complexity);
    const label = prLabels.complexity[key]?.label;
    if (label) {
      labelsToAdd.push(label);
      console.log(`[pr-labeler] Complexity: ${key} (score ${score}) → ${label}`);
    }
  }

  if (labelsToAdd.length) {
    console.log(`[pr-labeler] Adding labels: ${labelsToAdd.join(', ')}`);
    const result = await addLabels(botContext, labelsToAdd);
    if (!result.success) console.log(`[pr-labeler] Failed to add labels: ${result.error}`);
  } else {
    console.log('[pr-labeler] No labels to add.');
  }
}

module.exports = labelPR;
