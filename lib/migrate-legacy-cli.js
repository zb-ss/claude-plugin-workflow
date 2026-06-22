#!/usr/bin/env node
/**
 * CLI: migrate unscoped legacy flat-root workflow state into repo buckets.
 *
 * Legacy files (created before repo-scoping) live directly in
 * <state-root>/active/ with no `repo_key`, so they belong to no repository and
 * the SessionStart hook can only flag them. This tool resolves them, either:
 *   - assign:  stamp repo_key/repo_root (derived from a target repo's cwd) and
 *              move the state file + its org/md sibling into active/<repo-key>/.
 *   - archive: move the state file + siblings into
 *              completed/_legacy-archived-<date>/ (recoverable, out of scope).
 *
 * Usage:
 *   node lib/migrate-legacy-cli.js list
 *   node lib/migrate-legacy-cli.js assign  <state-file> [target-repo-cwd]
 *   node lib/migrate-legacy-cli.js archive <state-file> [YYYYMMDD]
 *
 * Honors CLAUDE_WORKFLOW_STATE_DIR / CLAUDE_WORKFLOW_REPO_KEY (for tests).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { getActiveDir, getActiveBaseDir, getCompletedBaseDir } = require('./paths');
const { getRepoKey, getRepoRoot } = require('./repo-key');

const ACTIVE_BASE = getActiveBaseDir();

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function fail(msg) {
  process.stderr.write(`migrate-legacy: ${msg}\n`);
  process.exit(1);
}

/** Unscoped flat-root *.state.json files (no repo_key). */
function legacyStateFiles() {
  let entries = [];
  try {
    entries = fs.readdirSync(ACTIVE_BASE, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.state.json')) continue;
    const p = path.join(ACTIVE_BASE, e.name);
    const st = readJson(p);
    if (st && st.repo_key) continue; // already stamped → not legacy
    out.push({ path: p, state: st });
  }
  return out;
}

/** Companion org/md files that share the <id> stem with a state file. */
function siblings(stateFile) {
  const dir = path.dirname(stateFile);
  const stem = path.basename(stateFile).replace(/\.state\.json$/, '');
  return ['.org', '.md']
    .map(ext => path.join(dir, stem + ext))
    .filter(p => fs.existsSync(p));
}

function moveInto(file, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(file));
  fs.renameSync(file, dest);
  return dest;
}

function cmdList() {
  const files = legacyStateFiles().map(f => ({
    path: f.path,
    workflow_id: f.state && f.state.workflow_id,
    branch: f.state && f.state.workflow && f.state.workflow.branch,
    description: f.state && f.state.workflow && f.state.workflow.description,
    phase: f.state && f.state.phase && f.state.phase.current,
  }));
  process.stdout.write(JSON.stringify(files, null, 2) + '\n');
}

function cmdAssign(stateFile, cwd) {
  const abs = path.resolve(stateFile);
  const st = readJson(abs);
  if (!st) fail(`cannot read state file: ${stateFile}`);
  if (st.repo_key) fail(`already stamped (repo_key=${st.repo_key}); nothing to do`);

  const repoKey = getRepoKey(cwd);
  const repoRoot = getRepoRoot(cwd);
  const destDir = getActiveDir({ cwd });
  fs.mkdirSync(destDir, { recursive: true });

  // Move org/md siblings first, then rewrite org_file to the new bucket path.
  const movedSibs = siblings(abs).map(s => moveInto(s, destDir));
  st.repo_key = repoKey;
  st.repo_root = repoRoot;
  if (st.org_file) st.org_file = path.join(destDir, path.basename(st.org_file));

  // Write stamped state into the bucket, then remove the flat-root original.
  const movedState = path.join(destDir, path.basename(abs));
  fs.writeFileSync(movedState, JSON.stringify(st, null, 2) + '\n', 'utf8');
  fs.unlinkSync(abs);

  process.stdout.write(JSON.stringify({
    assigned: st.workflow_id || null,
    repo_key: repoKey,
    repo_root: repoRoot,
    dest: movedState,
    moved: movedSibs,
  }, null, 2) + '\n');
}

function cmdArchive(stateFile, date) {
  const abs = path.resolve(stateFile);
  if (!fs.existsSync(abs)) fail(`no such file: ${stateFile}`);
  const stamp = (date && /^\d{8}$/.test(date)) ? date : 'undated';
  const destDir = path.join(getCompletedBaseDir(), `_legacy-archived-${stamp}`);
  const movedSibs = siblings(abs).map(s => moveInto(s, destDir));
  const movedState = moveInto(abs, destDir);
  process.stdout.write(JSON.stringify({ archived: movedState, moved: movedSibs }, null, 2) + '\n');
}

if (require.main === module) {
  const [cmd, arg1, arg2] = process.argv.slice(2);
  switch (cmd) {
    case 'list':
      cmdList();
      break;
    case 'assign':
      if (!arg1) fail('usage: assign <state-file> [target-repo-cwd]');
      cmdAssign(arg1, arg2);
      break;
    case 'archive':
      if (!arg1) fail('usage: archive <state-file> [YYYYMMDD]');
      cmdArchive(arg1, arg2);
      break;
    default:
      fail('usage: list | assign <state-file> [cwd] | archive <state-file> [YYYYMMDD]');
  }
}

module.exports = { legacyStateFiles, siblings, cmdList, cmdAssign, cmdArchive };
