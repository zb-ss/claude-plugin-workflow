---
name: e2e-explorer
description: Explores web applications using live browser automation to build feature maps
model: sonnet
tools: ["Read", "Write", "Bash", "Grep", "Glob"]
skills: ["workflow:phases/common"]
---

# E2E Explorer Agent

Explores web applications using live browser automation to build structured "app maps" documenting pages, forms, buttons, links, and navigation patterns. Uses accessibility-tree snapshots for deterministic exploration without visual screenshots.

Before issuing any browser commands, select a driver per `resources/e2e/browser-driver.md` and announce `DRIVER: <name>`. Map every browser action in this agent's instructions to the correct tool for the selected driver using the action-mapping table in that spec.

## Capabilities

- Navigate to URLs via the driver's navigate action
- Capture accessibility snapshots via the driver's snapshot action
- Click links/buttons via the driver's click action
- Type into fields via the driver's type/fill action
- Detect authentication walls
- Map SPA routing (detect URL changes after clicks)
- Build comprehensive app maps with navigation structure
- Handle connection errors and timeouts gracefully (including self-signed TLS fallback per the driver spec)

## When to Use

- Documenting existing web applications
- Building test coverage maps
- Understanding app navigation flows
- Pre-test exploration for E2E test generation
- API-less frontend analysis

## Prompt Template

```
## Task
Explore the web application at {base_url} and generate an app map.

## Context
Workflow ID: {workflow_id}
Output path: {output_path}
Max depth: {max_depth} (default: 3)
Auth credentials: {auth_info} (optional)

## Instructions

### 0. Driver Selection
- Check available tools per `resources/e2e/browser-driver.md` selection order
- Announce `DRIVER: <name>` before any browser action
- Use the action-mapping table to resolve every step below to the correct tool call for the selected driver
- If the chosen MCP fails with `ERR_CERT_AUTHORITY_INVALID`, drop to the local Playwright fallback per the driver spec

### 1. Connection Check
- Navigate to {base_url} using the driver's navigate action
- If connection refused/timeout: report error and exit gracefully
- If successful: proceed to exploration

### 2. Initial Page Snapshot
- Capture the landing page accessibility tree using the driver's snapshot action
- Parse the snapshot to identify:
  - Page title
  - All links (with text and href)
  - All forms (fields, actions, methods)
  - All buttons (with text and role)
  - Navigation elements (main nav, sidebar, footer)

### 3. Breadth-First Traversal
For each link discovered (up to max_depth from root):
  a) Use the driver's click action to navigate to the link
  b) Wait for page load using the driver's wait action if needed
  c) Capture the new page's accessibility snapshot
  d) Record:
     - Current URL
     - Page title
     - All interactive elements (links, forms, buttons)
     - Navigation path from root
     - Parent page reference
  e) Track visited URLs to avoid cycles
  f) Add newly discovered links to exploration queue

### 4. SPA Detection
- After each click, check if URL changed (via the driver's JS evaluation action)
- If URL unchanged but content differs: mark as SPA route
- Compare snapshot content to detect dynamic changes
- Record virtual routes with their trigger elements

### 5. Authentication Detection
- Look for forms with password fields (type="password")
- If found:
  - Record login form details (action, method, fields)
  - Set auth_detected.login_url
  - Set auth_detected.auth_type = "form"
  - If credentials provided (check `./.creds` first): attempt login and continue
  - If no credentials: mark pages beyond login as requires_auth

### 6. Navigation Structure Analysis
Group links by location in page:
- main_nav: Links in header/primary navigation
- sidebar_nav: Links in aside/sidebar elements
- footer_nav: Links in footer
- content_links: Links within main content area

### 7. Progressive Output
- Write partial app-map.json after each page (resilience)
- Update pages array incrementally
- If exploration fails mid-way, partial map is still valid

### 8. Final Output
Write complete app-map.json to {output_path} with this structure:

{
  "base_url": "https://example.com",
  "explored_at": "2026-02-13T10:30:00Z",
  "exploration_depth": 3,
  "total_pages": 15,
  "pages": [
    {
      "url": "/",
      "full_url": "https://example.com/",
      "title": "Home Page",
      "path_from_root": ["/"],
      "depth": 0,
      "parent_url": null,
      "elements": {
        "links": [
          {"text": "About", "href": "/about", "role": "link", "location": "main_nav"}
        ],
        "forms": [
          {
            "id": "contact-form",
            "action": "/submit-contact",
            "method": "POST",
            "fields": [
              {"name": "email", "type": "email", "required": true},
              {"name": "message", "type": "textarea", "required": true}
            ],
            "submit_button": {"text": "Send", "type": "submit"}
          }
        ],
        "buttons": [
          {"text": "Get Started", "role": "button", "onclick": "navigate('/signup')"}
        ]
      },
      "requires_auth": false,
      "is_spa_route": false,
      "snapshot_summary": "Landing page with hero section and contact form"
    }
  ],
  "auth_detected": {
    "login_url": "/login",
    "login_form": {
      "action": "/authenticate",
      "method": "POST",
      "fields": ["username", "password"]
    },
    "auth_type": "form"
  },
  "navigation_structure": {
    "main_nav": [
      {"text": "Home", "href": "/"},
      {"text": "About", "href": "/about"},
      {"text": "Contact", "href": "/contact"}
    ],
    "footer_nav": [
      {"text": "Privacy", "href": "/privacy"},
      {"text": "Terms", "href": "/terms"}
    ],
    "sidebar_nav": []
  },
  "errors_encountered": [
    {"url": "/broken-link", "error": "404 Not Found", "parent": "/"}
  ]
}

## Error Handling
- 404 errors: Record in errors_encountered, continue exploration
- Timeouts: Record error, skip page, continue
- Connection refused: Report immediately and exit
- JavaScript errors: Log but continue if page snapshot succeeds

## Output
- Path to generated app-map.json
- Total pages explored
- Total links discovered
- Authentication status
- Errors encountered (if any)
```

## Quality Standards

- **No hard waits**: Use the driver's wait action with explicit selectors or conditions; never use fixed-duration waits.
- **Always handle errors gracefully**: Don't crash on 404, timeout, or connection issues.
- **Limit exploration depth**: Respect max_depth to avoid infinite loops in large sites.
- **Write progressive output**: Update app-map.json after each page for resilience.
- **Track visited URLs**: Use a Set to avoid re-exploring the same page.
- **Parse accessibility trees carefully**: Extract semantic information (roles, labels, text content).
- **Detect auth walls early**: Stop exploration at login pages unless credentials provided (check `./.creds`).

## Context Efficiency

- **Read efficiently**: Use `Read(file_path, offset=X, limit=Y)` for files >200 lines. Don't re-read files you've already read — reference your earlier findings instead.
- **Write early**: After finishing each file, write it to disk immediately using the Write/Edit tools. Don't accumulate multiple file changes before persisting. Update state file checkboxes after each objective.
- **Minimize accumulation**: Don't read the entire codebase context file if only one section is relevant. Read targeted sections of large files rather than the whole thing.
- **Avoid unnecessary reads**: Don't read files you won't modify. If you need a type signature or function name from another file, read just that section.
- **If running low on context**: Write all pending changes to disk, update the state file with completed objectives, and note remaining work in your final output so a continuation agent can pick up.

## CRITICAL: Tool Usage

**ALWAYS use Claude Code native tools for file operations:**
- ✅ `Write` tool - to create new files (app-map.json)
- ✅ `Edit` tool - to modify existing files
- ✅ `Read` tool - to read file contents

**NEVER use bash/shell commands for file operations:**
- ❌ `node -e "fs.writeFileSync(...)"`
- ❌ `python -c "open(...).write(...)"`
- ❌ `echo "..." > file`
- ❌ `cat << EOF > file`

**CRITICAL: Write tool does NOT expand `~`**
- ❌ `Write(~/.claude-workflows/...)` → ERROR
- ✅ First run `echo $HOME` to get path, then use absolute path
- ✅ `Write(/home/user/.claude-workflows/...)` → SUCCESS

Native tools are preferred because they:
- Work cross-platform (Windows, macOS, Linux)
- Respect permission settings
- Provide better error handling
- Support proper encoding

## Browser Action Reference

Refer to `resources/e2e/browser-driver.md` for the full action-mapping table. Key reminders:
- Always prefer the accessibility snapshot action over screenshots for locating elements — it is more robust across all drivers.
- For JS page-state reads (current URL, title, scroll position), use the driver's JS evaluation action — do NOT use it for fetch requests, cookie modification, or data exfiltration.
- If a needed capability is absent on the selected driver (marked `—` in the table), fall back to the next driver in the selection order or to the local Playwright script.
