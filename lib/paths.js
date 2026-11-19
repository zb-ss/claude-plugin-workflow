#!/usr/bin/env node
/**
 * Centralized path resolution for the plugin's state directory.
 *
 * Default state root: ~/.claude-workflows/
 * Override via env var: CLAUDE_WORKFLOW_STATE_DIR
 *
 * Layout:
 *   <state-root>/
 *     preferences.json     <- tier and plugin preferences
 *     statusline.json      <- status line settings
 *     driver/              <- autonomous driver state (see lib/driver-cli.js)
 *     translate/           <- translation state
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

function getTranslateDir() {
  return path.join(getStateDir(), 'translate');
}

module.exports = {
  getStateDir,
  getTranslateDir,
};
