// SPDX-License-Identifier: Apache-2.0

const { MAINTAINER_TEAM, DOCUMENTATION } = require('./constants.cjs');
const MARKER = '<!-- bot:pr-helper -->';
const SIGNING_GUIDE = DOCUMENTATION.signingGuide;
const MERGE_CONFLICTS_GUIDE = DOCUMENTATION.mergeConflictsGuide;

function checkState(result) {
  if (result.error) return 'error';
  return result.passed ? 'pass' : 'fail';
}

function buildSection({ title, result, passMessage }) {
  const state = checkState(result);
  if (state === 'error') {
    return `:warning: **${title}** -- This check encountered an internal error. ${MAINTAINER_TEAM} please review manually.\n\nError: ${result.errorMessage || 'Unknown error'}`;
  }
  if (state === 'pass') return `:white_check_mark: **${title}** -- ${passMessage}`;
  return null;
}

function buildDCOSection(dco) {
  const common = buildSection({ title: 'DCO Sign-off', result: dco, passMessage: 'All commits have valid sign-offs. Nice work!' });
  if (common) return common;
  const list = (dco.failures || []).map(f => `- \`${f.sha}\` ${f.message}`).join('\n');
  return `:x: **DCO Sign-off** -- Uh oh! The following commits are missing the required DCO sign-off:\n${list}\n\nNo worries, this is an easy fix! Add \`Signed-off-by: Your Name <email>\` to each commit (e.g. \`git commit -s\`). See the [Signing Guide](${SIGNING_GUIDE}).`;
}

function buildGPGSection(gpg) {
  const common = buildSection({ title: 'GPG Signature', result: gpg, passMessage: 'All commits have verified GPG signatures. Locked and loaded!' });
  if (common) return common;
  const list = (gpg.failures || []).map(f => `- \`${f.sha}\` ${f.message}`).join('\n');
  return `:x: **GPG Signature** -- Heads up! The following commits don't have a verified GPG signature:\n${list}\n\nYou'll need to sign your commits with GPG (e.g. \`git commit -S\`). See the [Signing Guide](${SIGNING_GUIDE}) for a step-by-step walkthrough.`;
}

function buildMergeSection(merge) {
  const common = buildSection({ title: 'Merge Conflicts', result: merge, passMessage: 'No merge conflicts detected. Smooth sailing!' });
  if (common) return common;
  return `:x: **Merge Conflicts** -- Oh no, this PR has merge conflicts with the base branch.\n\nLet's get this sorted! Update your branch (e.g. rebase or merge from base) and push. See the [Merge Conflicts Guide](${MERGE_CONFLICTS_GUIDE}) if you need a hand.`;
}

function buildMergeConflictNotificationComment(prAuthor, mergedPRNumber) {
  return `Hi @${prAuthor} :wave: — the recent merge of PR #${mergedPRNumber} has introduced a merge conflict in this PR. Please resolve the merge conflict so that this PR can be reviewed again. Thank you!`;
}

function buildIssueLinkSection(issueLink) {
  const linked = (issueLink.issues || []).filter(i => i.isAssigned).map(i => `#${i.number}`).join(', ');
  const common = buildSection({ title: 'Issue Link', result: issueLink, passMessage: `Linked to ${linked} (assigned to you).` });
  if (common) return common;
  if (issueLink.reason === 'not_assigned') {
    const unassigned = (issueLink.issues || []).filter(i => !i.isAssigned).map(i => `#${i.number}`).join(', ');
    return `:x: **Issue Link** -- Almost there! You are not assigned to the following linked issues: ${unassigned}.\n\nPlease ensure you are assigned to all linked issues before opening a PR. You can comment \`/assign\` on the issue to grab it!`;
  }
  return `:x: **Issue Link** -- This PR is not linked to any issue.\n\nPlease reference an issue using a closing keyword (e.g. \`Fixes #123\`) and ensure the issue is assigned to you. Every PR needs a home!`;
}

function buildChecksSection({ merge, issueLink }) {
  return `### PR Checks\n\n${buildMergeSection(merge)}\n\n---\n\n${buildIssueLinkSection(issueLink)}`;
}

function allChecksPassed({ merge, issueLink }) {
  return !merge.error && merge.passed && !issueLink.error && issueLink.passed;
}

function buildBotComment({ prAuthor, merge, issueLink }) {
  const greeting = `Hey @${prAuthor} :wave: thanks for the PR!\nI'm your friendly **PR Helper Bot** :robot: and I'll be riding shotgun on this one, keeping track of your PR's status to help you get it approved and merged.\n\nThis comment updates automatically as you push changes -- think of it as your PR's live scoreboard!\nHere's the latest:`;
  const checksSection = buildChecksSection({ merge, issueLink });
  const passed = allChecksPassed({ merge, issueLink });
  const footer = passed ? ':tada: *All checks passed! Your PR is ready for review. Great job!*' : ':hourglass_flowing_sand: *All checks must pass before this PR can be reviewed. You\'ve got this!*';
  return { marker: MARKER, body: [MARKER, greeting, '', '---', '', checksSection, '', '---', '', footer].join('\n'), allPassed: passed };
}

module.exports = { MARKER, buildBotComment, buildChecksSection, allChecksPassed, buildMergeConflictNotificationComment };
