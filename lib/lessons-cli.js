#!/usr/bin/env node
/**
 * Per-repo lessons memory: record review findings as pre-emptive constraints
 * so recurring problems become constraints on future runs rather than repeat findings.
 *
 * Storage: <stateDir>/lessons/<repo-key>.md
 * Format:  Markdown bullet list — one lesson per line:
 *            - [category] lesson text
 *          Plain bullets (no category) are stored as category "general".
 *
 * Usage:
 *   node lib/lessons-cli.js read <repo-key>
 *   node lib/lessons-cli.js append <repo-key> "<lesson text>" [--category <cat>]
 *
 * Honors CLAUDE_WORKFLOW_STATE_DIR for the state directory root.
 * Tests may pass opts.dir to override the state dir without touching the env.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { getStateDir } = require('./paths');

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the path to the lessons file for a given repo key.
 * @param {string} repoKey
 * @param {{ dir?: string }} [opts]  opts.dir overrides the entire state dir root
 * @returns {string}
 */
function lessonsPath(repoKey, opts) {
  const o = opts || {};
  const base = o.dir ? path.resolve(o.dir) : getStateDir();
  return path.join(base, 'lessons', `${repoKey}.md`);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Return the raw file contents, or '' if the file does not exist.
 * @param {string} repoKey
 * @param {{ dir?: string }} [opts]
 * @returns {string}
 */
function read(repoKey, opts) {
  const p = lessonsPath(repoKey, opts);
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

// Matches:  - [category] text     OR  - text (plain)
const BULLET_RE = /^-\s+(?:\[([^\]]+)\]\s+)?(.+)$/;

/**
 * Parse markdown bullet list into structured lessons.
 * @param {string} md
 * @returns {Array<{category: string, text: string}>}
 */
function parseLessons(md) {
  if (!md || typeof md !== 'string') return [];
  const lessons = [];
  for (const line of md.split('\n')) {
    const m = BULLET_RE.exec(line.trim());
    if (!m) continue;
    lessons.push({ category: m[1] || 'general', text: m[2].trim() });
  }
  return lessons;
}

// ---------------------------------------------------------------------------
// Dedup helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a lesson text for dedup comparison:
 * trim, collapse internal whitespace, lowercase.
 * @param {string} s
 * @returns {string}
 */
function normalize(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Return true if the candidate lesson is already present in the markdown.
 * Comparison is against the .text field only (category is not part of dedup key)
 * so that the same finding recorded under different categories still deduplicates.
 * @param {string} candidate  raw lesson text
 * @param {Array<{text:string}>} existing  result of parseLessons()
 * @returns {boolean}
 */
function isDuplicate(candidate, existing) {
  const norm = normalize(candidate);
  return existing.some(l => normalize(l.text) === norm);
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/**
 * Append a lesson bullet to the repo's lessons file.
 * Creates the directory and file if they do not exist.
 * Deduplicates: if a near-identical bullet already exists (normalize:
 * trim, collapse whitespace, lowercase), does nothing and returns {added:false}.
 *
 * @param {string} repoKey
 * @param {string} lesson   lesson text (no bullet prefix)
 * @param {{ dir?: string, category?: string }} [opts]
 * @returns {{ added: boolean, path: string }}
 */
function append(repoKey, lesson, opts) {
  const o = opts || {};
  const category = (o.category && o.category.trim()) ? o.category.trim() : 'general';
  const p = lessonsPath(repoKey, opts);

  const existing = parseLessons(read(repoKey, opts));

  if (isDuplicate(lesson, existing)) {
    return { added: false, path: p };
  }

  const bullet = `- [${category}] ${lesson.trim()}\n`;

  // Ensure the directory exists before writing.
  fs.mkdirSync(path.dirname(p), { recursive: true });

  fs.appendFileSync(p, bullet, 'utf8');
  return { added: true, path: p };
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const repoKey = argv[1];

  if (!cmd || !repoKey) {
    process.stderr.write(
      'Usage:\n' +
      '  node lessons-cli.js read <repo-key>\n' +
      '  node lessons-cli.js append <repo-key> "<lesson>" [--category <cat>]\n'
    );
    process.exit(2);
  }

  if (cmd === 'read') {
    process.stdout.write(read(repoKey) + '\n');
    process.exit(0);
  }

  if (cmd === 'append') {
    const lessonText = argv[2];
    if (!lessonText) {
      process.stderr.write('append: lesson text required\n');
      process.exit(2);
    }
    const catFlagIdx = argv.indexOf('--category');
    const category = catFlagIdx >= 0 ? argv[catFlagIdx + 1] : 'general';
    const result = append(repoKey, lessonText, { category });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  }

  process.stderr.write(`Unknown command: ${cmd}\n`);
  process.exit(2);
}

module.exports = { lessonsPath, read, parseLessons, append };
