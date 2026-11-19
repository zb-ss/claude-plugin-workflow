/**
 * record-harness.js: reusable demo-recording harness.
 *
 * A browser automation MCP cannot record video. This is a standalone Node Playwright
 * runner that records a feature in motion and converts it to mp4 with ffmpeg. It owns
 * the boilerplate (browser discovery, recording, caption overlays, subtitle generation,
 * mp4 conversion). You supply the `scenes`.
 *
 * Two recording modes (pick with `mode`):
 *   - 'page'   (default) Playwright `recordVideo` of a single Page. Lowest friction.
 *                        Does not capture other tabs or windows.
 *   - 'screen' headed Chromium on a private Xvfb display, captured with `ffmpeg x11grab`.
 *                        Captures everything on screen, so real tab switching shows up.
 *                        Linux only; needs Xvfb and an ffmpeg build with x11grab.
 *
 * Pointer (on by default, `pointer: false` turns it off): pointer-kit.js draws a mouse
 * pointer that glides to every target, rings and outlines what is clicked, and adds the
 * input helpers ctx.click / ctx.type / ctx.choose / ctx.press / ctx.mark. Drive every
 * visible interaction through them; recordVideo itself never shows a cursor.
 *
 * Subtitles: every caption() / titleCard() call is timestamped, so the harness writes a
 * time-bounded `<outName>.srt` next to the mp4 (and can burn it in). A cue ends when the
 * next caption or title card starts, so a caption never overstays into the result.
 *
 * Usage (write a small driver outside the repository and run it with node):
 *
 *   const { recordDemo } = require('/absolute/path/to/record-harness.js');
 *   recordDemo({
 *     outName: 'feature-x-demo',            // -> <outDir>/feature-x-demo.mp4 (+ .srt)
 *     outDir: '/tmp/demo-output',           // default: a fresh temp directory
 *     brand: 'Acme · Feature X',
 *     baseUrl: 'http://localhost:3000/',
 *     scenes: [
 *       async (c) => { await c.goto(c.baseUrl); await c.titleCard('Feature X', 'in under a minute'); await c.sleep(2500); await c.dropTitleCard(); },
 *       async (c) => { await c.caption('1', 'Open the form'); await c.click('#open'); await c.sleep(1000); },
 *     ],
 *   });
 *
 * Never hardcode credentials in the driver; read them from process.env. The harness
 * never logs env values.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { createPointerKit } = require('./pointer-kit');
const { checkDependencies, requirePlaywright, findChromium } = require('./deps');

const DEFAULT_ACCENT = '#2563eb';
const CARD_BACKGROUND = '#111827';

// ---- in-page helpers (injected via page.evaluate) --------------------------

// Each helper takes ONE object arg: page.evaluate(fn, arg) passes a single argument.
// The page functions are self-contained because they are serialized into the page.
const PAGE_HELPERS = {
  caption({ step, title, sub, accent }) {
    const make = (tag, style, text) => {
      const node = document.createElement(tag);
      node.style.cssText = style;
      if (text) node.textContent = text;
      return node;
    };
    let bar = document.getElementById('demo-caption');
    if (!bar) {
      bar = make('div', [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
        'background:' + accent, 'color:#fff',
        'font-family:Arial,Helvetica,sans-serif', 'padding:14px 26px',
        'box-shadow:0 4px 18px rgba(0,0,0,.35)', 'display:flex',
        'align-items:baseline', 'gap:16px',
      ].join(';'));
      bar.id = 'demo-caption';
      document.body.appendChild(bar);
    }
    bar.textContent = '';
    bar.appendChild(make('span', 'font-size:30px;font-weight:800;line-height:1', step));
    bar.appendChild(make('span', 'font-size:22px;font-weight:700', title));
    if (sub) bar.appendChild(make('span', 'font-size:15px;opacity:.9;margin-left:auto', sub));
  },
  titleCard({ brand, big, small, accent, background }) {
    const make = (tag, style, text) => {
      const node = document.createElement(tag);
      node.style.cssText = style;
      if (text) node.textContent = text;
      return node;
    };
    const card = make('div', [
      'position:fixed', 'inset:0', 'z-index:2147483646', 'background:' + background,
      'color:#fff', 'display:flex', 'flex-direction:column', 'align-items:center',
      'justify-content:center', 'font-family:Arial,Helvetica,sans-serif', 'text-align:center',
    ].join(';'));
    card.id = 'demo-titlecard';
    card.appendChild(make('div', 'letter-spacing:.35em;text-transform:uppercase;color:' + accent + ';font-weight:700;font-size:15px;margin-bottom:18px', brand));
    card.appendChild(make('div', 'font-size:46px;font-weight:600;max-width:1100px;line-height:1.2', big));
    if (small) card.appendChild(make('div', 'font-size:20px;color:#9ca3af;margin-top:18px;max-width:900px', small));
    document.body.appendChild(card);
  },
  dropTitleCard() {
    const card = document.getElementById('demo-titlecard');
    if (card) card.remove();
  },
};

// ---- subtitle (.srt) helpers -----------------------------------------------

function msToSrt(ms) {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const z = Math.floor(ms % 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(z, 3)}`;
}

function buildSrt(cues) {
  // cues: [{ start, end, text }] in ms relative to record start
  return cues
    .filter((c) => c.text && c.end > c.start)
    .map((c, i) => `${i + 1}\n${msToSrt(c.start)} --> ${msToSrt(c.end)}\n${c.text}\n`)
    .join('\n') + '\n';
}

/** Cue bookkeeping: opening a cue closes the current one, so each cue ends when the next starts. */
function createCueTracker(now) {
  const cues = [];
  let current = null;
  const close = () => {
    if (!current) return;
    current.end = now();
    cues.push(current);
    current = null;
  };
  const open = (text) => {
    close();
    current = { start: now(), end: now() + 1, text };
  };
  return { open, close, cues };
}

// ---- screen-mode capture helpers (Xvfb + ffmpeg x11grab) -------------------

function pickFreeDisplay() {
  for (let n = 99; n >= 80; n--) {
    if (!fs.existsSync(`/tmp/.X${n}-lock`) && !fs.existsSync(`/tmp/.X11-unix/X${n}`)) return n;
  }
  return 99;
}

function waitForFile(p, timeout_ms) {
  const deadline = Date.now() + timeout_ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(p)) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('timeout waiting for ' + p));
      setTimeout(tick, 80);
    };
    tick();
  });
}

async function startXvfb(display_num, width, height) {
  const proc = spawn('Xvfb', [`:${display_num}`, '-screen', '0', `${width}x${height}x24`, '-nolisten', 'tcp'], {
    stdio: 'ignore',
  });
  await waitForFile(`/tmp/.X${display_num}-lock`, 5000);
  await new Promise((r) => setTimeout(r, 300)); // let the server settle
  return proc;
}

function startFfmpegX11(display_num, width, height, fps, out_path) {
  return spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'x11grab', '-draw_mouse', '1',
    '-video_size', `${width}x${height}`, '-framerate', String(fps),
    '-i', `:${display_num}.0+0,0`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
    '-movflags', '+faststart', out_path,
  ], { stdio: ['pipe', 'ignore', 'inherit'] });
}

function stopFfmpeg(proc) {
  // 'q' on stdin lets ffmpeg finalize the mp4 (moov atom etc.)
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    proc.on('exit', finish);
    try { proc.stdin.write('q'); } catch (e) { try { proc.kill('SIGINT'); } catch (e2) { /* gone */ } }
    setTimeout(() => { try { proc.kill('SIGINT'); } catch (e) { /* gone */ } }, 4000);
    setTimeout(finish, 8000);
  });
}

function killQuiet(proc) {
  if (!proc) return;
  try { proc.kill('SIGTERM'); } catch (e) { /* gone */ }
  setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } }, 1500);
}

// Hardcode the sidecar .srt into the mp4 (libass).
function burnSubtitles(mp4_path, srt_path) {
  try {
    const tmp = mp4_path.replace(/\.mp4$/, '.subbed.mp4');
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', mp4_path,
      '-vf', `subtitles=${srt_path.replace(/[\\:']/g, (m) => '\\' + m)}`,
      '-c:a', 'copy', '-movflags', '+faststart', tmp,
    ]);
    fs.renameSync(tmp, mp4_path);
  } catch (e) {
    console.error('SUBTITLE_BURN_ERROR: ' + e.message + ' (soft .srt still written)');
  }
}

// ---- main entry ------------------------------------------------------------

function assertDependencies(mode, project_dir) {
  if (mode === 'screen' && process.platform !== 'linux') {
    throw new Error('record-demo: screen mode needs Linux (Xvfb and ffmpeg x11grab); use mode "page" on this platform');
  }
  const report = checkDependencies({ mode, project_dir });
  if (!report.ok) {
    const parts = report.items.filter((i) => !i.ok).map((i) => `${i.name} (${i.install})`);
    throw new Error('record-demo: missing dependencies: ' + parts.join('; '));
  }
}

async function recordDemo(config) {
  const {
    outName = 'demo',
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-demo-')),
    projectDir = process.cwd(),
    baseUrl = '',
    viewport = { width: 1920, height: 1080 },
    scenes = [],
    brand = 'Demo',
    accent = DEFAULT_ACCENT,
    headless = true,           // page mode only; screen mode is always headed
    keepWebm = false,
    mode = 'page',             // 'page' | 'screen'
    subtitles = true,          // write <outName>.srt
    subtitlesBurn = false,     // also hardcode subs into the mp4
    frameRate = 25,            // screen mode capture fps
    contextOptions = {},       // extra Playwright newContext options (e.g. httpCredentials, storageState)
    pointer = true,            // draw the pointer and click highlights, add the ctx input helpers
    pointerAccent,             // #rrggbb for the pointer ring and outlines
    css = '',                  // presentation CSS for every page (hide debug bars, move toasts below the caption)
  } = config;

  assertDependencies(mode, projectDir);

  const out_dir = path.resolve(outDir);
  fs.mkdirSync(out_dir, { recursive: true });
  const pw = requirePlaywright({ project_dir: projectDir });
  const { chromium } = pw;
  const exec_path = findChromium(pw) || undefined;
  const mp4_path = path.join(out_dir, outName + '.mp4');
  const srt_path = path.join(out_dir, outName + '.srt');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let record_start_ms = Date.now();
  const tracker = createCueTracker(() => Date.now() - record_start_ms);
  const one_line = (s) => (s || '').replace(/\s*\n\s*/g, ' ').trim();

  // ctx handed to every scene: wraps the page helpers and records subtitle cues.
  // With the pointer on, ctx also carries the pointer-kit helpers (click, type, choose ...).
  const makeCtx = (page, kit) => ({
    ...(kit || {}),
    page,
    baseUrl,
    sleep,
    caption: async (step, title, sub) => {
      tracker.open(`${step}. ${one_line(title)}${sub ? ' — ' + one_line(sub) : ''}`);
      await page.evaluate(PAGE_HELPERS.caption, { step, title, sub: sub || '', accent });
      if (kit) await kit.persistCaption();
    },
    // A title card starts a new chapter: it clears the caption bar and hides the pointer.
    titleCard: async (big, small) => {
      tracker.open(`${one_line(big)}${small ? ' — ' + one_line(small) : ''}`);
      if (kit) { await kit.clearCaption(); await kit.pointerVisible(false, true); }
      await page.evaluate(PAGE_HELPERS.titleCard, { brand, big, small: small || '', accent, background: CARD_BACKGROUND });
    },
    dropTitleCard: async () => {
      tracker.close();
      await page.evaluate(PAGE_HELPERS.dropTitleCard);
      if (kit) await kit.pointerVisible(true);
    },
  });
  const withKit = async (context, page) => {
    if (!pointer) {
      if (css) {
        await context.addInitScript((c) => {
          const add = () => { const s = document.createElement('style'); s.textContent = c; document.documentElement.appendChild(s); };
          if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
        }, css);
      }
      return makeCtx(page, null);
    }
    const kit = createPointerKit(page, { accent: pointerAccent || accent, css });
    await kit.install(context);
    return makeCtx(page, kit);
  };

  let failed_scene = -1;
  const runScenes = async (ctx) => {
    record_start_ms = Date.now(); // align subtitle t=0 with the moment recording is live
    for (let i = 0; i < scenes.length; i++) {
      try {
        await scenes[i](ctx);
      } catch (err) {
        failed_scene = i;
        console.error('DEMO_ERROR scene[' + i + ']: ' + (err && err.message));
        break; // stop on first failure; the partial video still saves
      }
    }
    tracker.close();
  };

  // Write the .srt from the cues, optionally burn it in, print the result paths.
  const finish = (webm_path) => {
    const have_mp4 = fs.existsSync(mp4_path);
    let wrote_srt = false;
    if (subtitles && tracker.cues.length) {
      try {
        fs.writeFileSync(srt_path, buildSrt(tracker.cues));
        wrote_srt = true;
      } catch (e) { console.error('SRT_ERROR: ' + e.message); }
      if (wrote_srt && subtitlesBurn && have_mp4) burnSubtitles(mp4_path, srt_path);
    }
    if (wrote_srt) console.log('VIDEO_SRT=' + srt_path);
    if (have_mp4) console.log('VIDEO_MP4=' + mp4_path);
    if (failed_scene >= 0) process.exitCode = 1;
    return {
      mp4: have_mp4 ? mp4_path : null,
      srt: wrote_srt ? srt_path : null,
      webm: webm_path && fs.existsSync(webm_path) ? webm_path : null,
      failed_scene,
    };
  };

  if (mode === 'screen') {
    const display_num = parseInt(process.env.DEMO_DISPLAY || '', 10) || pickFreeDisplay();
    const W = viewport.width, H = viewport.height;
    let xvfb = null, ffmpeg = null, browser = null;
    try {
      xvfb = await startXvfb(display_num, W, H);
      // On Wayland hosts Chrome's Ozone backend would pick Wayland and ignore the Xvfb
      // display (x11grab then sees a black screen), so strip the Wayland env and pin X11.
      // Xvfb has no GPU, so force software rendering; --start-fullscreen fills the display
      // without a window manager.
      const child_env = { ...process.env, DISPLAY: `:${display_num}` };
      delete child_env.WAYLAND_DISPLAY;
      delete child_env.XDG_SESSION_TYPE;
      browser = await chromium.launch({
        headless: false,
        executablePath: exec_path,
        env: child_env,
        args: [
          '--ozone-platform=x11', '--ozone-platform-hint=x11',
          '--window-position=0,0', `--window-size=${W},${H}`, '--start-fullscreen',
          '--disable-gpu', '--use-gl=swiftshader', '--disable-gpu-compositing',
          '--no-first-run', '--no-default-browser-check',
          '--deny-permission-prompts', '--disable-notifications',
          '--disable-features=Translate,MediaRouter',
        ],
      });
      const context = await browser.newContext({ viewport: null, ignoreHTTPSErrors: true, ...contextOptions });
      const page = await context.newPage();
      await page.goto('about:blank').catch(() => {}); // a real window from frame 1
      ffmpeg = startFfmpegX11(display_num, W, H, frameRate, mp4_path);
      await sleep(600); // let ffmpeg start grabbing

      await runScenes(await withKit(context, page));

      await sleep(300);
      await stopFfmpeg(ffmpeg); ffmpeg = null;
      await context.close().catch(() => {});
      await browser.close().catch(() => {}); browser = null;
    } finally {
      if (ffmpeg) await stopFfmpeg(ffmpeg);
      killQuiet(browser && browser.process && browser.process());
      try { if (browser) await browser.close(); } catch (e) { /* already closed */ }
      killQuiet(xvfb);
    }
    return finish(null);
  }

  // page mode
  const raw_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-rec-'));
  const browser = await chromium.launch({ headless, executablePath: exec_path });
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: raw_dir, size: viewport },
    ignoreHTTPSErrors: true,
    ...contextOptions,
  });
  const page = await context.newPage();

  let webm_path = null;
  try {
    await runScenes(await withKit(context, page));
  } finally {
    const vid = page.video();
    await context.close(); // finalizes the webm
    await browser.close();
    webm_path = vid ? await vid.path() : null;

    if (webm_path && fs.existsSync(webm_path)) {
      try {
        execFileSync('ffmpeg', [
          '-y', '-loglevel', 'error', '-i', webm_path,
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20',
          '-preset', 'medium', '-movflags', '+faststart', mp4_path,
        ]);
      } catch (e) {
        console.error('FFMPEG_ERROR: ' + e.message + ' (raw webm kept at ' + webm_path + ')');
      }
    } else {
      console.error('NO_VIDEO produced');
    }
  }

  const keep = keepWebm || !fs.existsSync(mp4_path);
  if (keep && webm_path) console.log('VIDEO_WEBM=' + webm_path);
  const result = finish(keep ? webm_path : null);
  if (!keep) { try { fs.rmSync(raw_dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
  return result;
}

module.exports = { recordDemo, createCueTracker, buildSrt, msToSrt };
