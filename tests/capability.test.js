/**
 * Tests for lib/capability-cli.js — capability preflight detector.
 *
 * All filesystem interactions use real temp directories created with
 * fs.mkdtempSync so nothing in the project tree is mutated.
 * Tool availability is tested via an injected `opts.has` function so the
 * suite runs without any of the real binaries present.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const os     = require('node:os');

const {
  detectStack,
  requiredSkills,
  requiredTools,
  checkTools,
  assess,
  SKILL_MAP,
} = require('../lib/capability-cli.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp dir and return its path. */
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-test-'));
}

/** Write a file relative to dir; creates parent dirs as needed. */
function write(dir, name, content) {
  const full = path.join(dir, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

// ---------------------------------------------------------------------------
// Fixture: Laravel composer.json
// ---------------------------------------------------------------------------
const LARAVEL_COMPOSER = {
  name: 'example/app',
  require: {
    'php': '^8.2',
    'laravel/framework': '^11.0',
  },
  'require-dev': {
    'phpunit/phpunit': '^10.0',
  },
};

// ---------------------------------------------------------------------------
// Fixture: Symfony composer.json
// ---------------------------------------------------------------------------
const SYMFONY_COMPOSER = {
  name: 'example/symfony-app',
  require: {
    'php': '^8.1',
    'symfony/framework-bundle': '^6.4',
    'symfony/console': '^6.4',
  },
};

// ---------------------------------------------------------------------------
// Fixture: plain-PHP composer.json (no recognisable framework)
// ---------------------------------------------------------------------------
const PLAIN_PHP_COMPOSER = {
  name: 'example/tool',
  require: { 'php': '^8.0', 'psr/log': '^3.0' },
};

// ---------------------------------------------------------------------------
// Fixture: Vue package.json
// ---------------------------------------------------------------------------
const VUE_PKG = {
  name: 'example-vue',
  dependencies: { vue: '^3.4.0' },
  devDependencies: { vite: '^5.0.0' },
};

// ---------------------------------------------------------------------------
// Fixture: React package.json  (yarn)
// ---------------------------------------------------------------------------
const REACT_PKG = {
  name: 'example-react',
  packageManager: 'yarn@4.1.0',
  dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
};

// ---------------------------------------------------------------------------
// detectStack — PHP stacks
// ---------------------------------------------------------------------------

describe('detectStack — Laravel', () => {
  let dir;
  before(() => { dir = tempDir(); write(dir, 'composer.json', LARAVEL_COMPOSER); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('detects php language', () => {
    assert.ok(detectStack(dir).languages.includes('php'));
  });
  it('detects laravel framework', () => {
    assert.ok(detectStack(dir).frameworks.includes('laravel'));
  });
  it('does NOT double-report symfony or joomla', () => {
    const { frameworks } = detectStack(dir);
    assert.equal(frameworks.includes('symfony'), false);
    assert.equal(frameworks.includes('joomla'),  false);
  });
  it('includes composer in managers', () => {
    assert.ok(detectStack(dir).managers.includes('composer'));
  });
});

describe('detectStack — Symfony', () => {
  let dir;
  before(() => { dir = tempDir(); write(dir, 'composer.json', SYMFONY_COMPOSER); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('detects symfony framework', () => {
    assert.ok(detectStack(dir).frameworks.includes('symfony'));
  });
  it('detects php language', () => {
    assert.ok(detectStack(dir).languages.includes('php'));
  });
});

describe('detectStack — plain PHP', () => {
  let dir;
  before(() => { dir = tempDir(); write(dir, 'composer.json', PLAIN_PHP_COMPOSER); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('detects php language, no framework', () => {
    const s = detectStack(dir);
    assert.ok(s.languages.includes('php'));
    assert.deepEqual(s.frameworks, []);
  });
});

// ---------------------------------------------------------------------------
// detectStack — Node / Vue / React
// ---------------------------------------------------------------------------

describe('detectStack — Vue', () => {
  let dir;
  before(() => { dir = tempDir(); write(dir, 'package.json', VUE_PKG); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('detects node language', () => {
    assert.ok(detectStack(dir).languages.includes('node'));
  });
  it('detects vue framework', () => {
    assert.ok(detectStack(dir).frameworks.includes('vue'));
  });
  it('uses npm as default manager', () => {
    assert.ok(detectStack(dir).managers.includes('npm'));
  });
});

describe('detectStack — React (yarn)', () => {
  let dir;
  before(() => { dir = tempDir(); write(dir, 'package.json', REACT_PKG); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('detects react framework', () => {
    assert.ok(detectStack(dir).frameworks.includes('react'));
  });
  it('detects yarn manager', () => {
    assert.ok(detectStack(dir).managers.includes('yarn'));
  });
});

// ---------------------------------------------------------------------------
// detectStack — Python
// ---------------------------------------------------------------------------

describe('detectStack — Python (requirements.txt)', () => {
  let dir;
  before(() => {
    dir = tempDir();
    write(dir, 'requirements.txt', 'flask==3.0.0\nrequests==2.31.0\n');
  });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('detects python language', () => {
    assert.ok(detectStack(dir).languages.includes('python'));
  });
  it('no php or node bleed-through', () => {
    const { languages } = detectStack(dir);
    assert.equal(languages.includes('php'),  false);
    assert.equal(languages.includes('node'), false);
  });
});

// ---------------------------------------------------------------------------
// detectStack — Go
// ---------------------------------------------------------------------------

describe('detectStack — Go (go.mod)', () => {
  let dir;
  before(() => {
    dir = tempDir();
    write(dir, 'go.mod', 'module example.com/app\n\ngo 1.22\n');
  });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('detects go language', () => {
    assert.ok(detectStack(dir).languages.includes('go'));
  });
});

// ---------------------------------------------------------------------------
// detectStack — polyglot (PHP + Node)
// ---------------------------------------------------------------------------

describe('detectStack — polyglot PHP + Node', () => {
  let dir;
  before(() => {
    dir = tempDir();
    write(dir, 'composer.json', LARAVEL_COMPOSER);
    write(dir, 'package.json', VUE_PKG);
  });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('detects both php and node', () => {
    const { languages } = detectStack(dir);
    assert.ok(languages.includes('php'));
    assert.ok(languages.includes('node'));
  });
  it('detects both laravel and vue frameworks', () => {
    const { frameworks } = detectStack(dir);
    assert.ok(frameworks.includes('laravel'));
    assert.ok(frameworks.includes('vue'));
  });
});

// ---------------------------------------------------------------------------
// detectStack — empty dir
// ---------------------------------------------------------------------------

describe('detectStack — empty directory', () => {
  let dir;
  before(() => { dir = tempDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns empty arrays without crashing', () => {
    const s = detectStack(dir);
    assert.deepEqual(s.languages,  []);
    assert.deepEqual(s.frameworks, []);
    assert.deepEqual(s.managers,   []);
  });
});

// ---------------------------------------------------------------------------
// requiredSkills
// ---------------------------------------------------------------------------

describe('requiredSkills', () => {
  it('laravel → laravel-conventions + php-conventions', () => {
    const skills = requiredSkills({ languages: ['php'], frameworks: ['laravel'], managers: [] });
    assert.deepEqual(skills, SKILL_MAP.laravel);
  });

  it('joomla → joomla-conventions only', () => {
    const skills = requiredSkills({ languages: ['php'], frameworks: ['joomla'], managers: [] });
    assert.deepEqual(skills, SKILL_MAP.joomla);
  });

  it('symfony → symfony-conventions + php-conventions', () => {
    const skills = requiredSkills({ languages: ['php'], frameworks: ['symfony'], managers: [] });
    assert.deepEqual(skills, SKILL_MAP.symfony);
  });

  it('plain php → php-conventions', () => {
    const skills = requiredSkills({ languages: ['php'], frameworks: [], managers: [] });
    assert.deepEqual(skills, SKILL_MAP.php);
  });

  it('vue → vue-conventions', () => {
    const skills = requiredSkills({ languages: ['node'], frameworks: ['vue'], managers: [] });
    assert.deepEqual(skills, SKILL_MAP.vue);
  });

  it('laravel + vue → merged skill list without duplicates', () => {
    const skills = requiredSkills({ languages: ['php', 'node'], frameworks: ['laravel', 'vue'], managers: [] });
    // laravel brings laravel-conventions + php-conventions; vue brings vue-conventions
    assert.ok(skills.includes('laravel-conventions'));
    assert.ok(skills.includes('php-conventions'));
    assert.ok(skills.includes('vue-conventions'));
    // no duplicates
    assert.equal(skills.length, new Set(skills).size);
  });

  it('unknown stack → empty skills list', () => {
    assert.deepEqual(requiredSkills({ languages: ['go'], frameworks: [], managers: [] }), []);
  });
});

// ---------------------------------------------------------------------------
// checkTools — injected availability fn
// ---------------------------------------------------------------------------

describe('checkTools (injected has fn)', () => {
  const present = new Set(['php', 'composer', 'node']);
  const has = (name) => present.has(name);

  it('marks present tools as available', () => {
    const results = checkTools(['php', 'composer'], { has });
    assert.ok(results.every(t => t.available === true));
  });

  it('marks absent tools as unavailable', () => {
    const results = checkTools(['python3', 'pytest'], { has });
    assert.ok(results.every(t => t.available === false));
  });

  it('returns mixed availability correctly', () => {
    const results = checkTools(['php', 'python3', 'node', 'go'], { has });
    const byName = Object.fromEntries(results.map(t => [t.name, t.available]));
    assert.equal(byName.php,     true);
    assert.equal(byName.python3, false);
    assert.equal(byName.node,    true);
    assert.equal(byName.go,      false);
  });

  it('returns empty array for empty tool list', () => {
    assert.deepEqual(checkTools([], { has }), []);
  });
});

// ---------------------------------------------------------------------------
// assess — recommended_mcp for frontend stacks
// ---------------------------------------------------------------------------

describe('assess — recommended_mcp', () => {
  let vueDir, phpDir, pyDir;
  before(() => {
    vueDir = tempDir(); write(vueDir, 'package.json', VUE_PKG);
    phpDir = tempDir(); write(phpDir, 'composer.json', LARAVEL_COMPOSER);
    pyDir  = tempDir(); write(pyDir,  'requirements.txt', 'flask\n');
  });
  after(() => {
    for (const d of [vueDir, phpDir, pyDir]) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('Vue project → playwright + chrome-devtools recommended', () => {
    const r = assess(vueDir, { has: () => false });
    assert.deepEqual(r.recommended_mcp, ['playwright', 'chrome-devtools']);
  });

  it('Laravel (PHP-only) project → no MCP recommended', () => {
    const r = assess(phpDir, { has: () => false });
    assert.deepEqual(r.recommended_mcp, []);
  });

  it('Python project → no MCP recommended', () => {
    const r = assess(pyDir, { has: () => false });
    assert.deepEqual(r.recommended_mcp, []);
  });
});

// ---------------------------------------------------------------------------
// assess — missing_required_tools
// ---------------------------------------------------------------------------

describe('assess — missing_required_tools', () => {
  let dir;
  before(() => {
    dir = tempDir();
    write(dir, 'composer.json', LARAVEL_COMPOSER);
  });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('lists tools that are not available', () => {
    // Simulate: php present, composer missing.
    const has = (name) => name === 'php';
    const r = assess(dir, { has });
    assert.ok(r.missing_required_tools.includes('composer'));
    assert.equal(r.missing_required_tools.includes('php'), false);
  });

  it('empty when all tools are available', () => {
    const r = assess(dir, { has: () => true });
    assert.deepEqual(r.missing_required_tools, []);
  });
});

// ---------------------------------------------------------------------------
// assess — shape contract (empty dir)
// ---------------------------------------------------------------------------

describe('assess — empty directory produces valid shape', () => {
  let dir;
  before(() => { dir = tempDir(); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns all required keys without crashing', () => {
    const r = assess(dir, { has: () => false });
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'stack'));
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'recommended_skills'));
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'tools'));
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'recommended_mcp'));
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'missing_required_tools'));
    assert.deepEqual(r.stack.languages,  []);
    assert.deepEqual(r.recommended_skills, []);
    assert.deepEqual(r.recommended_mcp, []);
  });
});
