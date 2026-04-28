#!/usr/bin/env node
/**
 * Centralized path resolution for workflow state directories.
 *
 * Default state root: ~/.claude-workflows/
 * Override via env var: CLAUDE_WORKFLOW_STATE_DIR
 *
 * Layout (v2 — repo-scoped):
 *   <state-root>/
 *     active/
 *       <repo-key>/                  ← per-repo bucket (current layout)
 *         <id>.org
 *         <id>.state.json
 *       <id>.state.json              ← legacy flat files (still readable)
 *     completed/<repo-key>/...
 *     context/<project-slug>.md
 *     memory/<project-slug>.md
 *     plans/...
 *
 * Why repo-scoped? Workflows started in different repos otherwise share a global
 * directory and the SessionStart hook lists every workflow as if it belonged to
 * the current repo. The repo-key (see lib/repo-key.js) is derived from the git
 * remote URL or repo path so it is stable across machines and clones.
 *
 * Why not ~/.claude/workflows/?
 * Claude Code has hardcoded write protection on any path containing .claude/
 * as a directory component. Only .claude/commands/, .claude/agents/, and
 * .claude/skills/ are exempt. Storing state under ~/.claude-workflows/ avoids
 * this protection entirely.
 */

'use strict';

const path = require('path');
const os = require('os');
const { getRepoKey } = require('./repo-key');

/**
 * Get the base state directory.
 * Respects CLAUDE_WORKFLOW_STATE_DIR env var override.
 * @returns {string} Absolute path to the workflow state directory
 */
function getStateDir() {
  if (process.env.CLAUDE_WORKFLOW_STATE_DIR) {
    return path.resolve(process.env.CLAUDE_WORKFLOW_STATE_DIR);
  }
  return path.join(os.homedir(), '.claude-workflows');
}

/**
 * Base "active" directory — parent of all per-repo buckets.
 * Used for cross-repo discovery and legacy-layout migration.
 */
function getActiveBaseDir() {
  return path.join(getStateDir(), 'active');
}

/**
 * Repo-scoped active directory.
 * @param {Object} [opts]
 * @param {string} [opts.repoKey] - explicit repo key (defaults to current cwd's key)
 * @param {string} [opts.cwd] - working directory used to derive the key
 * @returns {string} <state-root>/active/<repo-key>
 */
function getActiveDir(opts) {
  const o = opts || {};
  const key = o.repoKey || getRepoKey(o.cwd);
  return path.join(getActiveBaseDir(), key);
}

function getCompletedBaseDir() {
  return path.join(getStateDir(), 'completed');
}

function getCompletedDir(opts) {
  const o = opts || {};
  const key = o.repoKey || getRepoKey(o.cwd);
  return path.join(getCompletedBaseDir(), key);
}

function getContextDir() {
  return path.join(getStateDir(), 'context');
}

function getMemoryDir() {
  return path.join(getStateDir(), 'memory');
}

function getPlansDir() {
  return path.join(getStateDir(), 'plans');
}

function getHookLogPath() {
  return path.join(getStateDir(), 'hook.log');
}

function getTranslateDir() {
  return path.join(getStateDir(), 'translate');
}

/**
 * Get the tilde-prefixed path for display in documentation/settings.
 * Returns ~-prefixed path if under home, otherwise the absolute path.
 * @returns {string} Display-friendly path (e.g., ~/.claude-workflows)
 */
function getDisplayPath() {
  const stateDir = getStateDir();
  const home = os.homedir();
  if (stateDir === home || stateDir.startsWith(home + path.sep)) {
    return '~' + stateDir.slice(home.length);
  }
  return stateDir;
}

/**
 * Get all directories that need to exist for the workflow plugin to function.
 * Includes the current repo's active/completed buckets when applicable.
 * @returns {string[]} Array of absolute directory paths
 */
function getAllDirectories() {
  const dirs = [
    getStateDir(),
    getActiveBaseDir(),
    getCompletedBaseDir(),
    getContextDir(),
    getMemoryDir(),
    getPlansDir(),
    // Skills directories remain under ~/.claude/skills/ (CC exempt path)
    path.join(os.homedir(), '.claude', 'skills'),
    path.join(os.homedir(), '.claude', 'skills', 'learned'),
  ];
  try {
    dirs.push(getActiveDir());
    dirs.push(getCompletedDir());
  } catch {
    // If repo-key resolution fails for any reason, skip the per-repo dirs.
    // The base dirs above are always sufficient for the plugin to start.
  }
  return dirs;
}

module.exports = {
  getStateDir,
  getActiveDir,
  getActiveBaseDir,
  getCompletedDir,
  getCompletedBaseDir,
  getContextDir,
  getMemoryDir,
  getPlansDir,
  getHookLogPath,
  getTranslateDir,
  getDisplayPath,
  getAllDirectories,
};
