#!/usr/bin/env node
/**
 * CLI: detect whether a change is "front-end facing" — i.e. touches user-visible
 * UI (routes, components, templates, styles, assets, FE framework config).
 *
 * Used by the workflow to decide whether the mandatory `e2e_validation` gate
 * applies: an FE-facing change keeps the gate; a pure backend/infra change marks
 * it `skipped`. The detector is deliberately a real, testable CLI rather than
 * prose — the gate's enforcement depends on it being correct.
 *
 * Usage:
 *   node lib/fe-detect-cli.js <file> [<file> ...]      # explicit changed-file list
 *   node lib/fe-detect-cli.js --git [<base-ref>]       # files from `git diff --name-only`
 *
 * Output (stdout JSON): { fe_facing, matched: [{file, reason}], files_checked }
 */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

// Unambiguous front-end file extensions.
const FE_EXTENSIONS = new Set([
  '.vue', '.jsx', '.tsx', '.svelte', '.astro',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.styl',
  '.twig', '.erb', '.ejs', '.hbs', '.handlebars', '.pug', '.haml', '.liquid', '.mustache',
]);

// Path segments that signal a front-end surface (matched as a full path component).
const FE_PATH_SEGMENTS = new Set([
  'components', 'component', 'pages', 'page', 'views', 'view', 'routes',
  'templates', 'template', 'public', 'assets', 'static', 'styles', 'css',
  'ui', 'frontend', 'front-end', 'client', 'webroot', 'www', 'theme', 'themes',
  'layouts', 'layout', 'partials', 'widgets',
]);

// Front-end build/config filenames (prefix match on basename).
const FE_CONFIG_PREFIXES = [
  'vite.config', 'next.config', 'nuxt.config', 'svelte.config', 'astro.config',
  'angular.json', 'tailwind.config', 'postcss.config', 'webpack.config',
];

/**
 * Classify a single file path. Returns a reason string if FE-facing, else null.
 */
function classify(file) {
  if (!file || typeof file !== 'string') return null;
  const norm = file.replace(/\\/g, '/').toLowerCase();
  const base = norm.split('/').pop() || '';

  if (base.endsWith('.blade.php')) return 'blade template (.blade.php)';

  const ext = path.extname(base);
  if (FE_EXTENSIONS.has(ext)) return `FE file extension (${ext})`;

  for (const prefix of FE_CONFIG_PREFIXES) {
    if (base.startsWith(prefix)) return `FE build config (${base})`;
  }

  for (const seg of norm.split('/')) {
    if (FE_PATH_SEGMENTS.has(seg)) return `FE path segment (/${seg}/)`;
  }

  return null;
}

/**
 * Detect FE-facing status across a list of changed files.
 */
function detect(files) {
  const matched = [];
  for (const file of files) {
    const reason = classify(file);
    if (reason) matched.push({ file, reason });
  }
  return { fe_facing: matched.length > 0, matched, files_checked: files.length };
}

/**
 * Changed files via git. With a base ref, diffs against it (branch changes);
 * without, shows working-tree + staged changes against HEAD.
 */
function gitChangedFiles(baseRef) {
  const args = baseRef
    ? ['diff', '--name-only', `${baseRef}...HEAD`]
    : ['diff', '--name-only', 'HEAD'];
  try {
    return execFileSync('git', args, { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  let files;
  if (argv[0] === '--git') {
    files = gitChangedFiles(argv[1]);
  } else {
    files = argv;
  }
  process.stdout.write(JSON.stringify(detect(files), null, 2) + '\n');
}

module.exports = { classify, detect, gitChangedFiles, FE_EXTENSIONS, FE_PATH_SEGMENTS };
