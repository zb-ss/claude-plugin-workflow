/**
 * Recorder checks: subtitle timing, Playwright resolution order, the dependency
 * check and, when asked for, a real smoke recording of a local static page.
 * Temp directories only; nothing under the real home directory is touched.
 */

'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'record-demo');
const { msToSrt, buildSrt, createCueTracker } = require(path.join(SKILL_DIR, 'record-harness.js'));
const { resolvePlaywright, requirePlaywright, checkDependencies } = require(path.join(SKILL_DIR, 'deps.js'));

const temp_dirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-demo-test-'));
  temp_dirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of temp_dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('msToSrt', () => {
  it('formats milliseconds', () => {
    assert.equal(msToSrt(0), '00:00:00,000');
    assert.equal(msToSrt(3723004), '01:02:03,004');
  });
  it('clamps negatives to zero', () => {
    assert.equal(msToSrt(-50), '00:00:00,000');
  });
});

describe('buildSrt', () => {
  it('numbers cues and formats times', () => {
    const out = buildSrt([
      { start: 0, end: 1500, text: 'One' },
      { start: 1500, end: 4000, text: 'Two' },
    ]);
    assert.equal(
      out,
      '1\n00:00:00,000 --> 00:00:01,500\nOne\n\n2\n00:00:01,500 --> 00:00:04,000\nTwo\n\n'
    );
  });
  it('drops empty and zero-length cues and keeps numbering consecutive', () => {
    const out = buildSrt([
      { start: 0, end: 1000, text: 'A' },
      { start: 1000, end: 2000, text: '' },
      { start: 2000, end: 2000, text: 'zero' },
      { start: 2000, end: 3000, text: 'B' },
    ]);
    assert.equal(out, '1\n00:00:00,000 --> 00:00:01,000\nA\n\n2\n00:00:02,000 --> 00:00:03,000\nB\n\n');
  });
});

describe('createCueTracker', () => {
  it('ends each cue when the next one opens', () => {
    let clock = 0;
    const tracker = createCueTracker(() => clock);
    tracker.open('first');
    clock = 1500;
    tracker.open('second');
    clock = 4000;
    tracker.close();
    assert.deepEqual(tracker.cues.map((c) => [c.text, c.start, c.end]), [
      ['first', 0, 1500],
      ['second', 1500, 4000],
    ]);
  });
});

function fakeLookups(existing, npm_root) {
  const calls = { npmRoot: 0 };
  const set = new Set(existing.map((d) => path.join(d, 'package.json')));
  return {
    calls,
    exists: (p) => set.has(p),
    npmRoot: () => { calls.npmRoot += 1; return npm_root; },
    load: (dir) => ({ loaded: dir }),
    run: () => null,
  };
}

describe('resolvePlaywright', () => {
  const explicit = '/explicit/playwright';
  const node_path = ['/np/one', '/np/two'].join(path.delimiter);
  const env = { PLAYWRIGHT_MODULE_PATH: explicit, NODE_PATH: node_path };
  const project = '/work/app';
  const candidates = [
    explicit,
    path.join('/np/one', 'playwright'),
    path.join('/np/two', 'playwright'),
    path.join(project, 'node_modules', 'playwright'),
    path.join('/global/root', 'playwright'),
  ];

  it('prefers PLAYWRIGHT_MODULE_PATH, then NODE_PATH, then the project, then global', () => {
    const expected = [
      ['PLAYWRIGHT_MODULE_PATH', candidates[0]],
      ['NODE_PATH', candidates[1]],
      ['NODE_PATH', candidates[2]],
      ['project', candidates[3]],
      ['global', candidates[4]],
    ];
    for (let i = 0; i < expected.length; i++) {
      const lookups = fakeLookups(candidates.slice(i), '/global/root');
      const found = resolvePlaywright({ env, project_dir: project, lookups });
      assert.equal(found.source, expected[i][0]);
      assert.equal(found.dir, expected[i][1]);
    }
  });

  it('does not query the global npm root while an earlier candidate exists', () => {
    const lookups = fakeLookups([candidates[3]], '/global/root');
    resolvePlaywright({ env, project_dir: project, lookups });
    assert.equal(lookups.calls.npmRoot, 0);
  });

  it('returns null with every tried directory in order when nothing exists', () => {
    const lookups = fakeLookups([], '/global/root');
    const found = resolvePlaywright({ env, project_dir: project, lookups });
    assert.equal(found.dir, null);
    assert.deepEqual(found.tried, candidates);
  });
});

describe('requirePlaywright', () => {
  it('names the install commands when the module is missing', () => {
    const lookups = fakeLookups([], null);
    assert.throws(
      () => requirePlaywright({ env: {}, project_dir: '/work/app', lookups }),
      (err) => err.message.includes('npm install -D playwright')
        && err.message.includes('npx playwright install chromium')
        && err.message.includes(path.join('/work/app', 'node_modules', 'playwright'))
    );
  });
  it('loads the resolved directory', () => {
    const dir = path.join('/work/app', 'node_modules', 'playwright');
    const lookups = fakeLookups([dir], null);
    assert.deepEqual(requirePlaywright({ env: {}, project_dir: '/work/app', lookups }), { loaded: dir });
  });
});

describe('checkDependencies', () => {
  const project = '/work/app';
  const pw_dir = path.join(project, 'node_modules', 'playwright');
  const chromium_exe = '/browsers/chrome';

  function lookups({ module = true, chromium = true, ffmpeg = true, xvfb = true } = {}) {
    const existing = [];
    if (module) existing.push(pw_dir);
    const exe_set = new Set(chromium ? [chromium_exe] : []);
    return {
      exists: (p) => existing.some((d) => p === path.join(d, 'package.json')) || exe_set.has(p),
      npmRoot: () => null,
      load: () => ({ chromium: { executablePath: () => chromium_exe } }),
      run: (cmd) => {
        if (cmd === 'ffmpeg') return ffmpeg ? 'ffmpeg version test\nmore' : null;
        if (cmd === 'Xvfb') return xvfb ? 'usage' : null;
        return null;
      },
    };
  }
  const run = (options, mode) => checkDependencies({ mode, env: {}, project_dir: project, lookups: lookups(options) });

  it('is ok when everything is present', () => {
    const report = run({});
    assert.equal(report.ok, true);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.items.map((i) => i.name), ['node', 'playwright', 'chromium', 'ffmpeg']);
  });
  it('reports a missing module with chromium', () => {
    const report = run({ module: false });
    assert.deepEqual(report.missing, ['playwright', 'chromium']);
    assert.equal(report.items.find((i) => i.name === 'chromium').detail, 'needs the playwright module');
  });
  it('reports a missing chromium build', () => {
    assert.deepEqual(run({ chromium: false }).missing, ['chromium']);
  });
  it('reports a missing ffmpeg', () => {
    assert.deepEqual(run({ ffmpeg: false }).missing, ['ffmpeg']);
  });
  it('lists xvfb only in screen mode', () => {
    assert.ok(!run({}, 'page').items.some((i) => i.name === 'xvfb'));
    const screen = run({ xvfb: false }, 'screen');
    assert.ok(screen.items.some((i) => i.name === 'xvfb'));
    assert.ok(screen.missing.includes('xvfb'));
  });
});

describe('deps.js CLI', () => {
  it('prints the check as JSON and exits 0', () => {
    const res = spawnSync(process.execPath, [path.join(SKILL_DIR, 'deps.js'), 'check', '--project', tempDir()], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    const report = JSON.parse(res.stdout);
    assert.deepEqual(report.items.map((i) => i.name).slice(0, 4), ['node', 'playwright', 'chromium', 'ffmpeg']);
    assert.ok(Array.isArray(report.missing));
    assert.equal(report.mode, 'page');
  });
  it('exits 2 on an unknown command', () => {
    const res = spawnSync(process.execPath, [path.join(SKILL_DIR, 'deps.js'), 'nope'], { encoding: 'utf8' });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /usage/);
  });
});

const smoke_report = process.env.RECORD_DEMO_SMOKE === '1' ? checkDependencies({}) : null;
const smoke_skip = process.env.RECORD_DEMO_SMOKE !== '1'
  ? 'set RECORD_DEMO_SMOKE=1 to record a real demo'
  : (smoke_report.ok ? false : 'missing: ' + smoke_report.missing.join(', '));

describe('smoke recording', { skip: smoke_skip }, () => {
  it('records a local page into a temp dir', { timeout: 120000 }, async () => {
    const { recordDemo } = require(path.join(SKILL_DIR, 'record-harness.js'));
    const site_dir = tempDir();
    const out_dir = tempDir();
    fs.writeFileSync(
      path.join(site_dir, 'index.html'),
      '<!doctype html><html><body style="font-family:sans-serif;padding:80px">'
      + '<h1>Demo page</h1><button id="go" onclick="document.getElementById(\'out\').textContent=\'Done\'">Go</button>'
      + '<p id="out"></p></body></html>'
    );
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(fs.readFileSync(path.join(site_dir, 'index.html')));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base_url = 'http://127.0.0.1:' + server.address().port + '/';
    try {
      const result = await recordDemo({
        outName: 'smoke',
        outDir: out_dir,
        brand: 'Acme · Feature X',
        baseUrl: base_url,
        viewport: { width: 1280, height: 720 },
        scenes: [
          async (c) => { await c.page.goto(c.baseUrl); await c.titleCard('Feature X', 'a quick look'); await c.sleep(1000); await c.dropTitleCard(); },
          async (c) => { await c.caption('1', 'Press the button'); await c.click('#go'); await c.sleep(1500); },
          async (c) => { await c.caption('2', 'The result shows'); await c.sleep(1000); },
        ],
      });
      assert.equal(result.failed_scene, -1);
      for (const file of [result.mp4, result.srt]) {
        assert.ok(file && fs.existsSync(file), 'missing output ' + file);
        assert.ok(fs.statSync(file).size > 0, 'empty output ' + file);
      }
      assert.ok(fs.readFileSync(result.srt, 'utf8').includes('-->'));
      assert.equal(path.dirname(result.mp4), out_dir);
    } finally {
      server.close();
    }
  });
});
