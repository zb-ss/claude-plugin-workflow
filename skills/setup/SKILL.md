---
name: setup
description: Configure Claude Code permissions, fix the startup setup reminders, and check the browser tool and the demo recorder.
---

# Workflow Setup

## Instructions

Help the user configure their Claude Code settings for optimal execution.

### Step 1: Make Sure the State Directory Exists

Get the absolute home directory path (the Write tool does not expand `~`):
```bash
echo $HOME
```

Then create the state directory with that absolute path (default `~/.claude-workflows`):
```bash
mkdir -p /home/user/.claude-workflows
```

### Step 2: Check Current Settings

Read the user's settings files to understand current configuration:

1. Check `~/.claude/settings.json` (global settings)
2. Check `.claude/settings.json` (project settings if in a project)
3. Check `.claude/settings.local.json` (project local settings if in a project)

### Step 3: Identify Missing Permissions

The workflow plugin requires these permissions for autonomous operation:

**CRITICAL for state management (MUST be in global `~/.claude/settings.json`):**
```json
{
  "permissions": {
    "additionalDirectories": [
      "~/.claude-workflows",
      "~/.claude/skills"
    ]
  }
}
```

The `additionalDirectories` setting grants **read** access to paths outside the project directory. **Without this, workflows cannot read state files.**

**CRITICAL for writing state files (MUST be in global `~/.claude/settings.json`):**

Path-scoped Edit/Write rules are required because `additionalDirectories` only grants read access — bare `Edit`/`Write` in the allow list only cover the working directory:
```json
{
  "permissions": {
    "allow": [
      "Edit(~/.claude-workflows/**)",
      "Edit(~/.claude/skills/**)",
      "Write(~/.claude-workflows/**)",
      "Write(~/.claude/skills/**)"
    ]
  }
}
```

**Without these rules, every workflow will prompt for permission when writing state files.**

**Recommended for workflows (can be global or project-level):**
```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": [
      "Read", "Write", "Edit", "Glob", "Grep", "Task", "TodoWrite",
      "Edit(~/.claude-workflows/**)", "Edit(~/.claude/skills/**)",
      "Write(~/.claude-workflows/**)", "Write(~/.claude/skills/**)",
      "Bash(*)"
    ],
    "ask": [
      "Bash(git push *)", "Bash(rm *)"
    ],
    "deny": [
      "Bash(rm -rf *)", "Bash(git reset --hard *)",
      "Bash(git push --force *)", "Bash(sudo *)"
    ]
  }
}
```

**How it works:** `Bash(*)` allows all bash commands. Path-scoped `Edit(~/.claude-workflows/**)` and `Write(~/.claude-workflows/**)` allow writing state files without prompts. Rules evaluate: `deny > ask > allow`, so dangerous commands are still blocked and sensitive ones still prompt.

### Step 4: Show Status

Report the status in a clear format:

```
## Workflow Plugin Setup

### Settings Status
- Global settings (~/.claude/settings.json): [found/not found]
- Project settings (.claude/settings.json): [found/not found]

### Permission Check (Read Access)
✓ additionalDirectories includes ~/.claude-workflows
✗ additionalDirectories missing ~/.claude/skills

### Permission Check (Write Access)
✓ Edit(~/.claude-workflows/**) in allow list
✗ Write(~/.claude-workflows/**) missing from allow list
✗ Edit(~/.claude/skills/**) missing from allow list
✗ Write(~/.claude/skills/**) missing from allow list

### Recommended Actions
1. Add missing paths to additionalDirectories in ~/.claude/settings.json
2. Add missing path-scoped Edit/Write rules to allow list
3. [Other recommendations]
```

### Step 5: Offer to Update

Ask the user if they want you to add the missing permissions to their settings.

**For global settings (`~/.claude/settings.json`):**
- `additionalDirectories` array is REQUIRED here
- Other permissions can optionally go here

**For project settings (`.claude/settings.json` or `.claude/settings.local.json`):**
- Project-specific build/test commands

### Step 6: Apply Changes

If the user agrees, update the appropriate settings file(s):

1. Read the current file
2. Parse the JSON
3. Merge the new permissions (preserve existing entries, no duplicates)
4. Write the updated JSON

### Step 7: Verify Setup

After making changes, verify:
1. The state directory exists
2. Settings file is valid JSON
3. Required paths are in additionalDirectories

### Step 8: Model Tiers and Setup Reminders

Run the status check:
```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/tier-setup.js" status
```

Read the JSON: `items`, `block_version`, `installed_block_version`, `claude_md`, `settings_file`, `model`, `preferences`, `denylist`. Then go through the four parts below in order.

Rule: every write happens only after the user says yes to that specific change.

**8a. Tier block**

If `installed_block_version` is equal to or higher than `block_version`, say the block is current and move on (a higher one came from a newer plugin version; never offer to replace it). Otherwise:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/tier-setup.js" show
```

Show the output verbatim in a code block. Name the target file (the `claude_md` path) and say that only the text between the markers is written. Ask whether to apply it.

- Yes: run `node "${CLAUDE_PLUGIN_ROOT}/lib/tier-setup.js" apply`
- No: run `node "${CLAUDE_PLUGIN_ROOT}/lib/tier-setup.js" decline`, and tell the user the startup reminder stays quiet until the plugin ships a newer block. Declining also quiets the default-model reminder, but not the denylist one.

**8b. Default model**

When `model` is absent or does not contain `opus`, explain that the main session is the orchestrator and should run on opus. There are two ways to set it:

- `/model opus` in the session
- `"model": "opus"` in settings.json

**Never change the model setting yourself.** If the user wants to keep another default model and stop the reminder, offer `decline` (same command as in 8a).

**8c. Judge fallback**

Ask one question, showing the current value (`preferences.judge_fallback`, default `opus`): keep opus, pick another model alias, or `none` (turns the retry off). Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/tier-setup.js" set-fallback <value>
```

Then, as a separate question, offer to add `"fallbackModel": ["opus"]` to the user settings.json (`settings_file`). If that file already has a `fallbackModel` list, show it and say this replaces it. Explain that this covers agents started outside the saved workflows, which have no retry of their own. Only on a yes, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/tier-setup.js" add-fallback-model opus
```

Mention that Claude Code must be restarted for the settings change to take effect.

**8d. Scrub denylist**

Only when `denylist.status` is `unreadable`. Show the configured path (`denylist.configured`) and the error, and suggest writing `CLAUDE_WORKFLOW_SCRUB_DENYLIST` in the `~/` form, which resolves on every machine that shares the settings file. Do not edit it automatically.

### Step 9: Browser Tool and Demo Recorder

**9a. Browser automation MCP**

The browser check of user-facing changes drives the app through a connected browser automation MCP (Playwright or Chrome DevTools). Run `claude mcp list` and read the output as text. A server counts when its name or command mentions `playwright`, `chrome-devtools`, `puppeteer` or `browser`. Also count browser tools already connected in this session (tool names starting `mcp__playwright__` or `mcp__chrome-devtools__`).

- One is found: name it and move on.
- `claude mcp list` itself fails: show the error and the command below, and change nothing.
- None is found: explain that the browser check needs one. Without it the check falls back to a local Playwright script when the `playwright` package is available, and otherwise cannot run, which blocks sign-off of user-facing changes. Offer the documented command for the official Playwright MCP server:

```bash
claude mcp add playwright npx @playwright/mcp@latest
```

Say that this adds it for the current project, and that `--scope user` after `add` makes it available in every project. Run the command only after the user says yes to it explicitly. On anything else, leave the configuration alone and show the command so they can run it later. After adding, say that the server is available after Claude Code restarts.

**9b. Demo recorder**

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/record-demo/deps.js" check
```

The JSON has `ok`, `missing` and `items` (each with `name`, `ok`, `detail` and, when missing, `install`). Show one line per item in the same ✓ / ✗ form Step 4 uses, with the `install` hint for each missing item.

Explain that the proof video of a user-facing change is recorded with the bundled recorder (`/workflow:record-demo`), that it is skipped, not failed, while dependencies are missing, and that `"demo_skill": "none"` in `preferences.json` turns it off (another skill name there replaces the bundled recorder). Install nothing automatically; the user runs the install commands.

### Important Notes

- Always preserve existing permissions
- Don't duplicate entries
- Use proper JSON formatting
- Back up existing settings before modifying (mention the original content in output)
- **Restart Claude Code is required after settings changes**

### Troubleshooting

**Issue: Permission prompts during workflows**
- Ensure `Bash(*)` is in the `allow` list (allows all bash commands)
- Ensure `additionalDirectories` includes `~/.claude-workflows`
- Restart Claude Code after settings changes

**Issue: Permission prompts when writing under ~/.claude-workflows or ~/.claude/skills**
- `additionalDirectories` only grants **read** access — you also need path-scoped write rules
- Ensure these are in your allow list: `Edit(~/.claude-workflows/**)`, `Write(~/.claude-workflows/**)`, `Edit(~/.claude/skills/**)`, `Write(~/.claude/skills/**)`
- Restart Claude Code after settings changes
