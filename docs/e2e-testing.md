# E2E Playwright Testing

Generate end-to-end Playwright test suites automatically by exploring your running web application via browser automation.

![E2E Testing Workflow Complete](images/e2e-workflow-complete.jpeg)

## Quick Start

```bash
# Test a local app (auto-detects framework)
/workflow:test-e2e http://localhost:8080

# With framework and auth
/workflow:test-e2e http://localhost:8080 --framework=symfony --auth=form

# Deep exploration
/workflow:test-e2e http://localhost:3000 --depth=5

# Just generate config files, skip test generation
/workflow:test-e2e http://localhost:8080 --config-only

# Custom output directory with markdown state file
/workflow:test-e2e http://localhost:4200 --output=e2e/specs --framework=vue --format=md
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--framework` | auto-detect | `symfony`, `laravel`, `vue`, `react`, `next`, `generic` |
| `--auth` | `none` | `none`, `form`, `token`, `cookie` |
| `--depth` | `3` | BFS exploration depth limit |
| `--output` | framework-dependent | Test output directory |
| `--config-only` | `false` | Only generate config, skip exploration and tests |
| `--format` | `org` | State file format: `org` or `md` |

## Pipeline

```
Setup --> Exploration --> Generation --> Validation --> Quality Gate --> Completion
  |          |               |              |              |              |
  |    e2e-explorer    e2e-generator   e2e-reviewer   quality-gate  completion-guard
  |    (driver-        (app map ->     (run tests,    (lint, type   (final check)
  |     agnostic)       test specs)    check quality)  check)
  v
 Install deps,
 detect framework,
 generate config
```

### Phase 0: Setup

Handled inline by the supervisor:

- Detect package manager (npm/yarn/pnpm)
- Install `@playwright/test` and chromium browser
- Generate `playwright.config.ts` from template with framework-specific webserver config
- Create output directory and update `.gitignore`
- Select browser driver per `resources/e2e/browser-driver.md` (see below)
- Configure auth fixtures (if `--auth` specified)

### Phase 1: Exploration

The `e2e-explorer` agent crawls the application using the selected browser driver:

- BFS traversal via navigate and accessibility snapshot actions
- Records all interactive elements (links, buttons, forms, inputs)
- Tracks which pages require authentication
- Detects SPA routing vs full navigation
- Outputs structured `app-map.json` with pages, navigation graph, and auth info

### Phase 2: Generation

The `e2e-generator` agent creates test files from the app map:

- Groups tests by feature (navigation, auth, forms, per-page)
- Enforces accessibility-first selector priority (see below)
- Generates meaningful test names: `test('should <action> when <condition>')`
- Auth-aware: uses authenticated fixture for protected pages, standard imports for public pages

### Phase 3: Validation

The `e2e-reviewer` agent runs and reviews tests in a loop (max 3 iterations):

- Executes tests with `npx playwright test`
- Checks selector quality, anti-patterns, test isolation, and assertions
- Runs flakiness check (3 runs, compares results)
- Issues tracked with `[ISSUE-N]` IDs, sent back to generator for fixes

### Phase 4-5: Quality Gate & Completion Guard

Standard workflow gates verify TypeScript compilation, linting, test passing, and page coverage against the app map.

## Selector Priority

All generated tests enforce accessibility-first selectors:

| Priority | Selector | Example |
|----------|----------|---------|
| 1 | `getByRole` | `page.getByRole('button', { name: 'Submit' })` |
| 2 | `getByLabel` | `page.getByLabel('Email')` |
| 3 | `getByPlaceholder` | `page.getByPlaceholder('Search...')` |
| 4 | `getByText` | `page.getByText('Welcome')` |
| 5 | `getByTestId` | `page.getByTestId('nav-menu')` |

**Blocked:** CSS selectors (`.class`, `#id`), XPath, auto-generated class names, `page.locator()` with CSS.

## Auth Strategies

### Form (`--auth=form`)

Discovers the login form via an accessibility snapshot (using the selected driver), generates `global-setup.ts` that authenticates before tests and saves session state. Test credentials are read from `E2E_USER` and `E2E_PASS` environment variables (never hardcoded).

### Token (`--auth=token`)

Generates a fixture that injects an authorization header from the `E2E_TOKEN` env var.

### Cookie (`--auth=cookie`)

Generates a fixture that sets a session cookie from the `E2E_SESSION_COOKIE` env var.

## Browser Driver Selection

E2E agents select a driver at runtime per `resources/e2e/browser-driver.md`. No single MCP is hard-required. The selection order is:

1. **Playwright MCP** — `mcp__playwright__browser_*` tools
2. **Chrome DevTools MCP** — `mcp__chrome-devtools__*` tools
3. **tpmcp UX-capture MCP** — `mcp__tpmcp-ux_capture__*` tools
4. **Local Playwright fallback** — standalone Node script with `ignoreHTTPSErrors: true` (used when no MCP is present or self-signed TLS blocks the MCP)

The selected driver is reported in the setup summary (e.g. `DRIVER: chrome-devtools`). Generated test specs are always Playwright (`@playwright/test` / `npx playwright test`) — only the live exploration is driver-agnostic, so `@playwright/test` is still installed as a dev dependency.

## Mandatory Gate in FE-Facing Workflows

Beyond this standalone command, `e2e_validation` is a **mandatory gate** in swarm and epic dev workflows whenever the change is FE-facing. FE-facing detection is performed by `lib/fe-detect-cli.js` — it triggers when the change set touches routes, components, templates, styles, assets, or FE config files. On a non-FE change the gate status is set to `skipped`. The gate is enforced by the `stop-guard` and `task-completed-gate` hooks via the phase order, so an FE-facing workflow cannot reach completion without passing `e2e_validation`.

## Framework Detection

Auto-detected from project files when `--framework` is omitted:

| Indicator | Framework |
|-----------|-----------|
| `symfony.lock` or `config/packages/` | symfony |
| `artisan` or `app/Http/Kernel.php` | laravel |
| `vue.config.js` or vite config with vue plugin | vue |
| `next.config.*` | next |
| `package.json` with `react-scripts` | react |
| None of the above | generic |

## Default Output Directories

| Framework | Directory |
|-----------|-----------|
| symfony | `tests/E2e` |
| laravel | `tests/E2e` |
| vue | `e2e` |
| react | `e2e` |
| next | `e2e` |
| generic | `tests/e2e` |

## Generated Files

A typical run produces:

```
playwright.config.ts                  - Playwright configuration
<output_dir>/app-map.json             - Application sitemap
<output_dir>/navigation.spec.ts       - Navigation and routing tests
<output_dir>/auth.spec.ts             - Login/logout/protected routes
<output_dir>/home.spec.ts             - Home page features
<output_dir>/forms.spec.ts            - Form validation and submission
<output_dir>/content.spec.ts          - Content page tests
<output_dir>/global-setup.ts          - Auth global setup (if --auth)
<output_dir>/auth-fixture.ts          - Authenticated test fixture (if --auth)
```

## Running Tests

```bash
npx playwright test              # All tests
npx playwright test --headed     # See the browser
npx playwright show-report       # HTML report
```

## Requirements

- Target web application running and accessible
- Node.js (included with Claude Code)
- `@playwright/test` dev dependency (auto-installed during setup) — required to run generated specs
- At least one browser driver available (Playwright MCP, Chrome DevTools MCP, tpmcp UX-capture MCP, or local Playwright). Playwright MCP is optional but recommended for the richest action mapping:
  ```json
  {
    "mcpServers": {
      "playwright": {
        "command": "npx",
        "args": ["@playwright/mcp@latest", "--headless"]
      }
    }
  }
  ```
