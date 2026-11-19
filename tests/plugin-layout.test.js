/**
 * Layout checks: the manifest, hooks, driver skill and documentation links
 * stay consistent with the files in the repository. Reads files only.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const EXPECTED_AGENTS = [
  'architect', 'executor', 'reviewer-deep', 'security-deep', 'explorer',
  'test-writer', 'completion-guard', 'verifier', 'scope', 'finding-merger', 'web-tester',
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function listMarkdown(rel_dir, recursive) {
  const out = [];
  const abs = path.join(ROOT, rel_dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(rel_dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...listMarkdown(rel, true));
    } else if (entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

const AGENT_FILES = listMarkdown('agents', false);
const SKILL_FILES = listMarkdown('skills', true);
const DOC_FILES = ['README.md', 'SETUP.md', ...listMarkdown('docs', false)].filter(exists);
const ALL_TEXT_FILES = [
  ...DOC_FILES, ...SKILL_FILES, ...AGENT_FILES, ...listMarkdown('resources', false),
];

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

describe('plugin manifest', () => {
  const manifest = JSON.parse(read('.claude-plugin/plugin.json'));

  it('lists exactly the expected agents and every listed path exists', () => {
    const listed = manifest.agents.map(p => path.basename(p, '.md')).sort();
    assert.deepEqual(listed, [...EXPECTED_AGENTS].sort());
    for (const p of manifest.agents) {
      assert.ok(exists(p), `manifest agent missing: ${p}`);
    }
  });

  it('lists every agents/*.md file', () => {
    const listed = new Set(manifest.agents.map(p => path.normalize(p)));
    for (const file of AGENT_FILES) {
      assert.ok(listed.has(path.normalize(file)), `${file} is not listed in plugin.json`);
    }
  });
});

describe('agents', () => {
  for (const banned of ['workflow:phases', '$PLUGIN_ROOT/', 'lessons-cli']) {
    it(`no agent mentions ${banned}`, () => {
      for (const file of AGENT_FILES) {
        assert.ok(!read(file).includes(banned), `${file} mentions ${banned}`);
      }
    });
  }
});

describe('hooks', () => {
  const hooks = JSON.parse(read('hooks/hooks.json'));

  it('registers exactly PreToolUse and SessionStart', () => {
    assert.deepEqual(Object.keys(hooks.hooks).sort(), ['PreToolUse', 'SessionStart']);
  });

  it('every plugin path in a hook command exists', () => {
    const commands = [];
    for (const groups of Object.values(hooks.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) commands.push(hook.command);
      }
    }
    assert.ok(commands.length > 0);
    for (const command of commands) {
      const refs = [...command.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g)];
      assert.ok(refs.length > 0, `no plugin path in: ${command}`);
      for (const ref of refs) {
        assert.ok(exists(ref[1]), `hook references missing file: ${ref[1]}`);
      }
    }
  });
});

describe('driver skill', () => {
  const skill = read('skills/auto/SKILL.md');

  for (const needle of [
    '${CLAUDE_PLUGIN_ROOT}/lib/driver-cli.js',
    'workflow:plan',
    'workflow:implement',
    'resumeFromRunId',
    '--force',
  ]) {
    it(`contains ${needle}`, () => {
      assert.ok(skill.includes(needle), `skills/auto/SKILL.md lacks ${needle}`);
    });
  }

  for (const banned of [
    '/workflow:start', '/workflow:resume', 'hooks/lib', 'rate-limit', 'confidence',
    'spend_', 'approval_posture', '/schedule', 'PLUGIN_ROOT:-',
  ]) {
    it(`does not contain ${banned}`, () => {
      assert.ok(!skill.includes(banned), `skills/auto/SKILL.md contains ${banned}`);
    });
  }
});

describe('plugin CLI references', () => {
  it('every node "${CLAUDE_PLUGIN_ROOT}/<path>" in skills and agents exists', () => {
    for (const file of [...SKILL_FILES, ...AGENT_FILES]) {
      const text = read(file);
      for (const m of text.matchAll(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/g)) {
        assert.ok(exists(m[1]), `${file}:${lineOf(text, m.index)} references missing ${m[1]}`);
      }
    }
  });
});

describe('documentation', () => {
  it('relative Markdown links resolve', () => {
    for (const file of DOC_FILES) {
      const text = read(file);
      for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
        const clean = target.split('#')[0];
        if (!clean) continue;
        const abs = path.resolve(ROOT, path.dirname(file), clean);
        assert.ok(fs.existsSync(abs), `${file}:${lineOf(text, m.index)} links to missing ${target}`);
      }
    }
  });

  it('no removed feature is mentioned', () => {
    const banned = [
      '/workflow:start', '/workflow:resume', '/workflow:test-e2e',
      '/workflow:test-live', '/workflow:migrate-legacy', 'codex_review',
    ];
    for (const file of ALL_TEXT_FILES) {
      const text = read(file);
      for (const word of banned) {
        const at = text.indexOf(word);
        assert.ok(at === -1, `${file}:${lineOf(text, at)} mentions ${word}`);
      }
    }
  });
});

describe('driver files', () => {
  it('driver-cli uses the session and lock file names from driver-wake', () => {
    const wake = require('../lib/driver-wake.js');
    const cli = require('../lib/driver-cli.js');
    assert.equal(typeof wake.SESSION_FILE, 'string');
    assert.equal(typeof wake.LOCK_FILE, 'string');
    for (const name of ['SESSION_FILE', 'LOCK_FILE']) {
      if (name in cli) assert.equal(cli[name], wake[name]);
    }
    const source = read('lib/driver-cli.js');
    assert.match(source, /require\(['"]\.\/driver-wake(\.js)?['"]\)/);
    assert.ok(source.includes('wake.SESSION_FILE') && source.includes('wake.LOCK_FILE'));
  });
});
