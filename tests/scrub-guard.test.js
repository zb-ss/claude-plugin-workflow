/**
 * Tests for hooks/scrub-guard.js — the PreToolUse scrub interceptor's pure
 * decision logic (tool classification + allow/deny decision). Live git/gh is
 * exercised only in main(); here we assert the security-relevant logic.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyTool, decide, argValue } = require('../hooks/scrub-guard.js');

describe('classifyTool', () => {
  it('flags Bash git push / gh pr create as publish actions', () => {
    assert.equal(classifyTool('Bash', { command: 'git push origin feat/x' }).kind, 'git-push');
    const pr = classifyTool('Bash', { command: 'gh pr create --title "Add X" --body "does X" --repo o/r' });
    assert.equal(pr.kind, 'gh-pr');
    assert.equal(pr.repoSlug, 'o/r');
    assert.equal(pr.hints.pr_title, 'Add X');
    assert.equal(pr.hints.pr_body, 'does X');
  });

  it('does NOT flag non-publish Bash commands', () => {
    for (const c of ['git status', 'git commit -m "x"', 'ls -la', 'git add -A', 'npm test']) {
      assert.equal(classifyTool('Bash', { command: c }).publish, false, c);
    }
  });

  it('flags the MCP publish tools and extracts owner/repo + surface hints', () => {
    const pr = classifyTool('mcp__github__create_pull_request', { owner: 'o', repo: 'r', title: 'T', body: 'B', head: 'feat' });
    assert.equal(pr.publish, true);
    assert.equal(pr.repoSlug, 'o/r');
    assert.equal(pr.hints.pr_title, 'T');
    assert.equal(classifyTool('mcp__github__push_files', { owner: 'o', repo: 'r', files: [{ path: 'a.js' }] }).publish, true);
  });

  it('does NOT flag unrelated MCP tools', () => {
    assert.equal(classifyTool('mcp__github__list_issues', { owner: 'o', repo: 'r' }).publish, false);
    assert.equal(classifyTool('mcp__github__get_me', {}).publish, false);
  });
});

describe('argValue', () => {
  it('parses --flag value, --flag=value, and short flags', () => {
    assert.equal(argValue('gh pr create --title "Hello World"', '--title'), 'Hello World');
    assert.equal(argValue('gh pr create --title=Quick', '--title'), 'Quick');
    assert.equal(argValue("gh pr create -t 'single quoted'", '-t'), 'single quoted');
    assert.equal(argValue('gh pr create --body x', '--title'), null);
  });
});

describe('decide (allow/deny)', () => {
  const dirty = { diff: '+ const ip = "123.45.67.89";', branch: 'feat/x', files: ['CLAUDE.md'] };
  const clean = { diff: '+ const PER_PAGE = 20;', branch: 'feat/pagination', files: ['src/list.ts'] };

  it('ALWAYS allows a confirmed-private target (no scrub needed)', () => {
    assert.equal(decide(dirty, 'PRIVATE').decision, 'allow');
  });

  it('DENIES a public target whose surface carries markers', () => {
    const v = decide(dirty, 'PUBLIC');
    assert.equal(v.decision, 'deny');
    assert.ok(v.hits.length >= 2); // public IP + AI-context file
  });

  it('allows a public target with a clean surface', () => {
    assert.equal(decide(clean, 'PUBLIC').decision, 'allow');
  });

  it('treats UNKNOWN visibility as scrub-required (deny on markers, allow on clean)', () => {
    assert.equal(decide(dirty, null).decision, 'deny');
    assert.equal(decide(clean, null).decision, 'allow');
  });

  it('treats INTERNAL like public (scrub required)', () => {
    assert.equal(decide(dirty, 'INTERNAL').decision, 'deny');
  });
});
