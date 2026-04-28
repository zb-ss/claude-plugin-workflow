/**
 * Tests for lib/repo-key.js — repo-key resolver used to namespace workflow
 * state files by repository.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { getRepoKey, slugify, shortHash, _internals } =
  require('../lib/repo-key.js');

function gitInit(dir, opts) {
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.test'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'], { stdio: 'ignore' });
  if (opts && opts.remote) {
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', opts.remote], { stdio: 'ignore' });
  }
}

describe('slugify()', () => {
  it('lowercases and replaces non-alphanumerics with hyphens', () => {
    assert.equal(slugify('Hello World!'), 'hello-world');
  });

  it('strips leading/trailing hyphens', () => {
    assert.equal(slugify('--foo--'), 'foo');
  });

  it('clamps length to 32 chars', () => {
    const long = 'x'.repeat(100);
    assert.equal(slugify(long).length, 32);
  });

  it('falls back to "repo" for empty / nullish input', () => {
    assert.equal(slugify(''), 'repo');
    assert.equal(slugify(null), 'repo');
    assert.equal(slugify(undefined), 'repo');
    assert.equal(slugify('!!!'), 'repo');
  });
});

describe('shortHash()', () => {
  it('returns a stable 12-char hex string', () => {
    const h = shortHash('hello');
    assert.equal(h.length, 12);
    assert.match(h, /^[0-9a-f]{12}$/);
    assert.equal(shortHash('hello'), h);
  });

  it('returns different hashes for different inputs', () => {
    assert.notEqual(shortHash('a'), shortHash('b'));
  });
});

describe('repoNameFromRemote()', () => {
  const { repoNameFromRemote } = _internals;
  it('handles HTTPS GitHub URLs', () => {
    assert.equal(repoNameFromRemote('https://github.com/user/my-repo.git'), 'my-repo');
  });
  it('handles SSH GitHub URLs', () => {
    assert.equal(repoNameFromRemote('git@github.com:user/my-repo.git'), 'my-repo');
  });
  it('handles URLs without .git suffix', () => {
    assert.equal(repoNameFromRemote('https://gitlab.com/group/sub/proj'), 'proj');
  });
  it('handles trailing slash', () => {
    assert.equal(repoNameFromRemote('https://github.com/user/foo/'), 'foo');
  });
});

describe('getRepoKey() — env override', () => {
  let saved;
  before(() => { saved = process.env.CLAUDE_WORKFLOW_REPO_KEY; });
  after(() => {
    if (saved === undefined) delete process.env.CLAUDE_WORKFLOW_REPO_KEY;
    else process.env.CLAUDE_WORKFLOW_REPO_KEY = saved;
  });

  it('uses CLAUDE_WORKFLOW_REPO_KEY when set', () => {
    process.env.CLAUDE_WORKFLOW_REPO_KEY = 'My Custom Key!';
    const key = getRepoKey('/tmp');
    assert.equal(key, 'my-custom-key');
  });

  it('falls back to repo when env var is empty', () => {
    process.env.CLAUDE_WORKFLOW_REPO_KEY = '';
    delete process.env.CLAUDE_WORKFLOW_REPO_KEY;
    const key = getRepoKey('/tmp');
    assert.match(key, /-[0-9a-f]{12}$/);
  });
});

describe('getRepoKey() — git remote', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-repo-key-remote-'));
    gitInit(tmpDir, { remote: 'https://github.com/test-org/cool-project.git' });
  });
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('derives key from remote URL', () => {
    const key = getRepoKey(tmpDir);
    assert.match(key, /^cool-project-[0-9a-f]{12}$/);
  });

  it('is stable across calls', () => {
    assert.equal(getRepoKey(tmpDir), getRepoKey(tmpDir));
  });
});

describe('getRepoKey() — git toplevel fallback', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-repo-key-noremote-'));
    gitInit(tmpDir);
  });
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('falls back to repo basename + path hash when no remote', () => {
    const key = getRepoKey(tmpDir);
    assert.match(key, /-[0-9a-f]{12}$/);
    // Basename of a tmpdir starts with "wf-repo-key-noremote-" → slugified prefix
    assert.match(key, /^wf-repo-key-noremote-/);
  });

  it('two unrelated git dirs produce different keys', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-repo-key-noremote-other-'));
    try {
      gitInit(other);
      assert.notEqual(getRepoKey(tmpDir), getRepoKey(other));
    } finally {
      try { fs.rmSync(other, { recursive: true, force: true }); } catch {}
    }
  });
});

describe('getRepoKey() — non-git fallback', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-repo-key-nogit-'));
  });
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('still produces a stable key from cwd realpath', () => {
    const key = getRepoKey(tmpDir);
    assert.match(key, /-[0-9a-f]{12}$/);
    assert.equal(getRepoKey(tmpDir), key);
  });
});

describe('getRepoKey() — same remote across different paths', () => {
  it('produces the same key for clones of the same repo', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-clone-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-clone-b-'));
    try {
      gitInit(a, { remote: 'https://github.com/team/proj.git' });
      gitInit(b, { remote: 'https://github.com/team/proj.git' });
      assert.equal(getRepoKey(a), getRepoKey(b));
    } finally {
      try { fs.rmSync(a, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(b, { recursive: true, force: true }); } catch {}
    }
  });
});
