---
name: test-e2e
description: Run E2E Playwright testing workflow for web applications
user_invocable: true
usage: /workflow:test-e2e <url> [--framework=<framework>] [--auth=<strategy>] [--depth=<n>] [--mode=<mode>] [--output=<dir>] [--config-only] [--format=<format>]
arguments:
  - name: url
    required: true
    description: Base URL of the web application to test (e.g., http://localhost:8080)
  - name: framework
    required: false
    description: "Framework type: symfony, laravel, vue, react, next, generic (auto-detected if omitted)"
  - name: auth
    required: false
    description: "Auth strategy: none, form, token, cookie (default: none)"
  - name: depth
    required: false
    description: "Exploration depth limit (default: 3)"
  - name: mode
    required: false
    description: "Execution mode: standard, turbo, eco, thorough (default: standard)"
  - name: output
    required: false
    description: "Test output directory (default: tests/e2e or e2e)"
  - name: config-only
    required: false
    description: "Only generate config files, skip exploration and test generation"
  - name: format
    required: false
    description: "State file format: org, md (default: org)"
---

# E2E Playwright Testing Workflow

Orchestrate end-to-end test generation for web applications using Playwright MCP browser automation.

## AGENTIC MODE ACTIVE

This workflow runs in **fully autonomous agentic mode**. Do NOT ask for permission on non-destructive operations.

> **REQUIRED:** The project MUST have `Bash(*)` in its permissions allow list.
> Without this, bash commands will prompt for permission and break autonomous execution.

### CRITICAL: Never Use `~` in Tool Calls

The Write, Read, Glob, and Edit tools do NOT expand `~`. You MUST run `echo $HOME` first and use the absolute path in ALL tool calls.

### Permission Model

**DO WITHOUT ASKING:**
- Read any file in the project
- Write/Edit files in the project (test files, config files)
- Install npm packages (`npm install --save-dev @playwright/test`)
- Install Playwright browsers (`npx playwright install chromium`)
- Run Playwright tests (`npx playwright test`)
- Use Playwright MCP tools (browser_navigate, browser_snapshot, etc.)
- Spawn subagents via Task tool
- Create directories

**ASK BEFORE:**
- `git commit` - User reviews and commits
- `git push` - User pushes when ready
- Deleting files (`rm`) - Confirm before removal
- Modifying existing non-test source files

**ALWAYS BLOCKED:**
- `rm -rf` on directories
- `git push --force`
- System file modifications
- Package publishing

### Autonomous Execution Principle

Proceed autonomously through all phases. Only pause for:
1. Explicit user intervention
2. Review gate failures after max iterations
3. Destructive operations
4. Connection failures to the target URL

---

## Usage

```
/workflow:test-e2e <url> [options]
```

### Examples

```bash
# Test local Symfony app
/workflow:test-e2e http://localhost:8080 --framework=symfony --auth=form

# Test React app with default settings
/workflow:test-e2e http://localhost:3000

# Just generate config, no tests
/workflow:test-e2e http://localhost:8080 --config-only

# Thorough mode with deep exploration
/workflow:test-e2e http://localhost:8080 --mode=thorough --depth=5

# Custom output directory
/workflow:test-e2e http://localhost:4200 --output=e2e/specs --framework=vue
```

## Workflow Phases

```
Setup --> Exploration --> Generation --> Validation --> Quality Gate --> Completion
  |          |               |              |              |              |
  |    e2e-explorer    e2e-generator   e2e-reviewer   quality-gate  completion-guard
  |    (Playwright     (app map ->     (run tests,    (lint, type   (final check)
  |     MCP tools)      test specs)    check quality)  check)
  v
 Install deps,
 detect framework,
 generate config
```

## Agent Routing by Mode

| Phase | standard | turbo | eco | thorough |
|-------|----------|-------|-----|----------|
| Setup | inline | inline | inline | inline |
| Exploration | e2e-explorer (sonnet) | e2e-explorer (haiku) | e2e-explorer (haiku) | e2e-explorer (sonnet) |
| Generation | e2e-generator (sonnet) | e2e-generator (haiku) | e2e-generator (haiku) | e2e-generator (sonnet) |
| Validation | e2e-reviewer (sonnet) | e2e-reviewer (haiku) | e2e-reviewer (haiku) | e2e-reviewer (opus) |
| Quality Gate | quality-gate (sonnet) | quality-gate (haiku) | quality-gate (haiku) | quality-gate (sonnet) |
| Completion | completion-guard (sonnet) | completion-guard (haiku) | completion-guard (haiku) | completion-guard (opus) |

### Max Review Iterations by Mode

| Mode | Validation (e2e-reviewer) | Quality Gate |
|------|---------------------------|--------------|
| eco | 1 | 1 |
| turbo | 2 | 1 |
| standard | 3 | 2 |
| thorough | 3 | 3 |

---

## Supervisor Instructions

You are the **supervisor agent** for the E2E testing workflow. You coordinate all phases, spawn subagents, and maintain state.

### Initialization

Follow these steps in order:

#### Step 0a: Get absolute home path

```bash
echo $HOME
```

Store the result (e.g., `/home/zashboy`). Use this for ALL file paths.

#### Step 0b: Create directories

Ensure workflow directories exist (use ABSOLUTE paths):
```
$HOME_PATH/.claude/workflows/active/.gitkeep
$HOME_PATH/.claude/workflows/completed/.gitkeep
```

#### Step 1: Parse input

1. Extract URL (first argument, required)
2. Parse flags:
   - `--framework=<val>` (default: auto-detect)
   - `--auth=<val>` (default: none)
   - `--depth=<n>` (default: 3)
   - `--mode=<val>` (default: standard)
   - `--output=<dir>` (default: auto-detect based on framework)
   - `--config-only` (boolean flag)
   - `--format=<val>` (default: org)
3. If URL missing, ask user

#### Step 2: Validate URL

Before anything else, validate and test the target URL:

**URL scheme validation (MANDATORY):**
Only `http://` and `https://` URLs are accepted. Reject `file://`, `ftp://`, `javascript:`, `data:`, and any other scheme.

```bash
# Validate URL scheme
URL_SCHEME=$(echo "<url>" | grep -oP '^[a-z]+(?=://)')
if [ "$URL_SCHEME" != "http" ] && [ "$URL_SCHEME" != "https" ]; then
  echo "ERROR: Only http:// and https:// URLs are supported"
  # Stop and inform user
fi

# Check reachability
curl -sS -o /dev/null -w "%{http_code}" --max-time 10 <url>
```

- If invalid scheme: Report error and stop
- If HTTP 000/timeout: Warn user that URL is unreachable, ask if they want to proceed anyway
- If HTTP 4xx/5xx: Note it but proceed (app may need auth)
- If HTTP 2xx/3xx: Proceed

#### Step 3: Detect framework (if not specified)

Check the project directory for framework indicators:

| File/Pattern | Framework |
|-------------|-----------|
| `symfony.lock` or `config/packages/` | symfony |
| `artisan` or `app/Http/Kernel.php` | laravel |
| `vue.config.js` or `vite.config.ts` with vue plugin | vue |
| `next.config.*` | next |
| `package.json` scripts with `react-scripts` | react |
| None of the above | generic |

If auto-detected, confirm with user: "Detected framework: **{framework}**. Correct?"

#### Step 4: Detect output directory

Default test directory based on framework:

| Framework | Default Output Dir |
|-----------|--------------------|
| symfony | `tests/E2e` |
| laravel | `tests/E2e` |
| vue | `e2e` |
| react | `e2e` |
| next | `e2e` |
| generic | `tests/e2e` |

#### Step 5: Create workflow state

Generate workflow ID: `YYYYMMDD-<random>` (e.g., `20260213-abc123`)

**Create state file** using the template from the plugin:
- Read template: `<PLUGIN_DIR>/templates/e2e-testing.<format>`
- Replace placeholders:
  - `{{WORKFLOW_ID}}` -> generated ID
  - `{{TITLE}}` -> URL + framework description
  - `{{DESCRIPTION}}` -> full task description
  - `{{DATE}}` -> current date
  - `{{TIMESTAMP}}` -> ISO timestamp
  - `{{BRANCH}}` -> current branch
  - `{{BASE_BRANCH}}` -> main/master
  - `{{MODE}}` -> selected mode
  - `{{STATE_FILE}}` -> path to .state.json
  - `{{TESTS_ENABLED}}` -> "true"
  - `{{BASE_URL}}` -> target URL
  - `{{FRAMEWORK}}` -> detected/specified framework
  - `{{AUTH_STRATEGY}}` -> auth flag value
  - `{{DEPTH}}` -> depth limit
  - `{{OUTPUT_DIR}}` -> resolved output directory
- Write to: `$HOME/.claude/workflows/active/<id>.<format>`

**Create JSON state sidecar:**

```json
{
  "$schema": "1.0.0",
  "workflow_id": "<id>",
  "org_file": "<HOME>/.claude/workflows/active/<id>.<format>",
  "workflow": {
    "type": "e2e-testing",
    "description": "<description>",
    "branch": "<branch>"
  },
  "mode": {
    "current": "<mode>",
    "original": "<mode>"
  },
  "config": {
    "tests_enabled": true,
    "base_url": "<url>",
    "framework": "<framework>",
    "auth_strategy": "<auth>",
    "depth": <depth>,
    "output_dir": "<output_dir>",
    "max_validation_iterations": <from mode>,
    "max_quality_iterations": <from mode>
  },
  "phase": {
    "current": "setup",
    "completed": [],
    "remaining": ["e2e_exploration", "e2e_generation", "e2e_validation", "quality_gate", "completion_guard"]
  },
  "gates": {
    "setup":              { "status": "pending", "iteration": 0 },
    "e2e_exploration":    { "status": "pending", "iteration": 0 },
    "e2e_generation":     { "status": "pending", "iteration": 0 },
    "e2e_validation":     { "status": "pending", "iteration": 0 },
    "quality_gate":       { "status": "pending", "iteration": 0 },
    "completion_guard":   { "status": "pending", "iteration": 0 }
  },
  "agent_log": [],
  "updated_at": "<timestamp>"
}
```

Write to: `$HOME/.claude/workflows/active/<id>.state.json`

Verify both files by reading them back.

#### Step 5.5: Bind session to workflow

After creating the state files, bind this session to the workflow so hooks only affect this workflow.

First, get the OS temp directory:
```bash
node -e "console.log(require('os').tmpdir())"
```
Store this as `$TMPDIR_PATH`.

1. Glob for `$TMPDIR_PATH/workflow-session-marker-*.json` and read the most recent file to get the `session_id`
2. Write `$TMPDIR_PATH/workflow-binding-{session_id}.json` with:
   ```json
   {
     "session_id": "<session_id>",
     "workflow_path": "<HOME>/.claude/workflows/active/<id>.state.json",
     "workflow_id": "<generated-id>",
     "bound_at": "<ISO timestamp>"
   }
   ```
3. Verify by reading the binding file back

If no session marker is found, skip this step (backward compatible — hooks will fall back to most recent workflow).

#### Step 6: Confirm with user

Show summary:
```
E2E Testing Workflow
  URL:       <url>
  Framework: <framework>
  Auth:      <auth>
  Depth:     <depth>
  Mode:      <mode>
  Output:    <output_dir>
  State:     ~/.claude/workflows/active/<id>.<format>

Ready to begin Phase 0: Setup?
```

---

### Phase 0: Setup (inline - no subagent)

The supervisor handles setup directly. This phase installs dependencies and configures Playwright.

#### 0.1 Detect package manager

```bash
# Check in priority order
if [ -f pnpm-lock.yaml ]; then echo "pnpm"
elif [ -f yarn.lock ]; then echo "yarn"
elif [ -f package-lock.json ] || [ -f package.json ]; then echo "npm"
else echo "npm"  # default
fi
```

#### 0.2 Check and install @playwright/test

```bash
# Check if already installed
npx playwright --version 2>/dev/null

# If not installed:
<pkg_manager> install --save-dev @playwright/test
```

#### 0.3 Install browsers

```bash
npx playwright install chromium
```

Only install chromium by default. Users can add firefox/webkit later.

#### 0.4 Generate playwright.config.ts (if missing)

Read the config template from the plugin:
```
<PLUGIN_DIR>/resources/e2e/playwright.config.ts.template
```

Replace placeholders:
- `{{OUTPUT_DIR}}` -> resolved output directory
- `{{BASE_URL}}` -> target URL
- `{{WEBSERVER_CONFIG}}` -> look up framework in `<PLUGIN_DIR>/resources/e2e/webserver-configs.json`

If `webserver-configs.json` has a config for the framework, add:
```typescript
webServer: {
  command: '<command>',
  url: '<url>',
  reuseExistingServer: true,
},
```

If framework config is `null` (generic), omit the webServer block.

**Port validation:** If substituting `{{PORT}}` in webserver configs, validate that the value is a numeric integer between 1024 and 65535. Reject any non-numeric port values.

Write `playwright.config.ts` to the project root.

#### 0.5 Create output directory and update .gitignore

```bash
mkdir -p <output_dir>
```

**MANDATORY: Update .gitignore** to prevent accidental commit of auth state and test artifacts:

Check if `.gitignore` exists. If so, append these entries (if not already present):
```
# Playwright E2E
.auth/
auth.json
test-results/
playwright-report/
blob-report/
```

If `.gitignore` does not exist, create it with these entries.

#### 0.6 Verify Playwright MCP tools

Check that the Playwright MCP server tools are accessible by attempting a simple operation:
```
browser_navigate to <url>
```

If this fails with "tool not found" or similar, inform the user:
```
Playwright MCP server is not configured. Add it to your Claude Code settings:

{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless"]
    }
  }
}
```

If the URL is unreachable from the MCP browser, report the connection error.

#### 0.7 Auth setup (if --auth is not "none")

If auth strategy is specified:

**For `--auth=form`:**
- Use browser_snapshot on the URL to find login form fields
- Read template from `<PLUGIN_DIR>/resources/e2e/global-setup.ts.template`
- Replace placeholders based on discovered form fields:
  - `{{LOGIN_URL}}` -> URL where the login form is
  - `{{EMAIL_LABEL}}` -> detected email/username label
  - `{{PASSWORD_LABEL}}` -> detected password label
  - `{{SUBMIT_TEXT}}` -> detected submit button text
  - `{{POST_LOGIN_URL}}` -> detected redirect URL after login
  - `{{AUTH_STATE_FILE}}` -> `<output_dir>/.auth/state.json`
- Write `global-setup.ts` to the output directory
- Read and write `auth-fixture.ts.template` to the output directory
- Ask user for test credentials (E2E_USER, E2E_PASS env vars)

**For `--auth=token`:**
- Ask user for the token env var name (default: `E2E_TOKEN`)
- Generate a simple fixture that adds the token to request headers

**For `--auth=cookie`:**
- Ask user for the cookie name and env var (default: `E2E_SESSION_COOKIE`)
- Generate a fixture that sets the cookie before each test

#### 0.8 Handle --config-only

If `--config-only` flag was passed:
1. Complete setup phase
2. Update state to completed
3. Report what was generated
4. Skip remaining phases
5. Exit

#### 0.9 Update state

Mark setup phase as complete. Update state file and JSON sidecar.

---

### Phase 1: Exploration

Spawn the `e2e-explorer` agent to map the application.

```python
Task(
  subagent_type="workflow:e2e-explorer",
  model=<model_for_mode>,  # sonnet for standard/thorough, haiku for turbo/eco
  prompt="""
  ## Task
  Explore the web application at {base_url} and generate an app map.

  ## Context
  Workflow ID: {workflow_id}
  Output path: {output_dir}/app-map.json
  Max depth: {depth}
  Auth strategy: {auth_strategy}
  Framework: {framework}

  ## Instructions

  ### 1. Connection Check
  - Use browser_navigate to reach {base_url}
  - If connection refused/timeout: report error and stop
  - Capture initial browser_snapshot

  ### 2. Auth Handling
  {auth_instructions_based_on_strategy}

  ### 3. Exploration
  - Use BFS traversal up to depth {depth}
  - For each page: browser_navigate, then browser_snapshot
  - Record all interactive elements (links, buttons, forms, inputs)
  - Track which pages require authentication
  - Detect SPA routing (URL changes from clicks vs full navigations)

  ### 4. Output
  Write app map JSON to: {output_dir}/app-map.json

  App map structure:
  {
    "base_url": "...",
    "framework": "...",
    "explored_at": "ISO timestamp",
    "pages": [
      {
        "url": "/path",
        "title": "Page Title",
        "requires_auth": false,
        "links": [{"text": "...", "href": "..."}],
        "forms": [{"action": "...", "fields": [...]}],
        "buttons": [{"text": "...", "role": "..."}],
        "navigation": [{"text": "...", "href": "..."}],
        "headings": ["..."],
        "dynamic_content": ["..."]
      }
    ],
    "navigation_graph": {
      "/": ["/about", "/login"],
      "/about": ["/", "/contact"]
    },
    "auth": {
      "login_url": "/login",
      "login_fields": ["email", "password"],
      "protected_urls": ["/dashboard", "/profile"]
    },
    "summary": {
      "total_pages": N,
      "total_forms": N,
      "total_buttons": N,
      "auth_required_pages": N
    }
  }

  Report completion with summary statistics.
  """
)
```

After explorer completes:
1. Read the generated app-map.json
2. Update state file with exploration statistics
3. Update JSON sidecar: mark e2e_exploration as passed, advance phase

---

### Phase 2: Test Generation

Spawn the `e2e-generator` agent to create test files from the app map.

```python
Task(
  subagent_type="workflow:e2e-generator",
  model=<model_for_mode>,
  prompt="""
  ## Task
  Generate Playwright E2E test suite from app map.

  ## Context
  Workflow ID: {workflow_id}
  App map: {output_dir}/app-map.json
  Test directory: {output_dir}
  Framework: {framework}
  Auth strategy: {auth_strategy}
  Mode: {mode}

  ## Instructions

  ### 1. Read App Map
  Read and parse {output_dir}/app-map.json

  ### 2. Plan Test Suites
  Group tests by feature:
  - navigation.spec.ts - Navigation structure and routing
  - auth.spec.ts - Login/logout (if auth detected)
  - <page-name>.spec.ts - Per-page feature tests
  - forms.spec.ts - Form validation and submission
  - accessibility.spec.ts - A11y checks (thorough mode only)

  ### 3. Selector Priority (MANDATORY)
  Use this priority for all selectors:
  1. getByRole('button', { name: '...' })
  2. getByLabel('...')
  3. getByPlaceholder('...')
  4. getByText('...')
  5. getByTestId('...')

  NEVER use:
  - CSS selectors (.class, #id)
  - XPath
  - Auto-generated class names
  - page.locator() with CSS unless no accessible alternative exists

  ### 4. Test Patterns
  Each test file must:
  - Import from @playwright/test (or auth fixture if auth needed)
  - Use test.describe() for grouping
  - Use meaningful test names: test('should <action> when <condition>')
  - Include at least one assertion per test
  - Use page.waitForURL() instead of hard waits
  - Use expect(...).toBeVisible() for element presence

  ### 5. Auth Tests
  If auth is configured:
  - Import { test, expect } from the auth fixture
  - Tests that need auth use the authenticated fixture
  - Tests for public pages use standard @playwright/test import

  ### 6. Write Files
  Write all test files to {output_dir}/
  Each file must compile with tsc --noEmit.

  ### 7. Report
  List all generated files with line counts and features covered.
  """
)
```

After generator completes:
1. Verify generated test files exist
2. Run `npx tsc --noEmit` on test files (quick syntax check)
3. Update state file with generated file list
4. Update JSON sidecar: mark e2e_generation as passed, advance phase

---

### Phase 3: Test Validation (Review Loop)

This is the main review gate. The e2e-reviewer runs tests and checks quality.

```python
iteration = 0
max_iterations = <from mode config>

while iteration < max_iterations:
    Task(
      subagent_type="workflow:e2e-reviewer",
      model=<model_for_mode>,  # opus for thorough
      prompt="""
      ## Task
      Review E2E Playwright tests in {output_dir}

      ## Context
      Workflow ID: {workflow_id}
      Review iteration: {iteration + 1} of {max_iterations}
      Previous issues: {previous_issues if iteration > 0 else "None (first review)"}
      Base URL: {base_url}

      ## Instructions

      ### 1. Run Tests
      Execute: npx playwright test --reporter=list

      ### 2. Static Analysis
      For each test file:
      - Check selector quality (getByRole preferred)
      - Check for anti-patterns (waitForTimeout, sleep, CSS selectors)
      - Check test isolation (no shared state between tests)
      - Check assertions are meaningful
      - Check error handling

      ### 3. Flakiness Check
      Run tests 2 more times and compare results for determinism.

      ### 4. Verdict
      Return structured verdict:

      VERDICT: PASS or FAIL

      If FAIL, list issues:
      - [ISSUE-1] <severity>: <description> in <file>:<line>
      - [ISSUE-2] ...

      If PASS:
      - Total tests: N
      - All passing: yes/no
      - Flakiness detected: yes/no
      - Selector quality: good/acceptable/poor
      """
    )

    if verdict == "PASS":
        # Update state: e2e_validation passed
        break
    else:
        iteration += 1
        if iteration < max_iterations:
            # Send issues back to generator for fixes
            Task(
              subagent_type="workflow:e2e-generator",
              model=<model_for_mode>,
              prompt="""
              ## Review Issues to Fix (MANDATORY)

              {numbered_issues_from_review}

              ## Fix Protocol
              1. Address EVERY issue by ID
              2. Read the file, understand the problem, apply the fix
              3. Self-verify by re-reading the fixed code
              4. Report: [ISSUE-N] FIXED: <what changed>
              5. If false positive: [ISSUE-N] DISPUTE: <justification>
              """
            )
        else:
            # Max iterations reached
            Report: "BLOCKING: Test validation failed after {max_iterations} iterations."
            Ask user for intervention
            PAUSE
```

---

### Phase 4: Quality Gate

After validation passes, run the quality gate.

```python
Task(
  subagent_type="workflow:quality-gate",
  model=<model_for_mode>,
  prompt="""
  QUALITY GATE CHECK - E2E Testing

  Project: {project_path}
  Test directory: {output_dir}
  Mode: {mode}

  Run checks:
  1. TypeScript compilation: npx tsc --noEmit (on test files)
  2. Lint: npx eslint {output_dir} (if eslint configured)
  3. All E2E tests pass: npx playwright test
  4. No security issues in test code (no hardcoded credentials, no eval)

  Auto-fix up to 3 iterations.
  Report: PASS or FAIL with details.
  """
)
```

If quality gate made changes, run a targeted review (e2e-reviewer on changed files only, max 2 iterations).

---

### Phase 5: Completion Guard

Final verification before marking the workflow complete.

```python
Task(
  subagent_type="workflow:completion-guard",
  model=<"opus" if thorough else model_for_mode>,
  prompt="""
  COMPLETION GUARD - E2E Testing Workflow

  Original task: Generate E2E tests for {base_url}
  Workflow ID: {workflow_id}
  Mode: {mode}
  App map: {output_dir}/app-map.json

  Verify:
  1. App map exists and is valid JSON
  2. Test files exist for discovered pages
  3. All tests pass: npx playwright test
  4. No TODO/FIXME in test files
  5. playwright.config.ts is valid
  6. Auth setup works (if configured)
  7. Coverage: compare test files against app map pages

  Return: APPROVED or REJECTED with specific issues.
  """
)
```

If rejected: fix issues -> re-run quality gate -> re-run completion guard (max 3 cycles).

---

### Completion

When all phases pass:

1. **Update state files**:
   - Fill Completion Summary in org/md file
   - Set COMPLETED_AT, TOTAL_DURATION
   - List all generated test files

2. **Report to user**:
   ```
   E2E Testing Complete!

   URL: <url>
   Tests generated: N files, M test cases
   All tests passing: yes
   Coverage: N/M pages covered

   Generated files:
   - playwright.config.ts
   - <output_dir>/navigation.spec.ts
   - <output_dir>/auth.spec.ts
   - ...

   Run tests: npx playwright test
   View report: npx playwright show-report
   ```

3. **Ask about commit**:
   "Should I commit these test files?"

4. **Clean up temp files**:
   - Remove workflow session temp files:
   ```bash
   TMPDIR_PATH=$(node -e "console.log(require('os').tmpdir())")
   rm -f "$TMPDIR_PATH/workflow-session-marker-${SESSION_ID}.json"
   rm -f "$TMPDIR_PATH/workflow-binding-${SESSION_ID}.json"
   rm -f "$TMPDIR_PATH/workflow-stop-${SESSION_ID}."*
   rm -f "$TMPDIR_PATH/workflow-deny-${SESSION_ID}.json"
   rm -f "$TMPDIR_PATH/workflow-complete-${SESSION_ID}-"*
   ```
   - Where `${SESSION_ID}` is the session_id from Step 5.5
   - If no session_id was discovered, skip this step

5. **Archive state**:
   - Move state files from `active/` to `completed/`

---

### Error Handling

| Error | Action |
|-------|--------|
| URL unreachable | Warn user, ask to proceed or abort |
| Playwright MCP not configured | Show config instructions, pause |
| npm install fails | Report error, suggest manual install |
| Browser install fails | Report error, suggest `npx playwright install --with-deps` |
| Explorer finds no pages | Report, ask user to check URL and try again |
| Tests won't compile | Send back to generator with errors |
| All tests fail on first run | Check if app is running, then fix tests |
| Auth setup fails | Ask user for credentials, retry |

### State File Updates

**MANDATORY:** Update the state file before and after each phase:
1. Before: set status to in-progress, set STARTED_AT
2. After: write outputs, check off objectives, set COMPLETED_AT
3. On error: log the error

### Plugin Directory Reference

Templates and resources are in the plugin cache:
```
<PLUGIN_DIR>/templates/e2e-testing.org
<PLUGIN_DIR>/templates/e2e-testing.md
<PLUGIN_DIR>/resources/e2e/playwright.config.ts.template
<PLUGIN_DIR>/resources/e2e/global-setup.ts.template
<PLUGIN_DIR>/resources/e2e/auth-fixture.ts.template
<PLUGIN_DIR>/resources/e2e/webserver-configs.json
```

Where `<PLUGIN_DIR>` is the workflow plugin cache directory (find it via the plugin system).
