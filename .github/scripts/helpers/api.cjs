// SPDX-License-Identifier: Apache-2.0

const { getLogger } = require('./logger.cjs');
const { isSafeSearchToken, requireObject, requireNonEmptyString, requirePositiveInt, requireSafeUsername } = require('./validation.cjs');
const { LABELS, SKILL_HIERARCHY, ISSUE_STATE } = require('./constants.cjs');
const { checkDCO, checkGPG, checkMergeConflict, checkIssueLink } = require('./checks.cjs');
const { buildBotComment } = require('./comments.cjs');

function buildBotContext({ github, context }) {
  requireObject(github, 'github');
  requireObject(context, 'context');
  requireObject(context.repo, 'context.repo');
  requireObject(context.payload, 'context.payload');

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  requireNonEmptyString(owner, 'context.repo.owner');
  requireNonEmptyString(repo, 'context.repo.repo');
  if (!isSafeSearchToken(owner) || !isSafeSearchToken(repo)) {
    throw new Error('Bot context invalid: owner or repo contains invalid characters');
  }

  const base = { github, owner, repo };
  requireNonEmptyString(context.eventName, 'context.eventName');
  const eventType = context.eventName;
  const { payload } = context;
  let payloadPart;

  switch (eventType) {
    case 'pull_request':
    case 'pull_request_target':
    case 'pull_request_review': {
      const pr = payload.pull_request;
      requireObject(pr, 'context.payload.pull_request');
      requirePositiveInt(pr.number, 'pull_request.number');
      if (pr.user) {
        requireNonEmptyString(pr.user.login, 'pull_request.user.login');
        if (!isSafeSearchToken(pr.user.login)) {
          throw new Error('Bot context invalid: pull_request.user.login contains invalid characters');
        }
      }
      payloadPart = { number: pr.number, pr };
      break;
    }
    case 'issues':
    case 'issue_comment': {
      const issue = payload.issue;
      requireObject(issue, 'context.payload.issue');
      requirePositiveInt(issue.number, 'issue.number');
      payloadPart = { number: issue.number, issue };

      if (eventType === 'issue_comment') {
        const comment = payload.comment;
        requireObject(comment, 'context.payload.comment');
        requireObject(comment.user, 'context.payload.comment.user');
        requireNonEmptyString(comment.user.login, 'context.payload.comment.user.login');
        const isBot = comment.user.type === 'Bot';
        if (!isBot && !isSafeSearchToken(comment.user.login)) {
          throw new Error('Bot context invalid: comment.user.login contains invalid characters');
        }
        if (typeof comment.body !== 'string') {
          throw new Error('Bot context invalid: comment.body must be a string');
        }
        payloadPart = { ...payloadPart, comment, isBot };
      }
      break;
    }
    default:
      throw new Error(`Bot context invalid: unsupported event type "${eventType}"`);
  }
  return { ...base, eventType, ...payloadPart };
}

async function addLabels(botContext, labels) {
  if (!Array.isArray(labels)) return { success: false, error: 'labels must be an array' };
  try {
    for (let i = 0; i < labels.length; i++) requireNonEmptyString(labels[i], `labels[${i}]`);
    await botContext.github.rest.issues.addLabels({ owner: botContext.owner, repo: botContext.repo, issue_number: botContext.number, labels });
    getLogger().log(`Added labels: ${labels.join(', ')}`);
    return { success: true };
  } catch (error) {
    getLogger().error(`Could not add labels "${labels.join(', ')}": ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function removeLabel(botContext, labelName) {
  try {
    requireNonEmptyString(labelName, 'labelName');
    await botContext.github.rest.issues.removeLabel({ owner: botContext.owner, repo: botContext.repo, issue_number: botContext.number, name: labelName });
    getLogger().log(`Removed label: ${labelName}`);
    return { success: true };
  } catch (error) {
    getLogger().error(`Could not remove label "${labelName}": ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function addAssignees(botContext, assignees) {
  if (!Array.isArray(assignees)) return { success: false, error: 'assignees must be an array' };
  try {
    for (let i = 0; i < assignees.length; i++) requireSafeUsername(assignees[i], `assignees[${i}]`);
    await botContext.github.rest.issues.addAssignees({ owner: botContext.owner, repo: botContext.repo, issue_number: botContext.number, assignees });
    getLogger().log(`Added assignees: ${assignees.join(', ')}`);
    return { success: true };
  } catch (error) {
    getLogger().error(`Could not add assignees "${assignees.join(', ')}": ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function removeAssignees(botContext, assignees) {
  if (!Array.isArray(assignees)) return { success: false, error: 'assignees must be an array' };
  try {
    for (let i = 0; i < assignees.length; i++) requireSafeUsername(assignees[i], `assignees[${i}]`);
    await botContext.github.rest.issues.removeAssignees({ owner: botContext.owner, repo: botContext.repo, issue_number: botContext.number, assignees });
    getLogger().log(`Removed assignees: ${assignees.join(', ')}`);
    return { success: true };
  } catch (error) {
    getLogger().error(`Could not remove assignees "${assignees.join(', ')}": ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function postComment(botContext, body) {
  try {
    requireNonEmptyString(body, 'comment body');
    await botContext.github.rest.issues.createComment({ owner: botContext.owner, repo: botContext.repo, issue_number: botContext.number, body });
    getLogger().log('Posted comment');
    return { success: true };
  } catch (error) {
    getLogger().error(`Could not post comment: ${error.message}`);
    return { success: false, error: error.message };
  }
}

function hasLabel(issueOrPr, labelName) {
  if (!issueOrPr?.labels?.length) return false;
  return issueOrPr.labels.some((label) => {
    const name = typeof label === 'string' ? label : label?.name;
    return typeof name === 'string' && name.toLowerCase() === labelName.toLowerCase();
  });
}

function getLabelsByPrefix(issueOrPr, prefix) {
  return (issueOrPr.labels || [])
    .map((l) => (typeof l === 'string' ? l : l?.name || ''))
    .filter((name) => name.toLowerCase().startsWith(prefix.toLowerCase()));
}

async function swapLabels(botContext, fromLabel, toLabel) {
  const errors = [];
  const removeResult = await removeLabel(botContext, fromLabel);
  if (!removeResult.success) errors.push(`Failed to remove '${fromLabel}': ${removeResult.error}`);
  const addResult = await addLabels(botContext, [toLabel]);
  if (!addResult.success) errors.push(`Failed to add '${toLabel}': ${addResult.error}`);
  return { success: errors.length === 0, errorDetails: errors.join('; ') };
}

async function getBotComment(botContext, marker) {
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data: comments } = await botContext.github.rest.issues.listComments({ owner: botContext.owner, repo: botContext.repo, issue_number: botContext.number, per_page: perPage, page });
    for (const c of comments) { if (c.body && c.body.startsWith(marker)) return c; }
    if (comments.length < perPage) break;
    page++;
  }
  return null;
}

async function postOrUpdateComment(botContext, marker, body) {
  try {
    requireNonEmptyString(marker, 'marker');
    requireNonEmptyString(body, 'comment body');
    const existing = await getBotComment(botContext, marker);
    if (existing) {
      if (existing.body.trim() === body.trim()) {
        getLogger().log('Existing bot comment is up-to-date');
      } else {
        await botContext.github.rest.issues.updateComment({ owner: botContext.owner, repo: botContext.repo, comment_id: existing.id, body });
        getLogger().log('Updated existing bot comment');
      }
    } else {
      await botContext.github.rest.issues.createComment({ owner: botContext.owner, repo: botContext.repo, issue_number: botContext.number, body });
      getLogger().log('Created new bot comment');
    }
    return { success: true };
  } catch (error) {
    getLogger().error(`Could not post/update comment: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function fetchPRCommits(botContext) {
  const commits = [];
  let page = 1;
  while (true) {
    const response = await botContext.github.rest.pulls.listCommits({ owner: botContext.owner, repo: botContext.repo, pull_number: botContext.number, per_page: 100, page });
    commits.push(...response.data);
    if (response.data.length < 100) break;
    page++;
  }
  getLogger().log(`Fetched ${commits.length} commits for PR #${botContext.number}`);
  return commits;
}

async function fetchOpenPRs(botContext) {
  const prs = [];
  let page = 1;
  while (true) {
    const response = await botContext.github.rest.pulls.list({ owner: botContext.owner, repo: botContext.repo, state: 'open', per_page: 100, page });
    prs.push(...response.data);
    if (response.data.length < 100) break;
    page++;
  }
  getLogger().log(`Fetched ${prs.length} open PRs`);
  return prs;
}

async function fetchIssue(botContext, issueNumber) {
  const { data: issue } = await botContext.github.rest.issues.get({ owner: botContext.owner, repo: botContext.repo, issue_number: issueNumber });
  return issue;
}

async function fetchClosingIssueNumbers(botContext) {
  try {
    const query = `query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$number){
          closingIssuesReferences(first:10){ nodes { number } }
        }
      }
    }`;
    const result = await botContext.github.graphql(query, { owner: botContext.owner, repo: botContext.repo, number: botContext.number });
    const nodes = result.repository.pullRequest.closingIssuesReferences.nodes || [];
    return nodes.map(n => n.number);
  } catch (error) {
    getLogger().error(`GraphQL closingIssuesReferences failed: ${error.message}`);
    return [];
  }
}

async function fetchLatestMilestone(botContext) {
  const milestones = [];
  let page = 1;
  try {
    while (true) {
      const { data } = await botContext.github.rest.issues.listMilestones({ owner: botContext.owner, repo: botContext.repo, state: 'open', sort: 'due_on', direction: 'desc', per_page: 100, page });
      milestones.push(...data);
      if (data.length < 100) break;
      page++;
    }
  } catch (error) {
    getLogger().error(`Could not fetch milestones: ${error.message}`);
    return null;
  }
  if (!milestones.length) { getLogger().log('No open milestones found'); return null; }
  const withDue = milestones.filter(m => m.due_on);
  return withDue.length ? withDue.sort((a, b) => new Date(b.due_on) - new Date(a.due_on))[0] : [...milestones].sort((a, b) => b.number - a.number)[0];
}

async function setMilestone(botContext, issueOrPrNumber, milestoneNumber) {
  try {
    requirePositiveInt(issueOrPrNumber, 'issueOrPrNumber');
    requirePositiveInt(milestoneNumber, 'milestoneNumber');
    await botContext.github.rest.issues.update({ owner: botContext.owner, repo: botContext.repo, issue_number: issueOrPrNumber, milestone: milestoneNumber });
    getLogger().log(`Set milestone #${milestoneNumber} on #${issueOrPrNumber}`);
    return { success: true };
  } catch (error) {
    getLogger().error(`Could not set milestone on #${issueOrPrNumber}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function swapStatusLabel(botContext, allPassed, { force = false } = {}) {
  const pr = botContext.pr;
  const toAdd = allPassed ? LABELS.NEEDS_REVIEW : LABELS.NEEDS_REVISION;
  const toRemove = allPassed ? LABELS.NEEDS_REVISION : LABELS.NEEDS_REVIEW;
  const errors = [];
  if (force || hasLabel(pr, toRemove)) {
    const r = await removeLabel(botContext, toRemove);
    if (!r.success) errors.push(`Failed to remove '${toRemove}': ${r.error}`);
  }
  if (force || hasLabel(pr, toRemove)) {
    const a = await addLabels(botContext, [toAdd]);
    if (!a.success) errors.push(`Failed to add '${toAdd}': ${a.error}`);
  }
  return { success: errors.length === 0, errorDetails: errors.join('; ') };
}

async function acknowledgeComment(botContext, commentId) {
  try {
    await botContext.github.rest.reactions.createForIssueComment({ owner: botContext.owner, repo: botContext.repo, comment_id: commentId, content: '+1' });
    getLogger().log('Added thumbs-up reaction to comment');
    return { success: true };
  } catch (error) {
    getLogger().log('Could not add reaction:', error.message);
    return { success: false };
  }
}

async function runAllChecksAndComment(botContext, precomputed = {}) {
  let { merge, issueLink } = precomputed;
  if (!merge) { try { merge = await checkMergeConflict(botContext); } catch (e) { merge = { error: true, errorMessage: e.message }; } }
  if (!issueLink) { try { issueLink = await checkIssueLink(botContext, { fetchIssue, fetchClosingIssueNumbers }); } catch (e) { issueLink = { error: true, errorMessage: e.message }; } }
  const prAuthor = botContext.pr?.user?.login;
  const { marker, body, allPassed } = buildBotComment({ prAuthor, merge, issueLink });
  await postOrUpdateComment(botContext, marker, body);
  return { allPassed };
}

async function fetchIssueEvents(botContext) {
  const events = [];
  let page = 1;
  while (true) {
    const { data } = await botContext.github.rest.issues.listEvents({ owner: botContext.owner, repo: botContext.repo, issue_number: botContext.number, per_page: 100, page });
    events.push(...data);
    if (data.length < 100) break;
    page++;
  }
  getLogger().log(`Fetched ${events.length} events for #${botContext.number}`);
  return events;
}

async function fetchComments(botContext) {
  const comments = [];
  let page = 1;
  while (true) {
    const { data } = await botContext.github.rest.issues.listComments({ owner: botContext.owner, repo: botContext.repo, issue_number: botContext.number, per_page: 100, page });
    comments.push(...data);
    if (data.length < 100) break;
    page++;
  }
  getLogger().log(`Fetched ${comments.length} comments for #${botContext.number}`);
  return comments;
}

async function closeItem(botContext) {
  try {
    await botContext.github.rest.issues.update({ owner: botContext.owner, repo: botContext.repo, issue_number: botContext.number, state: 'closed' });
    getLogger().log(`Closed #${botContext.number}`);
    return { success: true };
  } catch (error) {
    getLogger().error(`Could not close #${botContext.number}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function resolveLinkedIssue(botContext) {
  try {
    const issueNumbers = await fetchClosingIssueNumbers(botContext);
    if (!issueNumbers.length) { getLogger().log('No linked issue found', { prNumber: botContext.number }); return null; }
    if (issueNumbers.length === 1) {
      const issue = await fetchIssue(botContext, issueNumbers[0]);
      if (!issue || SKILL_HIERARCHY.findIndex(level => hasLabel(issue, level)) === -1) { getLogger().log('Single linked issue has no skill label', { issueNumber: issueNumbers[0] }); return null; }
      return issue;
    }
    const issues = (await Promise.all(issueNumbers.map(n => fetchIssue(botContext, n)))).filter(Boolean);
    if (!issues.length) { getLogger().log('All linked issue fetches returned empty', { issueNumbers }); return null; }
    const selected = issues.reduce((best, issue) => {
      const bestIdx = SKILL_HIERARCHY.findIndex(level => hasLabel(best, level));
      const curIdx = SKILL_HIERARCHY.findIndex(level => hasLabel(issue, level));
      return curIdx > bestIdx ? issue : best;
    });
    if (SKILL_HIERARCHY.findIndex(level => hasLabel(selected, level)) === -1) { getLogger().log('No linked issues have a skill label', { issueNumbers }); return null; }
    getLogger().log('Multiple linked issues found (using highest level)', { issueNumbers, selected: selected.number });
    return selected;
  } catch (error) {
    getLogger().error('Failed to resolve linked issue:', { message: error.message });
    return null;
  }
}

function getHighestIssueSkillLevel(issue) {
  for (const level of [...SKILL_HIERARCHY].reverse()) { if (hasLabel(issue, level)) return level; }
  return null;
}

async function countIssuesByAssignee(github, owner, repo, username, state, label = null, threshold = null) {
  if (!isSafeSearchToken(owner) || !isSafeSearchToken(repo) || !isSafeSearchToken(username)) {
    getLogger().log('[assign] Invalid search inputs:', { owner, repo, username, label }); return null;
  }
  if (state !== ISSUE_STATE.OPEN && state !== ISSUE_STATE.CLOSED) { getLogger().log('[assign] Invalid state:', { state }); return null; }
  if (label && (typeof label !== 'string' || !label.trim() || label.includes('"'))) { getLogger().log('[assign] Invalid label parameter:', { label }); return null; }
  try {
    let page = 1, matchingIssuesCount = 0;
    getLogger().log(`[assign] Fetching ${state} assigned issues via REST...`);
    while (true) {
      const params = { owner, repo, state: state.toLowerCase(), assignee: username, per_page: 100, page };
      if (label) params.labels = label;
      const result = await github.rest.issues.listForRepo(params);
      const actualIssues = result.data.filter(item => !item.pull_request);
      let pageMatchCount = 0;
      if (state === ISSUE_STATE.OPEN && !label) {
        pageMatchCount = actualIssues.filter(issue => !issue.labels?.some(l => (l.name || l) === LABELS.BLOCKED)).length;
      } else { pageMatchCount = actualIssues.length; }
      matchingIssuesCount += pageMatchCount;
      if (threshold !== null && matchingIssuesCount >= threshold) {
        getLogger().log(`[assign] Reached threshold (${threshold}), short-circuiting fetch.`);
        matchingIssuesCount = threshold;
        break;
      }
      if (result.data.length < 100) break;
      page++;
    }
    const suffix = state === ISSUE_STATE.OPEN && !label ? ' (excluding blocked)' : '';
    getLogger().log(`[assign] ${state} assigned issues for ${username}${label ? ` with label ${label}` : suffix}: ${matchingIssuesCount}`);
    return matchingIssuesCount;
  } catch (error) {
    getLogger().log(`[assign] Failed to count ${state} issues for ${username}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function listAssignedIssues(github, owner, repo, username) {
  if (!isSafeSearchToken(owner) || !isSafeSearchToken(repo) || !isSafeSearchToken(username)) {
    getLogger().log('[assign] Invalid search inputs for listAssignedIssues:', { owner, repo, username }); return null;
  }
  try {
    let page = 1;
    const issues = [];
    getLogger().log('[assign] Fetching open assigned issues via REST (objects)...');
    while (true) {
      const result = await github.rest.issues.listForRepo({ owner, repo, state: ISSUE_STATE.OPEN, assignee: username, per_page: 100, page });
      const actualIssues = result.data.filter(item => !item.pull_request);
      const nonBlocked = actualIssues.filter(issue => !issue.labels?.some(l => (l.name || l) === LABELS.BLOCKED));
      issues.push(...nonBlocked);
      if (result.data.length < 100) break;
      page++;
    }
    getLogger().log(`[assign] Open non-blocked assigned issues for ${username}: ${issues.length}`);
    return issues;
  } catch (error) {
    getLogger().log(`[assign] Failed to list assigned issues for ${username}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// closedByPullRequestsReferences only catches closing-keyword PRs
// (Fixes/Closes #N). Sidebar-linked PRs are invisible here.
async function hasNeedsReviewPR(github, owner, repo, username, issueNumber) {
  if (!isSafeSearchToken(owner) || !isSafeSearchToken(repo) || !isSafeSearchToken(username)) {
    getLogger().log('[assign] Invalid search inputs for hasNeedsReviewPR:', { owner, repo, username, issueNumber }); return null;
  }
  if (!Number.isInteger(issueNumber) || issueNumber < 1) { getLogger().log('[assign] Invalid issue number for hasNeedsReviewPR:', { issueNumber }); return null; }
  try {
    getLogger().log(`[assign] Querying linked PRs for issue #${issueNumber}`);
    const query = `query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){
        issue(number:$number){
          closedByPullRequestsReferences(first:50){
            nodes { state, author { login }, labels(first:50) { nodes { name } } }
          }
        }
      }
    }`;
    const result = await github.graphql(query, { owner, repo, number: issueNumber });
    const nodes = result.repository?.issue?.closedByPullRequestsReferences?.nodes || [];
    const match = nodes.some(pr => pr.author?.login === username && pr.state === 'OPEN' && pr.labels?.nodes?.some(l => l.name === LABELS.NEEDS_REVIEW));
    getLogger().log(`[assign] Needs-review PR search for issue #${issueNumber}: ${match ? 1 : 0} match(es)`);
    return match;
  } catch (error) {
    getLogger().log(`[assign] Failed to search for needs-review PRs for issue #${issueNumber}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

module.exports = {
  buildBotContext, addLabels, removeLabel, addAssignees, removeAssignees, postComment, hasLabel, getLabelsByPrefix,
  swapLabels, getBotComment, postOrUpdateComment, fetchPRCommits, fetchOpenPRs, fetchIssue, fetchClosingIssueNumbers,
  fetchLatestMilestone, setMilestone, swapStatusLabel, runAllChecksAndComment, resolveLinkedIssue, acknowledgeComment,
  fetchComments, fetchIssueEvents, closeItem, getHighestIssueSkillLevel, countIssuesByAssignee, listAssignedIssues, hasNeedsReviewPR,
};
