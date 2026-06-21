/**
 * Tests for lib/scrub-cli.js — the scrub-gate marker engine. Security-critical:
 * a false negative leaks internal info to a public repo permanently, so these
 * tests assert both that real markers are caught and that obvious placeholders
 * and safe IPs are not (to keep the gate trustworthy, not just loud).
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { scanText, scanFiles, scanSurface, loadDenylist } = require('../lib/scrub-cli.js');

const cats = (hits) => hits.map(h => h.category).sort();

describe('secrets', () => {
  it('flags real secret formats', () => {
    assert.ok(scanText('key=AKIAIOSFODNN7EXAMPLE here', 'x').some(h => h.category === 'secret'));
    assert.ok(scanText('ghp_' + 'a'.repeat(36), 'x').some(h => h.category === 'secret'));
    assert.ok(scanText('-----BEGIN RSA PRIVATE KEY-----', 'x').some(h => h.category === 'secret'));
    assert.ok(scanText('postgres://user:s3cretpw@db.internal/app', 'x').some(h => h.category === 'secret'));
    assert.ok(scanText('Authorization: Bearer ' + 'x'.repeat(30), 'x').some(h => h.category === 'secret'));
    assert.ok(scanText('password = "hunter2real"', 'x').some(h => h.category === 'secret'));
  });

  it('does NOT flag obvious placeholder values', () => {
    assert.deepEqual(scanText('password = "changeme"', 'x'), []);
    assert.deepEqual(scanText('api_key = "your-key-here"', 'x'), []);
    assert.deepEqual(scanText('secret = "<redacted>"', 'x'), []);
    assert.deepEqual(scanText('token = "xxxxxxxx"', 'x'), []);
  });
});

describe('public IPs', () => {
  it('flags a real routable public IP', () => {
    const hits = scanText('connect to 123.45.67.89 now', 'x');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].category, 'public_ip');
    assert.equal(hits[0].match, '123.45.67.89');
  });
  it('does NOT flag neutral, private, loopback, or RFC-5737 doc IPs', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '10.0.0.1', '192.168.1.5', '172.16.9.9', '127.0.0.1', '203.0.113.7', '192.0.2.4', '198.51.100.9']) {
      assert.deepEqual(scanText(`host ${ip}`, 'x'), [], `${ip} should be clean`);
    }
  });
  it('ignores invalid dotted quads', () => {
    assert.deepEqual(scanText('version 999.999.999.999', 'x'), []);
  });
});

describe('AI-context files', () => {
  it('flags AI-assistant context filenames anywhere in the path', () => {
    const hits = scanFiles(['src/app.ts', 'CLAUDE.md', 'sub/.cursorrules', 'docs/README.md']);
    assert.deepEqual(hits.map(h => h.match).sort(), ['CLAUDE.md', 'sub/.cursorrules']);
    assert.ok(hits.every(h => h.category === 'ai_context_file'));
  });
  it('does not flag ordinary files', () => {
    assert.deepEqual(scanFiles(['src/index.js', 'README.md', 'package.json']), []);
  });
});

describe('operator denylist', () => {
  let dlPath;
  before(() => {
    dlPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-')), 'denylist.json');
    fs.writeFileSync(dlPath, JSON.stringify({
      entries: [
        { category: 'customer', pattern: 'AcmeCorp', regex: false },
        { category: 'internal_flag', pattern: 'flag_secret_beta_\\w+', regex: true },
        { category: 'hostname', pattern: 'prod-db-01.internal', regex: false },
      ],
    }));
  });
  after(() => { try { fs.rmSync(path.dirname(dlPath), { recursive: true, force: true }); } catch {} });

  it('loads and matches denylist entries (literal + regex)', () => {
    const dl = loadDenylist(dlPath);
    assert.equal(dl.loaded, true);
    assert.ok(scanText('deploy for AcmeCorp tonight', 'x', dl.entries).some(h => h.category === 'customer'));
    assert.ok(scanText('if (flag_secret_beta_payments)', 'x', dl.entries).some(h => h.category === 'internal_flag'));
    assert.ok(scanText('ssh prod-db-01.internal', 'x', dl.entries).some(h => h.category === 'hostname'));
    assert.deepEqual(scanText('a generic public sentence', 'x', dl.entries), []);
  });

  it('reports denylist_loaded=false and skips name matching when no denylist configured', () => {
    const saved = process.env.CLAUDE_WORKFLOW_SCRUB_DENYLIST;
    delete process.env.CLAUDE_WORKFLOW_SCRUB_DENYLIST;
    try {
      const r = scanSurface({ diff: 'AcmeCorp internal note' });
      assert.equal(r.denylist_loaded, false);
      assert.equal(r.clean, true); // name not caught without a denylist (structural patterns only)
    } finally {
      if (saved !== undefined) process.env.CLAUDE_WORKFLOW_SCRUB_DENYLIST = saved;
    }
  });
});

describe('scanSurface (full crossing surface)', () => {
  it('aggregates hits across branch/commits/diff/pr/files with correct `where`', () => {
    const r = scanSurface({
      branch: 'fix/AcmeCorp-login',
      commits: ['add AKIAIOSFODNN7EXAMPLE to config'],
      diff: '+ host = 123.45.67.89',
      pr_title: 'clean title',
      pr_body: 'see prod-db-01.internal',
      files: ['CLAUDE.md'],
    }, { denylistPath: makeDenylist() });
    assert.equal(r.clean, false);
    assert.deepEqual(cats(r.hits), ['ai_context_file', 'customer', 'hostname', 'public_ip', 'secret']);
    assert.ok(r.hits.find(h => h.where === 'branch'));
    assert.ok(r.hits.find(h => h.where === 'files'));
  });

  it('is clean for a fully-scrubbed surface', () => {
    const r = scanSurface({
      branch: 'feature/add-pagination',
      commits: ['feat: add pagination to list view'],
      diff: '+ const PER_PAGE = 20;',
      pr_title: 'Add pagination',
      pr_body: 'Adds page-size 20 to the list endpoint. Test host 8.8.8.8.',
      files: ['src/list.ts', 'tests/list.test.ts'],
    });
    assert.equal(r.clean, true);
    assert.deepEqual(r.hits, []);
  });
});

function makeDenylist() {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scrub2-')), 'dl.json');
  fs.writeFileSync(p, JSON.stringify({
    entries: [
      { category: 'customer', pattern: 'AcmeCorp', regex: false },
      { category: 'hostname', pattern: 'prod-db-01.internal', regex: false },
    ],
  }));
  return p;
}
