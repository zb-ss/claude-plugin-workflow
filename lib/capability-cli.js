#!/usr/bin/env node
/**
 * CLI: detect the target repo's technology stack and report which convention
 * skills, CLI tools, and MCP servers a workflow task will need — so a preflight
 * gate can load the right skill or park-block on a missing hard requirement
 * instead of failing mid-run.
 *
 * Reads manifest files in rootDir (composer.json, package.json,
 * requirements.txt, pyproject.toml, setup.py, go.mod, Gemfile) to infer
 * languages, frameworks, and package managers.  All functions are pure and
 * side-effect-free; no network access, no writes.
 *
 * Usage:
 *   node lib/capability-cli.js [rootDir]   # defaults to cwd
 *
 * Output (stdout JSON): the full assess() result — see below for shape.
 * Exit: always 0 (advisory; the gate decides whether to park-block).
 */
'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// ---------------------------------------------------------------------------
// Stack → skill map  (canonical skill names from the user's skill set)
// ---------------------------------------------------------------------------
/**
 * Maps a detected framework/language key to the ordered list of convention
 * skill names that should be loaded for that stack.  Kept as an explicit
 * table so reviewers can audit the mapping in one place and extend it without
 * touching the logic below.
 *
 * Keys are the same strings emitted in `detectStack().frameworks` / `.languages`.
 */
const SKILL_MAP = {
  laravel:  ['laravel-conventions', 'php-conventions'],
  joomla:   ['joomla-conventions'],
  symfony:  ['symfony-conventions', 'php-conventions'],
  php:      ['php-conventions'],
  vue:      ['vue-conventions'],
  react:    [],   // no dedicated skill yet; extend here when one is added
};

/**
 * Languages that are "subsumed" by a detected framework entry: when any of the
 * listed frameworks is present, the bare language-level skill fallback is
 * suppressed.  This prevents php-conventions from being added on top of
 * joomla-conventions (spec: joomla→['joomla-conventions'] only).
 *
 * Key = language name; value = set of framework names that subsume it.
 */
const LANGUAGE_SUBSUMED_BY = {
  php:  new Set(['laravel', 'joomla', 'symfony']),
  node: new Set(['vue', 'react']),
};

// ---------------------------------------------------------------------------
// Tool requirements per language/framework
// ---------------------------------------------------------------------------
const TOOL_MAP = {
  php:    ['php', 'composer'],
  node:   ['node'],
  npm:    ['npm'],
  yarn:   ['yarn'],
  pnpm:   ['pnpm'],
  python: ['python3', 'pytest'],
  go:     ['go'],
  ruby:   ['ruby', 'bundle'],
};

// ---------------------------------------------------------------------------
// detectStack
// ---------------------------------------------------------------------------

/**
 * Read a JSON manifest at `filePath`; return parsed object or null on any error.
 * @param {string} filePath
 * @returns {object|null}
 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Return true if `filePath` exists (any kind).
 * @param {string} filePath
 * @returns {boolean}
 */
function fileExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Collect all dependency keys from a package.json manifest (deps + devDeps).
 * @param {object} pkg  — parsed package.json
 * @returns {string[]}
 */
function pkgDeps(pkg) {
  return [
    ...Object.keys(pkg.dependencies    || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
}

/**
 * Detect the technology stack of a repository by reading its manifest files.
 *
 * @param {string} rootDir  — absolute path to the repository root
 * @returns {{ languages: string[], frameworks: string[], managers: string[] }}
 */
function detectStack(rootDir) {
  const languages  = new Set();
  const frameworks = new Set();
  const managers   = new Set();

  const abs = (name) => path.join(rootDir, name);

  // --- PHP / Composer ---
  const composer = readJson(abs('composer.json'));
  if (composer) {
    languages.add('php');
    managers.add('composer');

    const require   = composer.require   || {};
    const requireDev = composer['require-dev'] || {};
    const allPkgs   = new Set([...Object.keys(require), ...Object.keys(requireDev)]);

    if (allPkgs.has('laravel/framework') || allPkgs.has('laravel/laravel')) {
      frameworks.add('laravel');
    } else if ([...allPkgs].some(p => p.startsWith('symfony/'))) {
      frameworks.add('symfony');
    } else if (
      allPkgs.has('joomla/application') ||
      allPkgs.has('joomla/cms') ||
      fileExists(abs('libraries/joomla/joomla.php')) ||
      fileExists(abs('includes/defines.php'))
    ) {
      frameworks.add('joomla');
    }
  }

  // --- Node / package.json ---
  const pkg = readJson(abs('package.json'));
  if (pkg) {
    languages.add('node');

    const deps = pkgDeps(pkg);

    // Package manager hints from packageManager field or lockfiles.
    if (pkg.packageManager && pkg.packageManager.startsWith('yarn')) {
      managers.add('yarn');
    } else if (pkg.packageManager && pkg.packageManager.startsWith('pnpm')) {
      managers.add('pnpm');
    } else if (fileExists(abs('yarn.lock'))) {
      managers.add('yarn');
    } else if (fileExists(abs('pnpm-lock.yaml'))) {
      managers.add('pnpm');
    } else {
      managers.add('npm');
    }

    if (deps.includes('vue')) frameworks.add('vue');
    if (deps.includes('react') || deps.includes('react-dom')) frameworks.add('react');
  }

  // --- Python ---
  if (
    fileExists(abs('requirements.txt')) ||
    fileExists(abs('pyproject.toml'))  ||
    fileExists(abs('setup.py'))
  ) {
    languages.add('python');
    // pip is universal; if pyproject.toml present Poetry/Hatch may be used,
    // but we can't reliably distinguish — flag pip as the baseline manager.
    managers.add('pip');
  }

  // --- Go ---
  if (fileExists(abs('go.mod'))) {
    languages.add('go');
    managers.add('go');
  }

  // --- Ruby ---
  if (fileExists(abs('Gemfile'))) {
    languages.add('ruby');
    managers.add('bundle');
  }

  return {
    languages:  [...languages],
    frameworks: [...frameworks],
    managers:   [...managers],
  };
}

// ---------------------------------------------------------------------------
// requiredSkills
// ---------------------------------------------------------------------------

/**
 * Return the ordered, deduplicated list of convention skill names needed for
 * the detected stack.  Framework-level skills take priority over plain-language
 * skills (e.g. laravel pulls in php-conventions, so we don't double-list it).
 *
 * @param {{ languages: string[], frameworks: string[] }} stack
 * @returns {string[]}
 */
function requiredSkills(stack) {
  const out   = [];
  const seen  = new Set();

  const add = (name) => { if (!seen.has(name)) { seen.add(name); out.push(name); } };

  const detectedFrameworks = new Set(stack.frameworks || []);

  // Framework skills first.
  for (const fw of detectedFrameworks) {
    for (const skill of (SKILL_MAP[fw] || [])) add(skill);
  }

  // Plain-language fallback: skip if any framework already subsumes this language
  // (e.g. joomla subsumes php, so we don't also add php-conventions).
  for (const lang of (stack.languages || [])) {
    const subsumedBy = LANGUAGE_SUBSUMED_BY[lang];
    if (subsumedBy && [...subsumedBy].some(fw => detectedFrameworks.has(fw))) continue;
    for (const skill of (SKILL_MAP[lang] || [])) add(skill);
  }

  return out;
}

// ---------------------------------------------------------------------------
// requiredTools
// ---------------------------------------------------------------------------

/**
 * Return the list of CLI tool names needed to work with this stack.
 *
 * @param {{ languages: string[], frameworks: string[], managers: string[] }} stack
 * @returns {string[]}
 */
function requiredTools(stack) {
  const out  = [];
  const seen = new Set();
  const add  = (name) => { if (!seen.has(name)) { seen.add(name); out.push(name); } };

  for (const lang of (stack.languages || [])) {
    for (const tool of (TOOL_MAP[lang] || [])) add(tool);
  }

  // Add the detected package manager (e.g. yarn, pnpm) if it differs from the
  // language-level baseline (node uses npm by default in TOOL_MAP).
  for (const mgr of (stack.managers || [])) {
    for (const tool of (TOOL_MAP[mgr] || [])) add(tool);
  }

  return out;
}

// ---------------------------------------------------------------------------
// checkTools
// ---------------------------------------------------------------------------

/**
 * Check which tools from `tools` are available on PATH.
 *
 * @param {string[]} tools  — tool names to check
 * @param {{ has?: (name: string) => boolean }} [opts]
 *   `opts.has` — injectable availability fn (truthy = present); used in tests
 *   to avoid spawning real processes.
 * @returns {{ name: string, available: boolean }[]}
 */
function checkTools(tools, opts) {
  const o = opts || {};
  return (tools || []).map((name) => {
    let available;
    if (typeof o.has === 'function') {
      available = Boolean(o.has(name));
    } else {
      try {
        execFileSync('command', ['-v', name], { stdio: 'pipe' });
        available = true;
      } catch {
        available = false;
      }
    }
    return { name, available };
  });
}

// ---------------------------------------------------------------------------
// assess  (the top-level entry point)
// ---------------------------------------------------------------------------

/**
 * Run the full preflight assessment for a repository root.
 *
 * @param {string} rootDir
 * @param {{ has?: (name: string) => boolean }} [opts]  — forwarded to checkTools
 * @returns {{
 *   stack: { languages: string[], frameworks: string[], managers: string[] },
 *   recommended_skills: string[],
 *   tools: { name: string, available: boolean }[],
 *   recommended_mcp: string[],
 *   missing_required_tools: string[],
 * }}
 */
function assess(rootDir, opts) {
  const stack              = detectStack(rootDir);
  const recommended_skills = requiredSkills(stack);
  const toolNames          = requiredTools(stack);
  const tools              = checkTools(toolNames, opts);

  // Recommend MCP servers for stacks with a user-facing browser surface.
  const has_frontend = (
    stack.frameworks.includes('vue')   ||
    stack.frameworks.includes('react') ||
    // A node project with a build script is likely a frontend toolchain.
    (stack.languages.includes('node') && stack.frameworks.length === 0)
  );
  const recommended_mcp = has_frontend ? ['playwright', 'chrome-devtools'] : [];

  const missing_required_tools = tools
    .filter(t => !t.available)
    .map(t => t.name);

  return { stack, recommended_skills, tools, recommended_mcp, missing_required_tools };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const rootDir = process.argv[2] || process.cwd();
  const result  = assess(rootDir);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  // Exit 0 always — advisory; the gate decides whether to park-block.
  process.exit(0);
}

module.exports = {
  detectStack,
  requiredSkills,
  requiredTools,
  checkTools,
  assess,
  SKILL_MAP,
  TOOL_MAP,
  LANGUAGE_SUBSUMED_BY,
};
