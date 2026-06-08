// SPDX-License-Identifier: Apache-2.0

const { getLogger } = require('./logger.cjs');

function hasDCOSignoff(message) {
  if (!message) return false;
  return /^Signed-off-by:\s+.+\s+<.+>/mi.test(message);
}

function hasVerifiedGPGSignature(commit) {
  return commit?.commit?.verification?.verified === true;
}

function isMergeCommit(commit) {
  return Array.isArray(commit?.parents) && commit.parents.length > 1;
}

function checkDCO(commits) {
  const failures = [];
  let skipped = 0;
  for (const c of commits) {
    if (isMergeCommit(c)) { skipped++; continue; }
    const msg = c.commit?.message || '';
    const sha = (c.sha || '').slice(0, 7);
    if (!hasDCOSignoff(msg)) failures.push({ sha, message: msg.split('\n')[0] || '(no message)' });
  }
  const checked = commits.length - skipped;
  getLogger().log(`DCO check: ${checked - failures.length}/${checked} passed (${skipped} merge commit(s) skipped)`);
  return { passed: failures.length === 0, failures };
}

function checkGPG(commits) {
  const failures = [];
  for (const c of commits) {
    const sha = (c.sha || '').slice(0, 7);
    const msg = c.commit?.message || '';
    if (!hasVerifiedGPGSignature(c)) failures.push({ sha, message: msg.split('\n')[0] || '(no message)' });
  }
  getLogger().log(`GPG check: ${commits.length - failures.length}/${commits.length} passed`);
  return { passed: failures.length === 0, failures };
}

async function checkMergeConflict(botContext) {
  const logger = getLogger();
  let conflicts = false, resolved = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { data: pr } = await botContext.github.rest.pulls.get({ owner: botContext.owner, repo: botContext.repo, pull_number: botContext.number });
    if (pr.mergeable !== null) {
      logger.log(`Merge conflict check: mergeable=${pr.mergeable}, state=${pr.mergeable_state}`);
      conflicts = !pr.mergeable;
      resolved = true;
      break;
    }
    if (attempt < 5) { logger.log(`Mergeable state not ready, waiting 2000ms (attempt ${attempt}/5)`); await new Promise(r => setTimeout(r, 2000)); }
  }
  if (!resolved) logger.log('Merge conflict check: mergeable never resolved after retries, assuming no conflicts');
  logger.log(`Merge conflict check: ${conflicts ? 'has conflicts' : 'no conflicts'}`);
  return { passed: !conflicts };
}

function parseIssueNumbers(body) {
  const numbers = new Set();
  for (const re of [/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi, /related\s+to\s+#(\d+)/gi]) {
    let m; while ((m = re.exec(body)) !== null) numbers.add(parseInt(m[1], 10));
  }
  return numbers;
}

function extractNumbersFromTitle(value) {
  const numbers = new Set();
  if (!value) return numbers;
  let m; while ((m = /#(\d+)/g.exec(value)) !== null) numbers.add(parseInt(m[1], 10));
  return numbers;
}

async function fetchAndCheckAssignees(botContext, fetchIssue, issueNumbers, prAuthor) {
  const results = [];
  for (const num of issueNumbers) {
    try {
      const issue = await fetchIssue(botContext, num);
      const isAssigned = (issue.assignees || []).some(a => a.login.toLowerCase() === prAuthor.toLowerCase());
      results.push({ number: num, title: issue.title, isAssigned });
    } catch (err) { getLogger().log(`Issue link check: could not fetch issue #${num}: ${err.message}`); }
  }
  return results;
}

async function checkIssueLink(botContext, { fetchIssue, fetchClosingIssueNumbers }) {
  const logger = getLogger();
  const body = botContext.pr?.body || '';
  const prAuthor = botContext.pr?.user?.login;
  const issueNumbers = parseIssueNumbers(body);
  if (!issueNumbers.size) {
    const titleIssues = extractNumbersFromTitle(botContext.pr?.title || '');
    (await fetchClosingIssueNumbers(botContext)).filter(n => !titleIssues.has(n)).forEach(n => issueNumbers.add(n));
  }
  if (!issueNumbers.size) { logger.log('Issue link check: no linked issues found'); return { passed: false, reason: 'no_issue_linked', issues: [] }; }
  const linked = await fetchAndCheckAssignees(botContext, fetchIssue, issueNumbers, prAuthor);
  if (!linked.length) { logger.log('Issue link check: all linked issues returned errors'); return { passed: false, reason: 'no_issue_linked', issues: [] }; }
  const allAssigned = linked.every(i => i.isAssigned);
  if (!allAssigned) {
    const missing = linked.filter(i => !i.isAssigned).map(i => `#${i.number}`).join(', ');
    logger.log(`Issue link check: author ${prAuthor} not assigned to all linked issues (missing: ${missing})`);
    return { passed: false, reason: 'not_assigned', issues: linked };
  }
  logger.log('Issue link check: passed (author assigned to all linked issues)');
  return { passed: true, reason: null, issues: linked };
}

module.exports = { hasDCOSignoff, hasVerifiedGPGSignature, isMergeCommit, checkDCO, checkGPG, checkMergeConflict, parseIssueNumbers, checkIssueLink, extractNumbersFromTitle };
