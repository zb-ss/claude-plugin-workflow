# Tool-Agnostic Browser Driver

E2E phases (explore, generate, validate, live-test) must drive a real browser,
but the available driver varies by session. **Do not hardcode one MCP.** At the
start of any browser work, select a driver by availability and map your browser
actions onto it. The artifacts you produce (app maps, specs, validation results)
are the same regardless of which driver served them.

## Selection order (use the first available)

Check your own available tools for each prefix, in this order, and use the first
one present:

1. **Playwright MCP** — tools prefixed `mcp__playwright__browser_*`
2. **Chrome DevTools MCP** — tools prefixed `mcp__chrome-devtools__*`
3. **tpmcp UX-capture MCP** — tools prefixed `mcp__tpmcp-ux_capture__*`
4. **Local Playwright fallback** — none of the above present, or a self-signed
   TLS error blocks the MCP (see below). Drive the browser with a standalone
   Node Playwright script launched with `ignoreHTTPSErrors: true`.

State which driver you selected in your output (e.g. `DRIVER: chrome-devtools`)
so the run is reproducible.

## Action mapping

| Action | Playwright MCP | Chrome DevTools MCP | tpmcp UX-capture |
|---|---|---|---|
| open/navigate | `browser_navigate` | `navigate_page` / `new_page` | `launch` (then `refresh`) |
| accessibility snapshot | `browser_snapshot` | `take_snapshot` | `snapshot` / `screen_stack` |
| screenshot | `browser_take_screenshot` | `take_screenshot` | `screenshot` |
| click | `browser_click` | `click` | `click` |
| type / fill | `browser_type` / `browser_fill_form` | `fill` / `fill_form` | `type` |
| key press | `browser_press_key` | (via `evaluate_script`) | `press` |
| wait for element/state | `browser_wait_for` | `wait_for` | `wait_for` / `wait_idle` |
| read console | `browser_console_messages` | `list_console_messages` | `notifications` |
| read network | `browser_network_requests` | `list_network_requests` | — |
| run JS in page | `browser_evaluate` | `evaluate_script` | `inspect` / `selectors` |
| close/teardown | `browser_close` | `close_page` | `teardown` |

Where a cell is `—`, that capability isn't directly exposed by that driver — fall
back to the next driver in the order, or to the local Playwright script, for the
steps that need it. Prefer the **accessibility snapshot** over screenshots for
locating elements (more robust selectors) on every driver that offers one.

## Self-signed TLS fallback

If the chosen MCP's navigate fails with `ERR_CERT_AUTHORITY_INVALID` (common on
local/staging HTTPS), do **not** skip the test. Drop to the local Playwright
fallback launched with `ignoreHTTPSErrors: true`:

```js
const { chromium } = require('playwright');
const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
await page.goto(targetUrl);
// ... drive the same flow, capture the same artifacts ...
await browser.close();
```

## Credentials

If a flow needs an authenticated state, read the project's `./.creds` file first
(test credentials usually live there). Never echo `.creds` contents into logs,
commits, or PRs, and never commit it. If `.creds` is missing or lacks the needed
account, ask the user rather than skipping the test.

## Cleanup

Delete any test records your E2E run created (DB rows, object-storage blobs, sent
emails, created branches). Leaving test data behind is itself a regression.
