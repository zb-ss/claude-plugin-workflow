---
name: setup-statusline
description: Enable or disable the workflow usage status line
user_invocable: true
usage: /workflow:setup-statusline [enable|disable|status]
arguments:
  - name: action
    required: false
    description: "enable, disable, or status (default: status)"
---

# Status Line Setup

Configure the workflow plugin's status line, which displays API usage limits, context window, and session cost at the bottom of the Claude Code terminal.

## What It Shows

```
Opus │ 5h ██████░░░░  52% 2h30m │ 7d █████░░░░░  35% 3d │ ctx ████░░░░░░  42% │ $0.12
```

| Segment | Source | Description |
|---------|--------|-------------|
| Model | stdin JSON | Current model name |
| 5h | Usage API | 5-hour rolling session limit (resets shown) |
| 7d | Usage API | 7-day weekly limit, all models (resets shown) |
| ctx | stdin JSON | Context window usage percentage |
| Cost | stdin JSON | Session cost in USD |

## Prerequisites

- Claude Code Pro/Max subscription (for usage API access)
- OAuth credentials present (`~/.claude/.credentials.json` on Linux, Keychain on macOS)

## Instructions

When the user invokes this skill:

### Action: `status` (default)

1. **Check current settings**
   - Read `~/.claude/settings.json`
   - Check if `statusLine` is already configured
   - Report current state

2. **Check credential availability**
   - Look for `~/.claude/.credentials.json` (Linux)
   - On macOS, check Keychain access
   - Report whether usage API will work

3. **Display status**
   ```
   ## Status Line Configuration

   Status: [enabled / disabled / not configured]
   Credentials: [found / not found]
   Script: ${CLAUDE_PLUGIN_ROOT}/statusline/statusline.js

   ### What You'll See
   Model │ 5h usage │ 7d usage │ context │ cost
   ```

### Action: `enable`

1. **Locate the plugin script**
   - Run `echo $HOME` to get the home directory
   - The script is at the plugin root: look for the installed plugin location
   - Check both paths (installed copy and source):
     - `~/.claude/plugins/workflow/statusline/statusline.js`
     - The dotfiles source if symlinked
   - Use whichever path exists. The path MUST be absolute (no `~` or variables)

2. **Read current settings**
   - Read `~/.claude/settings.json` (create `{}` if missing)
   - Parse existing JSON, preserve all current settings

3. **Add status line configuration**
   - Resolve the absolute script path (e.g., `/home/user/.claude/plugins/workflow/statusline/statusline.js`)
   - Merge this into the settings:
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node \"/home/user/.claude/plugins/workflow/statusline/statusline.js\""
     }
   }
   ```
   - **IMPORTANT**: The `statusLine.command` does NOT expand `${CLAUDE_PLUGIN_ROOT}`. You MUST use the resolved absolute path.

4. **Write updated settings**
   - Write the merged JSON back to `~/.claude/settings.json`
   - Preserve formatting (2-space indent)

5. **Verify**
   - Read back the file to confirm valid JSON
   - Confirm the script file exists at the resolved path
   - Inform user they need to **restart Claude Code** for changes to take effect

6. **Confirm**
   ```
   ## Status Line Enabled

   Configuration added to ~/.claude/settings.json
   Script: /home/user/.claude/plugins/workflow/statusline/statusline.js

   **Restart Claude Code** to see the status line.

   To disable later: /workflow:setup-statusline disable
   ```

### Action: `disable`

1. **Read current settings**
   - Read `~/.claude/settings.json`
   - Remove the `statusLine` key entirely

2. **Write updated settings**
   - Write the modified JSON back

3. **Confirm**
   ```
   ## Status Line Disabled

   Removed statusLine from ~/.claude/settings.json

   **Restart Claude Code** to apply.

   To re-enable: /workflow:setup-statusline enable
   ```

## Important Notes

- The status line uses an **undocumented API** (`/api/oauth/usage`) - it may change
- API responses are **cached for 60 seconds** to avoid excessive calls
- The cache file is at `$(node -e "console.log(require('os').tmpdir())")/claude-statusline-usage.json`
- The status line updates after each assistant message (not real-time)
- Usage data requires an active Claude subscription with OAuth credentials
- If credentials are not found, only context/cost are shown (no usage bars)
- Colors adapt: green (< 70%), yellow (70-89%), red (90%+)

## Troubleshooting

**Status line not appearing after enable:**
- Restart Claude Code (settings require restart)
- Check that `node` is in your PATH

**Usage bars not showing (only context/cost):**
- Verify `~/.claude/.credentials.json` exists and contains `claudeAiOauth.accessToken`
- On macOS, ensure Keychain access is not blocked
- Check the cache file: `cat "$(node -e "console.log(require('os').tmpdir())")/claude-statusline-usage.json"`

**Stale usage data:**
- Delete cache: `rm "$(node -e "console.log(require('os').tmpdir())")/claude-statusline-usage.json"`
- Data refreshes every 60 seconds automatically
