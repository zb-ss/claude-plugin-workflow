#!/usr/bin/env node
/**
 * Repository-key resolver.
 *
 * Returns a stable, slugified, hashed identifier for the *repository* that owns
 * the given working directory. Used to namespace workflow state files so that
 * workflows started in different repos do not collide.
 *
 * Resolution order (first hit wins):
 *   1. CLAUDE_WORKFLOW_REPO_KEY env var (explicit override; slugified as-is)
 *   2. `git -C <cwd> remote get-url origin` → "<repo-name>-<sha12(remote)>"
 *   3. `git -C <cwd> rev-parse --show-toplevel` → "<basename>-<sha12(realpath)>"
 *   4. realpath of cwd → "<basename>-<sha12(realpath)>"
 *
 * The same logic is exposed as a CLI (lib/repo-key-cli.js) so that skill prompts
 * running in a user shell can compute the identical key. Node is required by the
 * plugin's hooks anyway, so this is portable across Linux, macOS, and WSL/Git-Bash
 * on Windows without depending on platform-specific tools (sha256sum vs. shasum).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'repo';
}

function shortHash(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 12);
}

function realpathSafe(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

function tryGit(cwd, args) {
  try {
    const out = execFileSync('git', ['-C', cwd, ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 1500,
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function repoNameFromRemote(remote) {
  const match = String(remote).match(/[/:]([^/:]+?)(?:\.git)?\/?$/);
  return match ? match[1] : null;
}

/**
 * Compute the repo key for a given working directory.
 * @param {string} [cwd] - working directory (defaults to process.cwd()).
 * @returns {string} stable identifier of the form "<slug>-<12-hex>".
 */
function getRepoKey(cwd) {
  if (process.env.CLAUDE_WORKFLOW_REPO_KEY) {
    return slugify(process.env.CLAUDE_WORKFLOW_REPO_KEY);
  }

  const dir = realpathSafe(path.resolve(cwd || process.cwd()));

  const remote = tryGit(dir, ['remote', 'get-url', 'origin']);
  if (remote) {
    const name = repoNameFromRemote(remote) || 'repo';
    return `${slugify(name)}-${shortHash(remote)}`;
  }

  const top = tryGit(dir, ['rev-parse', '--show-toplevel']);
  if (top) {
    const real = realpathSafe(top);
    return `${slugify(path.basename(real))}-${shortHash(real)}`;
  }

  return `${slugify(path.basename(dir))}-${shortHash(dir)}`;
}

/**
 * Canonical (realpath-normalized) root of the repository that owns `cwd`.
 * Git toplevel when available, else the realpath of cwd. Stored in state as
 * `repo_root` so a workflow is self-describing and matchable across machines
 * and symlinked checkouts.
 * @param {string} [cwd]
 * @returns {string}
 */
function getRepoRoot(cwd) {
  const dir = realpathSafe(path.resolve(cwd || process.cwd()));
  const top = tryGit(dir, ['rev-parse', '--show-toplevel']);
  return realpathSafe(top || dir);
}

module.exports = {
  getRepoKey,
  getRepoRoot,
  slugify,
  shortHash,
  // exposed for tests
  _internals: { repoNameFromRemote, tryGit, realpathSafe },
};
