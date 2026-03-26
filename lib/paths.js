#!/usr/bin/env node
/**
 * Centralized path resolution for workflow state directories.
 *
 * Default location: ~/.claude-workflows/
 * Override via env var: CLAUDE_WORKFLOW_STATE_DIR
 *
 * Why not ~/.claude/workflows/?
 * Claude Code has a hardcoded write protection on any path containing
 * .claude/ as a directory component. Only .claude/commands/, .claude/agents/,
 * and .claude/skills/ are exempt. Storing state under ~/.claude-workflows/
 * avoids this protection entirely.
 */

const path = require('path');
const os = require('os');

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

function getActiveDir() {
  return path.join(getStateDir(), 'active');
}

function getCompletedDir() {
  return path.join(getStateDir(), 'completed');
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
 * Get all directories that need to exist for the workflow plugin.
 * @returns {string[]} Array of absolute directory paths
 */
function getAllDirectories() {
  return [
    getStateDir(),
    getActiveDir(),
    getCompletedDir(),
    getContextDir(),
    getMemoryDir(),
    getPlansDir(),
    // Skills directories remain under ~/.claude/skills/ (CC exempt path)
    path.join(os.homedir(), '.claude', 'skills'),
    path.join(os.homedir(), '.claude', 'skills', 'learned'),
  ];
}

module.exports = {
  getStateDir,
  getActiveDir,
  getCompletedDir,
  getContextDir,
  getMemoryDir,
  getPlansDir,
  getHookLogPath,
  getTranslateDir,
  getDisplayPath,
  getAllDirectories,
};
