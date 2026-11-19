/**
 * Tests for hooks/scrub-guard.js — the PreToolUse scrub interceptor's pure
 * decision logic (tool classification + allow/deny decision). Live git/gh is
 * exercised only in main(); here we assert the security-relevant logic.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyTool, decide, argValue, commandDir, driverDenial } = require('../hooks/scrub-guard.js');

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

describe('classifyTool push detection', () => {
  it('detects the -C form, heredocs and pipes; ignores commit messages', () => {
    assert.equal(classifyTool('Bash', { command: 'git -C "/tmp/a b" push origin x' }).kind, 'git-push');
    assert.equal(classifyTool('Bash', { command: "cat <<'EOF' | bash\ngit push origin x\nEOF" }).kind, 'git-push');
    assert.equal(classifyTool('Bash', { command: 'echo "git push origin x" | bash' }).kind, 'git-push');
    assert.equal(classifyTool('Bash', { command: 'git commit -m "add push notifications"' }).publish, false);
  });

  it('captures the body file of gh pr create', () => {
    assert.equal(classifyTool('Bash', { command: 'gh pr create --body-file notes.md' }).bodyFile, 'notes.md');
    assert.equal(classifyTool('Bash', { command: 'gh pr create -F notes.md' }).bodyFile, 'notes.md');
  });

  it('detects a push behind git global options', () => {
    for (const c of ['git -c a.b=c push origin x', 'git --no-pager push origin x', 'git -C /a -c x=y push origin x']) {
      assert.equal(classifyTool('Bash', { command: c }).kind, 'git-push', c);
    }
  });

  it('classifies a pull request that mentions a push as a pull request', () => {
    const cls = classifyTool('Bash', { command: 'gh pr create --title "docs: git push guide" --body-file n.md' });
    assert.equal(cls.kind, 'gh-pr');
    assert.equal(cls.bodyFile, 'n.md');
    assert.equal(classifyTool('Bash', { command: 'gh pr create --body "then git push"' }).hints.pr_body, 'then git push');
  });
});

describe('commandDir', () => {
  it('resolves the canonical cd and git -C forms', () => {
    assert.deepEqual(commandDir('cd /tmp/repo && git push -u origin x'), { ok: true, dir: '/tmp/repo' });
    assert.deepEqual(commandDir('cd "/tmp/my repo" && gh pr create --title t'), { ok: true, dir: '/tmp/my repo' });
    assert.deepEqual(commandDir("cd '/tmp/r' && git push"), { ok: true, dir: '/tmp/r' });
    assert.deepEqual(commandDir('git -C /tmp/repo push origin x'), { ok: true, dir: '/tmp/repo' });
  });

  it('returns no dir when the command names none', () => {
    assert.deepEqual(commandDir('git push origin x'), { ok: true, dir: null });
  });

  it('refuses a cd mixed into a longer command', () => {
    assert.equal(commandDir('cd /tmp/r && git status && git push').ok, false);
    assert.equal(commandDir('cd /tmp/r && git push; rm x').ok, false);
    assert.equal(commandDir('cd /tmp/r && git push | tee out').ok, false);
    assert.equal(commandDir('cd /tmp/r && git push `id`').ok, false);
    assert.equal(commandDir('git -C /tmp/r push && echo done').ok, false);
    assert.equal(commandDir('cd /tmp/r\ngit push').ok, false);
  });

  it('accepts quoted multi-line and markdown bodies but not substitution', () => {
    const body = 'cd /tmp/r && gh pr create --title Fix --body "## Summary\n- a; b | c"';
    assert.equal(commandDir(body).ok, true);
    assert.equal(commandDir("gh pr create --body \"$(cat <<'EOF'\nline\nEOF\n)\"").ok, true);
    const bad = commandDir('cd /tmp/r && gh pr create --body "`id`"');
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /--body-file/);
  });

  it('refuses a chained publish that names no directory', () => {
    assert.equal(commandDir('make_body > b.md && gh pr create --body-file b.md').ok, false);
    assert.equal(commandDir('git add -A && git commit -m x && git push').ok, false);
  });

  it('refuses any other option or variable that relocates the repository', () => {
    for (const cmd of [
      'git --no-pager -C /tmp/r push origin x',
      'git -c core.x=y -C /tmp/r push origin x',
      'git --git-dir=/tmp/r/.git push origin x',
      'git --work-tree /tmp/r push origin x',
      'GIT_DIR=/tmp/r/.git git push origin x',
      'bash -c "cd /tmp/r && git push"',
      'tmux new-session -d "git -C /tmp/r push"',
    ]) {
      const found = commandDir(cmd);
      assert.equal(found.ok, false, cmd);
      assert.match(found.reason, /cannot tell which repository/, cmd);
    }
  });

  it('checks a command that only quotes the publish phrase in the cwd', () => {
    for (const cmd of [
      'grep -rn "git push" docs | head -5',
      'git add -A && git commit -m "docs: describe the git push flow"',
      'git log --oneline | grep "gh pr create"',
    ]) {
      assert.equal(classifyTool('Bash', { command: cmd }).publish, true, cmd);
      assert.deepEqual(commandDir(cmd), { ok: true, dir: null }, cmd);
    }
  });

  it('still treats a wrapped push as a publish, checked in the cwd and denied in a driver run', () => {
    for (const cmd of ['dash -c "git push --force origin main"', 'echo "git push origin f" | at now', 'git --no-pager push origin f']) {
      const cls = classifyTool('Bash', { command: cmd });
      assert.equal(cls.publish, true, cmd);
      assert.deepEqual(commandDir(cmd), { ok: true, dir: null }, cmd);
    }
    const wrapped = 'dash -c "git push --force origin main"';
    assert.ok(driverDenial(classifyTool('Bash', { command: wrapped }), wrapped, () => 'main'));
  });

  it('passes a $ dir through for the caller to reject', () => {
    assert.equal(commandDir('cd $HOME/r && git push').dir, '$HOME/r');
  });
});

describe('driverDenial', () => {
  const push = cmd => driverDenial(classifyTool('Bash', { command: cmd }), cmd, () => 'trunk');
  const pr = cmd => driverDenial(classifyTool('Bash', { command: cmd }), cmd, () => null);

  it('allows a feature branch push, with or without -u', () => {
    assert.equal(push('cd "/tmp/r" && git push origin feat/x'), null);
    assert.equal(push('cd /tmp/r && git push -u origin feat/x'), null);
    assert.equal(push('cd /tmp/r && git push --set-upstream origin feat/x'), null);
  });

  it('denies unsafe flags and refspecs', () => {
    for (const f of ['--force origin x', '--force-with-lease origin x', '--delete origin x', '-d origin x',
      '--mirror origin', '--all origin', '--tags origin', 'origin +x', 'origin x:y', 'origin :x', '-f origin x']) {
      assert.match(push(`cd /tmp/r && git push ${f}`), /publish only as/, f);
    }
  });

  it('denies a push to the default branch', () => {
    assert.match(push('cd /tmp/r && git push origin trunk'), /default branch \(trunk\)/);
    const unknown = cmd => driverDenial(classifyTool('Bash', { command: cmd }), cmd, () => null);
    assert.match(unknown('cd /tmp/r && git push origin main'), /default branch/);
    assert.match(unknown('cd /tmp/r && git push origin master'), /default branch/);
    assert.equal(unknown('cd /tmp/r && git push origin feat'), null);
  });

  it('denies HEAD and full ref names that reach the default branch', () => {
    const run = (cmd, current) => driverDenial(classifyTool('Bash', { command: cmd }), cmd, () => 'trunk',
      { currentBranch: () => current, hasBranch: () => true });
    assert.match(run('cd /tmp/r && git push origin HEAD', 'trunk'), /default branch \(trunk\)/);
    assert.match(run('cd /tmp/r && git push -u origin HEAD', 'main'), /default branch \(main\)/);
    assert.match(run('cd /tmp/r && git push origin refs/heads/trunk', 'feat'), /default branch \(trunk\)/);
    assert.match(run('cd /tmp/r && git push origin heads/main', 'feat'), /default branch \(main\)/);
    assert.equal(run('cd /tmp/r && git push origin HEAD', 'feat'), null);
    assert.match(run('cd /tmp/r && git push origin HEAD', 'HEAD'), /publish only as/);
    assert.match(run('cd /tmp/r && git push origin refs/tags/v1', 'feat'), /publish only as/);
  });

  it('denies a name that is not a local branch (a possible tag)', () => {
    const cmd = 'cd /tmp/r && git push origin v2.0.0';
    assert.match(driverDenial(classifyTool('Bash', { command: cmd }), cmd, () => null, { hasBranch: () => false }),
      /publish only as/);
  });

  it('denies git global options in driver mode', () => {
    assert.match(push('cd /tmp/r && git -c a.b=c push --force origin main'), /publish only as/);
  });

  it('denies wrapped, piped, -C and MCP publishes', () => {
    assert.match(push("cat <<'EOF' | bash\ncd /tmp/r && git push origin x\nEOF"), /publish only as/);
    assert.match(push('cd /tmp/r && git push origin x | tee log'), /publish only as/);
    assert.match(push('git -C /tmp/r push origin x'), /publish only as/);
    const cls = classifyTool('mcp__github__push_files', { owner: 'o', repo: 'r' });
    assert.match(driverDenial(cls, '', () => null), /publish only as/);
  });

  it('allows gh pr create with the listed flags only', () => {
    assert.equal(pr('cd /tmp/r && gh pr create'), null);
    assert.equal(pr('cd /tmp/r && gh pr create --title "Add X" --body-file notes.md --base trunk --draft'), null);
    assert.equal(pr('cd /tmp/r && gh pr create -t "Add X" -b "body" -H feat -R o/r -d'), null);
    assert.match(pr('cd /tmp/r && gh pr create --web'), /publish only as/);
    assert.match(pr('cd /tmp/r && gh pr create --title "$(id)"'), /publish only as/);
    assert.match(pr('cd /tmp/r && gh pr create --body "`id`"'), /publish only as/);
    assert.match(pr('cd /tmp/r && gh pr create --title x; id'), /publish only as/);
  });
});

describe('scrub-guard hook process', () => {
  const { spawnSync, execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const hook = path.join(__dirname, '..', 'hooks', 'scrub-guard.js');

  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-guard-'));
    const repo = path.join(root, 'repo');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(repo); fs.mkdirSync(bin);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    return { root, repo, bin };
  }

  function runHook(command, cwd, bin, driver) {
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    delete env.CLAUDE_WORKFLOW_DRIVER_WAKE_PID;
    if (driver) env.CLAUDE_WORKFLOW_DRIVER_WAKE_PID = '1';
    const input = JSON.stringify({ cwd, tool_name: 'Bash', tool_input: { command } });
    return spawnSync(process.execPath, [hook], { input, env, encoding: 'utf8' }).stdout;
  }

  it('denies a mixed cd command', () => {
    const { root, repo, bin } = setup();
    try {
      const out = runHook(`cd "${repo}" && git status && git push origin x`, repo, bin, false);
      assert.match(out, /cannot tell which repository/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('denies a force push in driver mode, and not by the driver rule otherwise', () => {
    const { root, repo, bin } = setup();
    try {
      const cmd = `cd "${repo}" && git push --force origin x`;
      assert.match(runHook(cmd, repo, bin, true), /autonomous driver|publish only as/);
      assert.doesNotMatch(runHook(cmd, repo, bin, false), /autonomous driver|publish only as/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('denies an unreadable pull request body file', () => {
    const { root, repo, bin } = setup();
    try {
      const out = runHook(`cd "${repo}" && gh pr create --body-file missing.md`, repo, bin, false);
      assert.match(out, /cannot read the pull request body/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe('deny verdict carries the denylist status', () => {
  it('passes an unreadable configured path through to the deny note', () => {
    const v = decide({ diff: 'key=AKIA' + 'IOSFODNN7EXAMPLE' }, 'PUBLIC', { denylistPath: '/no/such/denylist.json' });
    assert.equal(v.decision, 'deny');
    assert.equal(v.denylist_status, 'unreadable');
  });
});
