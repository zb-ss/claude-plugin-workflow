#!/usr/bin/env node
/**
 * deps.js: dependency check and Playwright resolution for the demo recorder.
 *
 * Pure logic with injectable lookups, so the resolution order and the check can be
 * tested without playwright, a browser or ffmpeg installed.
 *
 * CLI: node deps.js check [--mode page|screen] [--project <dir>]
 *      prints JSON { ok, mode, missing, items } and exits 0 whether or not something is missing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PLAYWRIGHT_INSTALL = 'npm install -D playwright';
const CHROMIUM_INSTALL = 'npx playwright install chromium';
const FFMPEG_INSTALL = 'install ffmpeg with the system package manager, for example apt install ffmpeg or brew install ffmpeg';
const XVFB_INSTALL = 'apt install xvfb';

const DEFAULT_LOOKUPS = {
  exists: (p) => fs.existsSync(p),
  npmRoot: () => {
    try {
      const out = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return out.trim() || null;
    } catch (err) {
      return null;
    }
  },
  load: (dir) => require(dir),
  run: (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return null;
    }
  },
};

/**
 * Find an installed playwright package directory.
 * Order: PLAYWRIGHT_MODULE_PATH, NODE_PATH entries, <project>/node_modules, global npm root.
 * The global npm root is only queried when nothing earlier exists.
 */
function resolvePlaywright({ env = process.env, project_dir = process.cwd(), lookups = DEFAULT_LOOKUPS } = {}) {
  const tried = [];
  const check = (dir, source) => {
    tried.push(dir);
    return lookups.exists(path.join(dir, 'package.json')) ? { dir, source, tried } : null;
  };

  if (env.PLAYWRIGHT_MODULE_PATH) {
    const hit = check(env.PLAYWRIGHT_MODULE_PATH, 'PLAYWRIGHT_MODULE_PATH');
    if (hit) return hit;
  }
  for (const entry of (env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
    const hit = check(path.join(entry, 'playwright'), 'NODE_PATH');
    if (hit) return hit;
  }
  const project_hit = check(path.join(project_dir, 'node_modules', 'playwright'), 'project');
  if (project_hit) return project_hit;

  const global_root = lookups.npmRoot();
  if (global_root) {
    const hit = check(path.join(global_root, 'playwright'), 'global');
    if (hit) return hit;
  }
  return { dir: null, source: null, tried };
}

function requirePlaywright(options = {}) {
  const lookups = options.lookups || DEFAULT_LOOKUPS;
  const found = resolvePlaywright(options);
  if (!found.dir) {
    throw new Error(
      'record-demo: the playwright module was not found. Install it in the project (' + PLAYWRIGHT_INSTALL
      + ') or globally (npm install -g playwright), then download a browser (' + CHROMIUM_INSTALL
      + '), or set PLAYWRIGHT_MODULE_PATH to an installed playwright package directory. Looked in: '
      + found.tried.join(', ')
    );
  }
  return lookups.load(found.dir);
}

/** Chromium executable: RECORD_DEMO_CHROMIUM when it exists, else Playwright's own build, else null. */
function findChromium(pw, { env = process.env, lookups = DEFAULT_LOOKUPS } = {}) {
  if (env.RECORD_DEMO_CHROMIUM && lookups.exists(env.RECORD_DEMO_CHROMIUM)) return env.RECORD_DEMO_CHROMIUM;
  try {
    const exe = pw && pw.chromium && pw.chromium.executablePath();
    if (exe && lookups.exists(exe)) return exe;
  } catch (err) {
    // no browser build for this Playwright version
  }
  return null;
}

function xvfbItem(lookups) {
  if (process.platform !== 'linux') {
    return { name: 'xvfb', ok: false, detail: 'screen mode is Linux only', install: XVFB_INSTALL };
  }
  const out = lookups.run('Xvfb', ['-help']);
  return {
    name: 'xvfb',
    ok: out !== null,
    detail: out !== null ? 'Xvfb found' : 'Xvfb not found on PATH',
    install: XVFB_INSTALL,
  };
}

function checkDependencies({ mode = 'page', env = process.env, project_dir = process.cwd(), lookups = DEFAULT_LOOKUPS } = {}) {
  const items = [{ name: 'node', ok: true, detail: process.version }];

  const found = resolvePlaywright({ env, project_dir, lookups });
  items.push({
    name: 'playwright',
    ok: Boolean(found.dir),
    detail: found.dir ? found.dir + ' (' + found.source + ')' : 'not found; looked in: ' + found.tried.join(', '),
    install: PLAYWRIGHT_INSTALL,
  });

  let chromium_path = null;
  let chromium_detail = 'needs the playwright module';
  if (found.dir) {
    try {
      chromium_path = findChromium(lookups.load(found.dir), { env, lookups });
    } catch (err) {
      chromium_path = null;
    }
    chromium_detail = chromium_path || 'no Chromium build found';
  }
  items.push({ name: 'chromium', ok: Boolean(chromium_path), detail: chromium_detail, install: CHROMIUM_INSTALL });

  const ffmpeg_out = lookups.run('ffmpeg', ['-version']);
  items.push({
    name: 'ffmpeg',
    ok: ffmpeg_out !== null && ffmpeg_out.trim() !== '',
    detail: ffmpeg_out ? ffmpeg_out.split('\n')[0] : 'ffmpeg not found on PATH',
    install: FFMPEG_INSTALL,
  });

  if (mode === 'screen') items.push(xvfbItem(lookups));

  const missing = items.filter((item) => !item.ok).map((item) => item.name);
  return { ok: missing.length === 0, mode, missing, items };
}

function parseArgs(argv) {
  const opts = { mode: 'page', project_dir: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode') opts.mode = argv[++i];
    else if (argv[i] === '--project') opts.project_dir = path.resolve(argv[++i] || '.');
  }
  return opts;
}

function main(argv) {
  const [command, ...rest] = argv;
  const opts = parseArgs(rest);
  if (command !== 'check' || !['page', 'screen'].includes(opts.mode)) {
    process.stderr.write('usage: node deps.js check [--mode page|screen] [--project <dir>]\n');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(JSON.stringify(checkDependencies(opts), null, 2) + '\n');
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { resolvePlaywright, requirePlaywright, findChromium, checkDependencies, DEFAULT_LOOKUPS };
