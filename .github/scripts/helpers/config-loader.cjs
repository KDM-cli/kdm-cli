// SPDX-License-Identifier: Apache-2.0

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../kdm-automation.json');
const REQUIRED_STATUS_KEYS = ['awaitingTriage', 'readyForDev', 'inProgress', 'blocked', 'needsReview', 'needsRevision'];
const REQUIRED_SKILL_KEYS = ['goodFirstIssue', 'beginner', 'intermediate', 'advanced'];
const REQUIRED_PRIORITY_KEYS = ['critical', 'high', 'medium', 'low'];
const REQUIRED_DOC_KEYS = ['workflowGuide', 'readme', 'signingGuide', 'mergeConflictsGuide'];
const REQUIRED_COMMUNITY_KEYS = ['discordChannel'];

const isNonEmptyString = v => typeof v === 'string' && v.trim().length > 0;
const isPositiveInteger = v => Number.isInteger(v) && v > 0;

function validateTeams(config, errors) {
  if (!isNonEmptyString(config.maintainerTeam)) errors.push('maintainerTeam must be a non-empty string');
  if (!isNonEmptyString(config.goodFirstIssueSupportTeam)) errors.push('goodFirstIssueSupportTeam must be a non-empty string');
}

function validateLabels(config, errors) {
  if (!config.labels || typeof config.labels !== 'object') { errors.push('labels must be an object'); return; }
  const map = { status: REQUIRED_STATUS_KEYS, skill: REQUIRED_SKILL_KEYS, priority: REQUIRED_PRIORITY_KEYS };
  for (const [group, keys] of Object.entries(map)) {
    if (!config.labels[group] || typeof config.labels[group] !== 'object') { errors.push(`labels.${group} must be an object`); continue; }
    for (const key of keys) { if (!isNonEmptyString(config.labels[group][key])) errors.push(`labels.${group}.${key} is required and must be a non-empty string`); }
  }
}

function validateSingleHierarchy(config, errors, hierarchyKey, labelGroup) {
  const hierarchy = config[hierarchyKey];
  if (!Array.isArray(hierarchy) || !hierarchy.length) { errors.push(`${hierarchyKey} must be a non-empty array`); return; }
  const seen = new Set();
  for (const entry of hierarchy) {
    if (seen.has(entry)) errors.push(`${hierarchyKey} entry "${entry}" appears more than once`);
    seen.add(entry);
  }
  if (config.labels?.[labelGroup]) {
    const vals = Object.values(config.labels[labelGroup]);
    for (const entry of hierarchy) { if (!vals.includes(entry)) errors.push(`${hierarchyKey} entry "${entry}" not found in labels.${labelGroup} values`); }
  }
}

function validateHierarchies(config, errors) {
  validateSingleHierarchy(config, errors, 'skillHierarchy', 'skill');
  validateSingleHierarchy(config, errors, 'priorityHierarchy', 'priority');
}

function validatePrerequisiteShape(key, prereq, hierarchy, errors) {
  if (!prereq || typeof prereq !== 'object') { errors.push(`skillPrerequisites["${key}"] must be an object`); return; }
  if (!('requiredLabel' in prereq)) errors.push(`skillPrerequisites["${key}"].requiredLabel is required (use null for no prerequisite)`);
  if (!Number.isInteger(prereq.requiredCount) || prereq.requiredCount < 0) errors.push(`skillPrerequisites["${key}"].requiredCount must be a non-negative integer`);
  if (!isNonEmptyString(prereq.displayName)) errors.push(`skillPrerequisites["${key}"].displayName is required and must be a non-empty string`);
  if (prereq.requiredLabel !== null && !isNonEmptyString(prereq.prerequisiteDisplayName)) errors.push(`skillPrerequisites["${key}"].prerequisiteDisplayName is required when requiredLabel is not null`);
  if (prereq.requiredLabel !== null && prereq.requiredLabel !== undefined && !hierarchy.includes(prereq.requiredLabel)) errors.push(`skillPrerequisites["${key}"].requiredLabel "${prereq.requiredLabel}" not found in skillHierarchy`);
}

function validateSkillPrerequisites(config, errors) {
  if (!config.skillPrerequisites || typeof config.skillPrerequisites !== 'object') { errors.push('skillPrerequisites must be an object'); return; }
  if (!Array.isArray(config.skillHierarchy)) return;
  for (const skill of config.skillHierarchy) { if (!config.skillPrerequisites[skill]) errors.push(`skillPrerequisites is missing entry for skillHierarchy value "${skill}"`); }
  for (const [key, prereq] of Object.entries(config.skillPrerequisites)) {
    if (!config.skillHierarchy.includes(key)) errors.push(`skillPrerequisites key "${key}" not found in skillHierarchy`);
    validatePrerequisiteShape(key, prereq, config.skillHierarchy, errors);
  }
}

function validateAssignmentLimits(config, errors) {
  if (!config.assignmentLimits || typeof config.assignmentLimits !== 'object') { errors.push('assignmentLimits must be an object'); return; }
  if (!isPositiveInteger(config.assignmentLimits.maxOpenAssignments)) errors.push('assignmentLimits.maxOpenAssignments must be a positive integer');
  if (!isPositiveInteger(config.assignmentLimits.maxGfiCompletions)) errors.push('assignmentLimits.maxGfiCompletions must be a positive integer');
}

function validateRequiredKeys(config, section, requiredKeys, errors) {
  if (!config[section] || typeof config[section] !== 'object') { errors.push(`${section} must be an object`); return; }
  for (const key of requiredKeys) { if (!isNonEmptyString(config[section][key])) errors.push(`${section}.${key} is required and must be a non-empty string`); }
}

function validatePrLabels(config, errors) {
  const pr = config.prLabels;
  if (!pr || typeof pr !== 'object') return;
  if (pr.type && typeof pr.type === 'object') {
    for (const key of Object.keys(pr.type)) { if (typeof pr.type[key] !== 'string' || !pr.type[key].startsWith('type: ')) errors.push(`prLabels.type["${key}"] must be a string starting with "type: "`); }
  }
  if (pr.size && typeof pr.size === 'object') {
    for (const key of ['xs', 's', 'm', 'l', 'xl']) {
      const e = pr.size[key];
      if (!e || typeof e !== 'object') { errors.push(`prLabels.size["${key}"] must be an object with "label" and "maxChanges"`); continue; }
      if (typeof e.label !== 'string' || !e.label.startsWith('size: ')) errors.push(`prLabels.size["${key}"].label must be a string starting with "size: "`);
    }
  }
  if (pr.module && typeof pr.module === 'object') {
    for (const key of Object.keys(pr.module)) { if (typeof pr.module[key] !== 'string' || !pr.module[key].startsWith('module: ')) errors.push(`prLabels.module["${key}"] must be a string starting with "module: "`); }
  }
  if (pr.complexity && typeof pr.complexity === 'object') {
    for (const key of ['easy', 'medium', 'complex']) {
      const e = pr.complexity[key];
      if (!e || typeof e !== 'object') { errors.push(`prLabels.complexity["${key}"] must be an object with "label" and "maxScore"`); continue; }
      if (typeof e.label !== 'string' || !e.label.startsWith('review: ')) errors.push(`prLabels.complexity["${key}"].label must be a string starting with "review: "`);
    }
  }
  if (pr.modulePaths && typeof pr.modulePaths === 'object') {
    for (const [pattern, mod] of Object.entries(pr.modulePaths)) {
      if (typeof pattern !== 'string' || typeof mod !== 'string') errors.push('prLabels.modulePaths entries must have string keys and string values');
      if (typeof mod === 'string' && pr.module && !pr.module[mod]) errors.push(`prLabels.modulePaths["${pattern}"] references unknown module "${mod}"`);
    }
  }
}

function validateConfig(config) {
  const errors = [];
  validateTeams(config, errors);
  validateLabels(config, errors);
  validateHierarchies(config, errors);
  validateSkillPrerequisites(config, errors);
  validateAssignmentLimits(config, errors);
  validateRequiredKeys(config, 'documentation', REQUIRED_DOC_KEYS, errors);
  validateRequiredKeys(config, 'community', REQUIRED_COMMUNITY_KEYS, errors);
  validatePrLabels(config, errors);
  if (errors.length) throw new Error(`Invalid kdm-automation.json:\n${errors.map(e => `  - ${e}`).join('\n')}`);
}

function loadAutomationConfig(configPath = DEFAULT_CONFIG_PATH) {
  let raw;
  try { raw = fs.readFileSync(configPath, 'utf8'); } catch (err) { throw new Error(`Failed to read automation config at ${configPath}: ${err.message}`); }
  let config;
  try { config = JSON.parse(raw); } catch (err) { throw new Error(`Failed to parse automation config at ${configPath}: ${err.message}`); }
  validateConfig(config);
  return Object.freeze(config);
}

function buildConstants(config) {
  const LABELS = Object.freeze({
    AWAITING_TRIAGE: config.labels.status.awaitingTriage,
    READY_FOR_DEV: config.labels.status.readyForDev,
    IN_PROGRESS: config.labels.status.inProgress,
    BLOCKED: config.labels.status.blocked,
    NEEDS_REVIEW: config.labels.status.needsReview,
    NEEDS_REVISION: config.labels.status.needsRevision,
    GOOD_FIRST_ISSUE: config.labels.skill.goodFirstIssue,
    BEGINNER: config.labels.skill.beginner,
    INTERMEDIATE: config.labels.skill.intermediate,
    ADVANCED: config.labels.skill.advanced,
    PRIORITY_CRITICAL: config.labels.priority.critical,
    PRIORITY_HIGH: config.labels.priority.high,
    PRIORITY_MEDIUM: config.labels.priority.medium,
    PRIORITY_LOW: config.labels.priority.low,
  });
  const SKILL_HIERARCHY = Object.freeze([...config.skillHierarchy]);
  const PRIORITY_HIERARCHY = Object.freeze([...config.priorityHierarchy]);
  const SKILL_PREREQUISITES = Object.freeze(
    Object.fromEntries(Object.entries(config.skillPrerequisites).map(([k, v]) => [k, Object.freeze({ ...v })]))
  );
  return {
    MAINTAINER_TEAM: config.maintainerTeam,
    GFI_SUPPORT_TEAM: config.goodFirstIssueSupportTeam,
    LABELS, SKILL_HIERARCHY, PRIORITY_HIERARCHY, SKILL_PREREQUISITES,
    DOCUMENTATION: Object.freeze({ ...config.documentation }),
    COMMUNITY: Object.freeze({ ...config.community }),
  };
}

module.exports = { DEFAULT_CONFIG_PATH, loadAutomationConfig, buildConstants };
