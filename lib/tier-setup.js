#!/usr/bin/env node
/**
 * Startup setup check for the workflow plugin, plus the consent-based fixes.
 *
 * This module owns all the logic: it reads <config dir>/CLAUDE.md,
 * <config dir>/settings.json, <state dir>/preferences.json and the scrub
 * denylist, and it holds the only write paths (applyBlock, decline,
 * setFallbackPreference, addUserFallbackModel). The SessionStart hook only reads;
 * the setup skill asks the user before it calls any write command.
 *
 * Usage:
 *   node lib/tier-setup.js status
 *   node lib/tier-setup.js show
 *   node lib/tier-setup.js apply
 *   node lib/tier-setup.js decline
 *   node lib/tier-setup.js set-fallback <value>
 *   node lib/tier-setup.js add-fallback-model <model>[,<model>...]
 *
 * Exit codes: 0 = ok, 1 = runtime error, 2 = usage error.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getStateDir } = require('./paths');
const { loadDenylist } = require('./scrub-cli');

const TIER_BLOCK_VERSION = 1;
const START_MARKER = `<!-- workflow-plugin:tiers v${TIER_BLOCK_VERSION} -->`;
const END_MARKER = '<!-- /workflow-plugin:tiers -->';

// The block the setup skill writes into the user's global CLAUDE.md. Bump
// TIER_BLOCK_VERSION whenever this text changes, so installed copies are
// reported as outdated and offered the new text.
const TIER_BLOCK = [
  START_MARKER,
  '## Model tiers (workflow plugin)',
  '',
  '- Orchestrator: the main session, on `opus`. It plans the run, talks to the user and delegates; it does not do worker or judge work itself.',
  '- Judge (`fable`, falls back to `opus`): planning judgement, architecture, code and security review, completion sign-off.',
  '- Worker (`sonnet`): exploration, coding from a plan, tests, fixes, verification of findings.',
  '- Mechanical (`haiku`): scoping a review, merging duplicate findings.',
  '',
  'For code changes, reach for the saved workflows instead of doing the work inline:',
  '- `/workflow:do <task>`: plan, questions, implement, review and sign-off in one go.',
  '- `/workflow:plan`, `/workflow:implement`, `/workflow:review`: one stage at a time.',
  END_MARKER,
].join('\n');

const ITEM_MISSING = 'model tier block missing from the global CLAUDE.md';
const ITEM_OUTDATED = 'model tier block in the global CLAUDE.md is outdated';
const ITEM_MODEL = 'default model is not opus';
const ITEM_DENYLIST = 'scrub denylist cannot be read';

// Matches the LAST start marker before an end marker, so an orphan start marker
// earlier in the file can never widen the span that gets replaced.
const BLOCK_RE = /<!-- workflow-plugin:tiers v(\d+) -->(?:(?!<!-- workflow-plugin:tiers v\d+ -->)[\s\S])*?<!-- \/workflow-plugin:tiers -->/;

// --- Read helpers (never throw; any error means "absent") ---------------------

function getConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function readPreferences(stateDir) {
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(stateDir, 'preferences.json'), 'utf8'));
    return isPlainObject(obj) ? obj : {};
  } catch {
    return {};
  }
}

function readInstalledBlockVersion(claudeMd) {
  try {
    const m = BLOCK_RE.exec(fs.readFileSync(claudeMd, 'latin1'));
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

function readSettingsModel(settingsFile) {
  try {
    const obj = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return isPlainObject(obj) && typeof obj.model === 'string' ? obj.model : null;
  } catch {
    return null;
  }
}

function readDenylistState(env) {
  const configured = env.CLAUDE_WORKFLOW_SCRUB_DENYLIST;
  // An empty argument makes loadDenylist fall back to process.env.
  if (typeof configured !== 'string' || configured === '') {
    return { status: 'not_configured', configured: configured || null, error: null };
  }
  const result = loadDenylist(configured);
  return { status: result.status, configured, error: result.error || null };
}

// --- Check --------------------------------------------------------------------

function inspect({ env = process.env, configDir, stateDir } = {}) {
  const config_dir = configDir || getConfigDir(env);
  const state_dir = stateDir || getStateDir();
  const claude_md = path.join(config_dir, 'CLAUDE.md');
  const settings_file = path.join(config_dir, 'settings.json');
  const installed = readInstalledBlockVersion(claude_md);
  const model = readSettingsModel(settings_file);
  const preferences = readPreferences(state_dir);
  const denylist = readDenylistState(env);

  const declined = Number.isInteger(preferences.tier_block_declined_version)
    && preferences.tier_block_declined_version >= TIER_BLOCK_VERSION;

  const items = [];
  if (!declined) {
    if (installed === null) items.push(ITEM_MISSING);
    else if (installed < TIER_BLOCK_VERSION) items.push(ITEM_OUTDATED);
    if (model === null || !model.toLowerCase().includes('opus')) items.push(ITEM_MODEL);
  }
  if (denylist.status === 'unreadable') items.push(ITEM_DENYLIST);

  return {
    items,
    block_version: TIER_BLOCK_VERSION,
    installed_block_version: installed,
    claude_md,
    settings_file,
    model,
    preferences,
    denylist,
  };
}

function checkSetup(opts) {
  return inspect(opts).items;
}

function formatReminder(items) {
  if (!items || items.length === 0) return '';
  return `workflow plugin setup: ${items.join('; ')}. Run /workflow:setup to fix or dismiss.`;
}

// --- Writes (the only write path is writeThroughSymlink) ----------------------

function writeThroughSymlink(file, data) {
  let real;
  let mode = null;
  if (fs.existsSync(file)) {
    real = fs.realpathSync(file);
    mode = fs.statSync(real).mode & 0o777;
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    real = file;
  }
  const temp = path.join(path.dirname(real), `.${path.basename(real)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temp, data);
    if (mode !== null) fs.chmodSync(temp, mode);
    fs.renameSync(temp, real);
  } catch (err) {
    try { fs.unlinkSync(temp); } catch { /* temp may not exist */ }
    throw err;
  }
}

function applyBlock(file) {
  let existing = Buffer.alloc(0);
  try {
    existing = fs.readFileSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const block = Buffer.from(TIER_BLOCK, 'utf8');
  const m = BLOCK_RE.exec(existing.toString('latin1'));
  let out;
  if (m) {
    out = Buffer.concat([existing.subarray(0, m.index), block, existing.subarray(m.index + m[0].length)]);
  } else if (existing.length === 0) {
    out = Buffer.concat([block, Buffer.from('\n')]);
  } else {
    const text = existing.toString('latin1');
    const separator = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    out = Buffer.concat([existing, Buffer.from(separator), block, Buffer.from('\n')]);
  }
  writeThroughSymlink(file, out);
  return file;
}

function writePreferences(stateDir, patch) {
  const obj = Object.assign(readPreferences(stateDir), patch);
  const file = path.join(stateDir, 'preferences.json');
  writeThroughSymlink(file, JSON.stringify(obj, null, 2) + '\n');
  return file;
}

function decline(stateDir) {
  return writePreferences(stateDir, { tier_block_declined_version: TIER_BLOCK_VERSION });
}

// Same rule as checkFallback in workflows/*.js: a stored value that fails it
// would make every later workflow run throw.
const FALLBACK_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]*$/;

function isValidFallbackValue(value) {
  return typeof value === 'string' && (value === 'none' || FALLBACK_VALUE_RE.test(value));
}

function setFallbackPreference(stateDir, value) {
  if (!isValidFallbackValue(value)) {
    throw new TypeError(`judge_fallback must be a model alias or id, or "none" (got ${JSON.stringify(value)})`);
  }
  return writePreferences(stateDir, { judge_fallback: value });
}

function addUserFallbackModel(settingsFile, models) {
  let obj = {};
  if (fs.existsSync(settingsFile)) {
    try {
      obj = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    } catch {
      throw new Error(`${settingsFile} is not valid JSON; not modified`);
    }
    if (!isPlainObject(obj)) throw new Error(`${settingsFile} is not a JSON object; not modified`);
  }
  obj.fallbackModel = models;
  writeThroughSymlink(settingsFile, JSON.stringify(obj, null, 2) + '\n');
  return settingsFile;
}

// --- CLI ----------------------------------------------------------------------

function fail(msg) {
  process.stderr.write(`tier-setup: ${msg}\n`);
  process.exit(2);
}

function runCli(argv) {
  const [command, value] = argv;
  const configDir = getConfigDir(process.env);
  const stateDir = getStateDir();
  const out = (s) => process.stdout.write(s + '\n');

  switch (command) {
    case undefined:
      return fail('usage: status | show | apply | decline | set-fallback <value> | add-fallback-model <list>');
    case 'status':
      return out(JSON.stringify(inspect(), null, 2));
    case 'show':
      return out(TIER_BLOCK);
    case 'apply':
      return out(`wrote tier block to ${applyBlock(path.join(configDir, 'CLAUDE.md'))}`);
    case 'decline':
      decline(stateDir);
      return out('declined: the setup reminder stays quiet until a newer block ships');
    case 'set-fallback':
      if (!value) return fail('set-fallback needs a value');
      if (argv.length > 2) return fail('set-fallback takes exactly one value; quote it if it has spaces');
      if (!isValidFallbackValue(value)) {
        return fail('set-fallback value must be a model alias or id (no spaces), or "none"');
      }
      setFallbackPreference(stateDir, value);
      return out(`judge_fallback set to ${value}`);
    case 'add-fallback-model': {
      const models = (value || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (models.length === 0) return fail('add-fallback-model needs at least one model');
      return out(`wrote fallbackModel to ${addUserFallbackModel(path.join(configDir, 'settings.json'), models)}`);
    }
    default:
      return fail(`unknown command: ${command}`);
  }
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`tier-setup: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  TIER_BLOCK_VERSION, START_MARKER, END_MARKER, TIER_BLOCK,
  checkSetup, formatReminder, inspect, applyBlock, decline,
  setFallbackPreference, addUserFallbackModel,
};
