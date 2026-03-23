---
name: test-live
description: Interactive live testing of a running web application via Playwright MCP browser automation
user_invocable: true
usage: /workflow:test-live <url> [--user=<email>] [--pass=<password>] [--instructions=<text>]
arguments:
  - name: url
    required: true
    description: URL of the running web application to test (e.g., http://localhost:8080)
  - name: user
    required: false
    description: Login username/email for authenticated testing
  - name: pass
    required: false
    description: Login password for authenticated testing
  - name: instructions
    required: false
    description: Specific testing instructions or scenarios to verify
---

# Live E2E Testing

Test a running web application interactively using Playwright MCP browser automation. This is a lightweight, standalone testing command - no workflow state, no gates, just direct browser testing with structured reporting.

## Usage

```
/workflow:test-live http://localhost:8080
/workflow:test-live http://localhost:3000 --user=admin@example.com --pass=secret123
/workflow:test-live https://staging.myapp.com --instructions="Test the checkout flow with a $50 item"
```

## Input
$ARGUMENTS

---

## Execution Steps

### Step 1: Parse Input

Extract from arguments:
- **URL** (required): First argument or value after the command
- **--user**: Login username/email (optional)
- **--pass**: Login password (optional)  
- **--instructions**: Specific test scenarios (optional, rest of text after flags)

If URL is missing, ask the user for it.

### Step 2: Validate URL

**URL scheme validation (MANDATORY):**
Only `http://` and `https://` URLs are accepted. Reject `file://`, `ftp://`, `javascript:`, `data:`, and any other scheme.

```bash
URL_SCHEME=$(echo "<url>" | grep -oP '^[a-z]+(?=://)')
if [ "$URL_SCHEME" != "http" ] && [ "$URL_SCHEME" != "https" ]; then
  echo "ERROR: Only http:// and https:// URLs are supported"
fi
```

Check reachability:
```bash
curl -sS -o /dev/null -w "%{http_code}" --max-time 10 <url>
```

- If unreachable: warn user but allow proceeding (app may need auth)
- If reachable: proceed

### Step 3: Check Playwright MCP Availability

Try using a Playwright MCP tool (e.g., `browser_navigate` to the URL).

**If Playwright MCP tools are NOT available:**

1. Check if `.claude/.mcp.json` exists in the project root
2. If it exists, read it and check for a `playwright` entry
3. If no playwright config, add it:

```python
# Read existing config or create new
existing = Read(".claude/.mcp.json") or "{}"
config = json.loads(existing)

if "mcpServers" not in config:
    config["mcpServers"] = {}

if "playwright" not in config["mcpServers"]:
    config["mcpServers"]["playwright"] = {
        "command": "npx",
        "args": ["@playwright/mcp@latest", "--headless"]
    }
    Write(".claude/.mcp.json", json.dumps(config, indent=2))
```

4. Also check user-level MCP config at `~/.claude/.mcp.json` as an alternative location
5. After writing the config, inform the user:

```
Playwright MCP server has been configured in .claude/.mcp.json.

To activate it, please restart your Claude Code session, then run:
  /workflow:test-live <url> [options]

Alternatively, you can add the Playwright MCP server manually:
  claude mcp add playwright -- npx @playwright/mcp@latest --headless
```

**If Playwright MCP tools ARE available:** proceed to Step 4.

### Step 4: Spawn Web Tester Agent

Build the prompt for the web-tester agent based on parsed input:

```python
prompt_parts = [
    f"## Task\nTest the web application at {url}\n",
]

if user and password:
    prompt_parts.append(f"""## Authentication
Login with these credentials:
- Username/Email: {user}
- Password: {password}

Authenticate first, then proceed with testing.
""")

if instructions:
    prompt_parts.append(f"""## Test Instructions
Follow these specific testing instructions:
{instructions}

After completing the instructed tests, report findings.
""")
else:
    prompt_parts.append("""## Test Scope
No specific instructions provided. Perform exploratory testing:
1. Test all visible pages from the navigation
2. Test all forms (valid and invalid input)
3. Test interactive elements (buttons, modals, dropdowns)
4. Check for console errors on each page
5. Verify images and resources load correctly
6. Test basic user flows (if authenticated)
""")

Agent(
    subagent_type="workflow:web-tester",
    model="sonnet",
    prompt="\n".join(prompt_parts)
)
```

### Step 5: Report Results

After the web-tester agent completes, present the results to the user:
- Summary of pages and forms tested
- Issues found with severity
- Recommendations for fixes
- Any screenshots taken

If the agent found critical issues, highlight them prominently.
