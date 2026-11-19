---
name: record-demo
description: Record a short demo video of a feature in a running web app, with a visible pointer, captions, an .srt file and an mp4
user_invocable: true
usage: /workflow:record-demo <what to show>
arguments:
  - name: what_to_show
    required: true
    description: The feature or flow to show, and the URL of the running app
---

# Record a feature demo

Records a feature in motion for stakeholders: a visible pointer that glides to each
control, click highlights, captions, title cards, a time-bounded `.srt` and an mp4.

A browser automation MCP cannot record video, so this skill uses a standalone Node
Playwright script. You write a small driver; the harness does the recording.

Output goes to the directory the caller names through `outDir`, by default a fresh
temporary directory. Never write the video, the driver or any scratch file inside the
repository.

## Step 1: dependency check

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/record-demo/deps.js" check --project <target project dir>
```

Add `--mode screen` when the flow needs several tabs or windows (Linux only).

The command prints JSON with `ok`, `mode`, `missing` and `items`. When `ok` is false,
install nothing on your own:

- If a workflow prompt asked for the recording, stop and return status `skipped` with the
  `missing` names.
- If a user asked for it, show each missing item with its `install` hint and wait for
  their decision.

## Step 2: write the driver

`${CLAUDE_PLUGIN_ROOT}` is already replaced with an absolute path in this text. Copy that
path literally into the script; the variable is not set in the Bash environment.

Write the driver into a temporary directory outside the repository:

```js
const { recordDemo } = require('${CLAUDE_PLUGIN_ROOT}/skills/record-demo/record-harness.js');

recordDemo({
  outName: 'feature-x-demo',
  outDir: process.env.DEMO_OUT_DIR,      // the directory the caller named; omit for a temp dir
  projectDir: process.cwd(),
  brand: 'Acme · Feature X',
  baseUrl: 'http://localhost:3000/',
  viewport: { width: 1280, height: 720 },
  scenes: [
    async (c) => {
      await c.page.goto(c.baseUrl);
      await c.titleCard('Feature X', 'Create a report in three steps');
      await c.sleep(2500);
      await c.dropTitleCard();
    },
    async (c) => {
      await c.caption('1', 'Open the form', 'from the toolbar');
      await c.click('#new-report');
      await c.sleep(1000);
    },
    async (c) => {
      await c.caption('2', 'Save it');
      await c.type('#title', 'Quarterly summary');
      await c.click('button[type=submit]');
      await c.mark('.toast');
      await c.sleep(3000);
    },
  ],
});
```

## Step 3: run it

Run the driver with node from the target project directory. Credentials come from
environment variables set at invocation; never put them in the script.

```bash
DEMO_OUT_DIR=<output dir> APP_USER=... APP_PASSWORD=... node <driver path>
```

## Step 4: read the result

The run prints `VIDEO_MP4=<path>` and `VIDEO_SRT=<path>`. A failed scene prints
`DEMO_ERROR scene[i]: ...`, sets exit code 1 and still saves the partial video.
`NO_VIDEO` or `FFMPEG_ERROR` mean no mp4 was produced (the raw `VIDEO_WEBM=` stays).
Report the file paths.

## Step 5: check the result

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/record-demo/contact-sheet.sh" <video> <out.png> 3 <t1> <t2> ...
```

Pick times (seconds) from the `.srt` cues, especially results, errors and toasts, then
look at the PNG. Two columns give larger tiles, three fit more moments.

## ctx helpers

Each helper takes a Playwright Locator or a CSS selector string.

| Helper | What it does |
|--------|--------------|
| `c.page`, `c.baseUrl`, `c.sleep(ms)` | The Playwright page, the configured base URL, a pause |
| `c.goto(url)` | Navigate and wait for the network to settle |
| `c.caption(step, title, sub?)` | Caption bar at the top; starts a new subtitle cue |
| `c.titleCard(big, small?)` / `c.dropTitleCard()` | Full-screen card; hides the pointer and the caption until dropped |
| `c.click(target, opts?)` | Glide, outline, ripple, then a real click |
| `c.type(target, text)` | Click a field, clear it, type at a human pace |
| `c.press(key, label?)` | Key press with a keycap |
| `c.choose(target, value)` | Native select: draws its list and picks the option |
| `c.mark(target)` / `c.unmark()` | Outline a result until unmarked |
| `c.point`, `c.moveTo`, `c.flash`, `c.keycap`, `c.pointerVisible` | Lower-level pointer pieces |

Options of `recordDemo`: `outName`, `outDir`, `projectDir`, `baseUrl`, `viewport`,
`scenes`, `brand`, `accent`, `pointerAccent`, `css`, `headless`, `keepWebm`, `mode`,
`subtitles`, `subtitlesBurn`, `frameRate`, `contextOptions`, `pointer`. It returns
`{ mp4, srt, webm, failed_scene }`.

## Modes

| | `page` (default) | `screen` |
|---|---|---|
| Capture | Playwright video of one page | Xvfb display grabbed by ffmpeg x11grab |
| Other tabs and windows | Not captured | Captured |
| Platform | Any | Linux only |
| Extra needs | none | Xvfb |

## Environment variables

| Variable | Use |
|----------|-----|
| `PLAYWRIGHT_MODULE_PATH` | A playwright package directory; tried first |
| `NODE_PATH` | Each entry is checked for `playwright`; tried second |
| `RECORD_DEMO_CHROMIUM` | A Chromium executable to use instead of Playwright's own build |
| `DEMO_DISPLAY` | Screen mode: the X display number to use |

The project's `node_modules` and then the global npm root are tried after those.

## Pacing

About 1 s between clicks, 2.5 to 4 s on a result, 45 to 75 s per feature. Stakeholders
need time to read each caption and see the outcome.

## Gotchas

- The caption bar is page text, so `:has-text(...)` selectors can match it. Use `id`,
  role or test-id selectors.
- Never tint backgrounds to highlight something; use `c.mark`, which outlines only.
- Native select lists are not captured in the video; use `c.choose`.
- Avoid `alert` and `confirm` dialogs in the flow; they are not recorded.
