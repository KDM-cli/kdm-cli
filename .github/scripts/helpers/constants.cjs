// SPDX-License-Identifier: Apache-2.0

const { loadAutomationConfig, buildConstants } = require('./config-loader.cjs');
const AUTOMATION_CONFIG = loadAutomationConfig();
const derived = buildConstants(AUTOMATION_CONFIG);

const MAINTAINER_TEAM = derived.MAINTAINER_TEAM;
const GFI_SUPPORT_TEAM = derived.GFI_SUPPORT_TEAM;
const LABELS = derived.LABELS;
const SKILL_HIERARCHY = derived.SKILL_HIERARCHY;
const PRIORITY_HIERARCHY = derived.PRIORITY_HIERARCHY;
const SKILL_PREREQUISITES = derived.SKILL_PREREQUISITES;
const DOCUMENTATION = derived.DOCUMENTATION;
const COMMUNITY = derived.COMMUNITY;

const ISSUE_STATE = Object.freeze({ OPEN: 'open', CLOSED: 'closed' });

module.exports = { MAINTAINER_TEAM, GFI_SUPPORT_TEAM, LABELS, ISSUE_STATE, SKILL_HIERARCHY, SKILL_PREREQUISITES, PRIORITY_HIERARCHY, DOCUMENTATION, COMMUNITY, AUTOMATION_CONFIG };
