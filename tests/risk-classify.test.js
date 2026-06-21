/**
 * Tests for lib/risk-classify-cli.js — the risk classifier.
 * All tests inject diff text directly; no real git invocation is performed.
 *
 * Signal → risk mapping under test:
 *   auth | payment | db_migration | destructive → high  (3 reviewers, deep, human gate)
 *   crypto | public_api | secrets_config | infra → medium (2 reviewers, deep, no gate)
 *   none                                          → low   (1 reviewer, standard, no gate)
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { classify } = require('../lib/risk-classify-cli.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract distinct signal categories from a result. */
const cats = (result) => [...new Set(result.signals.map(s => s.category))].sort();

/**
 * Produce a synthetic diff string with exactly `n` added lines so we can
 * trigger the diff_smell threshold without a real repo.
 */
function syntheticDiff(addedLines) {
  const lines = ['diff --git a/big.js b/big.js', '--- a/big.js', '+++ b/big.js', '@@ -1 +1 @@'];
  for (let i = 0; i < addedLines; i++) {
    lines.push(`+const x${i} = ${i};`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Test 1 — docs/test-only diff → low risk, 1 reviewer
// ---------------------------------------------------------------------------

describe('low risk: docs-only diff', () => {
  it('returns low risk, 1 reviewer, no gate, no smell for a clean docs diff', () => {
    const diff = [
      'diff --git a/docs/README.md b/docs/README.md',
      '--- a/docs/README.md',
      '+++ b/docs/README.md',
      '@@ -1,3 +1,4 @@',
      '+## New Section',
      ' Existing content.',
    ].join('\n');

    const files = ['docs/README.md', 'tests/helpers/fixture.json'];

    const result = classify(diff, files);

    assert.equal(result.risk, 'low', 'expected risk=low for docs-only diff');
    assert.equal(result.review_depth.min_reviewers, 1, 'expected 1 reviewer for low risk');
    assert.equal(result.review_depth.security, 'standard');
    assert.equal(result.review_depth.require_human_gate, false);
    assert.equal(result.signals.length, 0, 'expected no signals for docs-only diff');
    assert.equal(result.diff_smell.flagged, false);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — ALTER TABLE migration + auth middleware → high risk
// ---------------------------------------------------------------------------

describe('high risk: db_migration + auth middleware', () => {
  it('returns high risk, 3 reviewers, human gate, signals include db_migration and auth', () => {
    const diff = [
      'diff --git a/database/migrations/2026_06_add_users_col.php b/database/migrations/2026_06_add_users_col.php',
      '--- /dev/null',
      '+++ b/database/migrations/2026_06_add_users_col.php',
      '@@ -0,0 +1,10 @@',
      '+ALTER TABLE users ADD COLUMN mfa_secret VARCHAR(64);',
      'diff --git a/app/Http/Middleware/Authenticate.php b/app/Http/Middleware/Authenticate.php',
      '--- a/app/Http/Middleware/Authenticate.php',
      '+++ b/app/Http/Middleware/Authenticate.php',
      '@@ -5,6 +5,7 @@',
      '+if (!$request->session()->has(\'auth_token\')) return redirect(\'/login\');',
    ].join('\n');

    const files = [
      'database/migrations/2026_06_add_users_col.php',
      'app/Http/Middleware/Authenticate.php',
    ];

    const result = classify(diff, files);

    assert.equal(result.risk, 'high', 'expected risk=high');
    assert.equal(result.review_depth.min_reviewers, 3, 'expected 3 reviewers for high risk');
    assert.equal(result.review_depth.security, 'deep');
    assert.equal(result.review_depth.require_human_gate, true, 'expected human gate for high risk');

    const categories = cats(result);
    assert.ok(categories.includes('db_migration'), `expected db_migration in signals, got: ${categories}`);
    assert.ok(categories.includes('auth'), `expected auth in signals, got: ${categories}`);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — public API controller only → medium risk, security deep
// ---------------------------------------------------------------------------

describe('medium risk: public-api-only diff', () => {
  it('returns medium risk, 2 reviewers, deep security, no human gate', () => {
    const diff = [
      'diff --git a/app/Http/Controllers/Api/OrderController.php b/app/Http/Controllers/Api/OrderController.php',
      '--- a/app/Http/Controllers/Api/OrderController.php',
      '+++ b/app/Http/Controllers/Api/OrderController.php',
      '@@ -20,6 +20,12 @@',
      '+    public function index(Request $request)',
      '+    {',
      '+        return response()->json(Order::paginate(20));',
      '+    }',
    ].join('\n');

    const files = ['app/Http/Controllers/Api/OrderController.php'];

    const result = classify(diff, files);

    assert.equal(result.risk, 'medium', 'expected risk=medium for public-api-only diff');
    assert.equal(result.review_depth.min_reviewers, 2, 'expected 2 reviewers for medium risk');
    assert.equal(result.review_depth.security, 'deep', 'expected deep security review for medium risk');
    assert.equal(result.review_depth.require_human_gate, false, 'expected no human gate for medium risk');

    const categories = cats(result);
    assert.ok(
      categories.includes('public_api') || categories.includes('auth'),
      `expected public_api signal, got: ${categories}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4 — huge diff (>800 changed lines) → diff_smell.flagged: true
// ---------------------------------------------------------------------------

describe('diff_smell: oversized diff', () => {
  it('flags diff_smell when changed lines exceed the 800-line threshold', () => {
    // 850 added lines — clearly above default threshold of 800
    const diff = syntheticDiff(850);
    // Use neutral files so risk stays low; we want to isolate the smell signal
    const files = ['src/utils/helpers.js'];

    const result = classify(diff, files);

    assert.equal(result.diff_smell.flagged, true, 'expected diff_smell.flagged=true for >800 lines');
    assert.ok(result.diff_smell.lines_changed > 800, `lines_changed=${result.diff_smell.lines_changed} should be >800`);
    assert.ok(
      result.diff_smell.reason.includes('800') || result.diff_smell.reason.includes('threshold'),
      `reason should mention threshold, got: "${result.diff_smell.reason}"`,
    );
  });

  it('does NOT flag diff_smell for a normal-sized diff', () => {
    const diff = syntheticDiff(10);
    const result = classify(diff, ['src/index.js']);
    assert.equal(result.diff_smell.flagged, false);
  });
});
