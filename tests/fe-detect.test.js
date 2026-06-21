/**
 * Tests for lib/fe-detect-cli.js — front-end-facing change detection that gates
 * whether the mandatory e2e_validation gate applies.
 *
 * Detector is intentionally inclusive: a false positive merely runs E2E
 * unnecessarily (safe); a false negative skips E2E on a real UI change (unsafe).
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { detect, classify } = require('../lib/fe-detect-cli.js');

describe('classify (single file)', () => {
  it('flags FE file extensions', () => {
    for (const f of ['src/Button.vue', 'app/Page.tsx', 'ui/Widget.jsx', 'x.svelte', 'styles/main.scss', 'a/b.css']) {
      assert.ok(classify(f), `${f} should be FE`);
    }
  });

  it('flags compound .blade.php templates', () => {
    assert.match(classify('resources/views/home.blade.php'), /blade/);
  });

  it('flags FE path segments even for ambiguous extensions', () => {
    assert.match(classify('src/components/thing.ts'), /path segment/);
    assert.match(classify('app/routes/index.ts'), /path segment/);
    assert.match(classify('public/logo.svg'), /path segment/);
  });

  it('flags FE build config files', () => {
    assert.match(classify('vite.config.ts'), /build config/);
    assert.match(classify('tailwind.config.js'), /build config/);
  });

  it('does NOT flag pure backend/infra files', () => {
    for (const f of ['src/services/AuthService.php', 'internal/db/query.go', 'lib/utils.py', 'package.json', 'README.md', 'migrations/001_init.sql']) {
      assert.equal(classify(f), null, `${f} should NOT be FE`);
    }
  });

  it('handles Windows-style separators', () => {
    assert.ok(classify('src\\components\\Nav.tsx'));
  });
});

describe('detect (changed-file set)', () => {
  it('is fe_facing when any file is FE', () => {
    const r = detect(['src/services/auth.php', 'src/components/Login.vue', 'lib/db.go']);
    assert.equal(r.fe_facing, true);
    assert.equal(r.matched.length, 1);
    assert.equal(r.matched[0].file, 'src/components/Login.vue');
    assert.equal(r.files_checked, 3);
  });

  it('is NOT fe_facing for a pure backend change', () => {
    const r = detect(['src/services/auth.php', 'internal/db/query.go', 'tests/auth_test.py']);
    assert.equal(r.fe_facing, false);
    assert.deepEqual(r.matched, []);
  });

  it('is NOT fe_facing for an empty change set', () => {
    assert.equal(detect([]).fe_facing, false);
  });
});
