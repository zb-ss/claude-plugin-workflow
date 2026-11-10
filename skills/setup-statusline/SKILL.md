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

Configure the workflow plugin's status line, which displays the 5-hour and 7-day usage limits, context window, and session cost at the bottom of the Claude Code terminal. Everything is read from the JSON Claude Code passes on stdin. By default no credentials are read and no network call is made.

## What It Shows

```
Opus │ 5h █████░░░░░  52% 2h30m │ 7d ████░░░░░░  35% 3d │ ctx ████░░░░░░  42% │ $0.12
```

| Segment | Source | Description |
|---------|--------|-------------|
| Model | stdin JSON | Current model name |
| 5h | stdin JSON (`rate_limits`) | 5-hour rolling session limit (resets shown) |
| 7d | stdin JSON (`rate_limits`) | 7-day weekly limit, all models (resets shown) |
| + | opt-in, off by default | Extra usage spend vs monthly cap (see `enable`, step 6) |
| ctx | stdin JSON | Context window usage percentage |
| Cost | stdin JSON | Session cost in USD |

## Prerequisites

- Node.js in your PATH
- The 5h and 7d bars need a claude.ai Pro, Max or Ultra subscription: Claude Code only sends `rate_limits` for those (or behind a Claude apps gateway), and only after the first response in a session
- No credentials are needed and none are read by default

## Instructions

When the user invokes this skill:

### Action: `status` (default)

1. **Check current settings**
   - Read `~/.claude/settings.json`
   - Check if `statusLine` is already configured
   - Report current state

2. **Check the extra-usage switch**
   - Resolve the state dir: `PLUGIN_ABS=$(cd "$CLAUDE_PLUGIN_ROOT" && pwd)`, then `node -e "console.log(require('$PLUGIN_ABS/lib/paths').getStateDir())"`
   - Read `<state dir>/statusline.json` if it exists
   - Report `on` only if it contains `"extra_usage": true`; anything else (missing file, invalid JSON, other value) is `off`
   - **Do not read or check `~/.claude/.credentials.json` or the macOS Keychain.** This skill never inspects credentials.

3. **Display status**
   ```
   ## Status Line Configuration

   Status: [enabled / disabled / not configured]
   Extra usage segment: [on / off]
   Script: ${CLAUDE_PLUGIN_ROOT}/statusline/statusline.js

   ### What You'll See
   Model │ 5h usage │ 7d usage │ context │ cost
   ```

### Action: `enable`

1. **Locate the plugin script (absolute path)**
   - Resolve the plugin root to an absolute path: `PLUGIN_ABS=$(cd "$CLAUDE_PLUGIN_ROOT" && pwd)`
   - The status line script is at `$PLUGIN_ABS/statusline/statusline.js`
     (e.g. `/home/user/.claude/plugins/marketplaces/zb-ss-workflow/statusline/statusline.js`)
   - Confirm the file exists. The path written to settings MUST be absolute (no `~`, no env vars — see step 3).

2. **Read current settings**
   - Read `~/.claude/settings.json` (create `{}` if missing)
   - Parse existing JSON, preserve all current settings

3. **Add status line configuration**
   - Use the absolute script path resolved in step 1 (e.g., `/home/user/.claude/plugins/marketplaces/zb-ss-workflow/statusline/statusline.js`)
   - Merge this into the settings:
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node \"/home/user/.claude/plugins/marketplaces/zb-ss-workflow/statusline/statusline.js\""
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

6. **Ask about the extra-usage segment**
   - You MUST ask the user (AskUserQuestion when available, otherwise a plain question). Never enable it silently.
   - Show this disclosure: "Turning this on makes the status line read your local Claude credentials (`~/.claude/.credentials.json`, or the macOS Keychain) and call an undocumented Anthropic usage endpoint that may change or stop working. It adds the `+` extra-usage segment and can fill the 5h and 7d bars at session start. Default: No."
   - Only an explicit yes in this invocation enables it. No answer, an unclear answer, or a non-interactive run means off.
   - Resolve the state dir with `node -e "console.log(require('$PLUGIN_ABS/lib/paths').getStateDir())"`
   - Write the answer to `<state dir>/statusline.json` as `{"extra_usage": true}` or `{"extra_usage": false}`. Create the directory if needed, preserve other keys, use 2-space indent.
   - The switch takes effect on the next status line refresh. It can be changed later by re-running `enable` or by editing the file.

7. **Confirm**
   ```
   ## Status Line Enabled

   Configuration added to ~/.claude/settings.json
   Script: /home/user/.claude/plugins/marketplaces/zb-ss-workflow/statusline/statusline.js
   Extra usage segment: [on / off]

   **Restart Claude Code** to see the status line.

   To disable later: /workflow:setup-statusline disable
   ```

### Action: `disable`

1. **Read current settings**
   - Read `~/.claude/settings.json`
   - Remove the `statusLine` key entirely

2. **Write updated settings**
   - Write the modified JSON back

3. **Turn the extra-usage switch off**
   - If `<state dir>/statusline.json` exists, set `extra_usage` to `false` and preserve other keys

4. **Confirm**
   ```
   ## Status Line Disabled

   Removed statusLine from ~/.claude/settings.json

   **Restart Claude Code** to apply.

   To re-enable: /workflow:setup-statusline enable
   ```

## Important Notes

- Default behaviour is stdin only: no credential read and no network call
- The status line updates after each assistant message (not real-time)
- Colors adapt: green (< 70%), yellow (70-89%), red (90%+)
- **Reset cache**: each run records the window resets in `$(node -e "console.log(require('os').tmpdir())")/claude-statusline-usage.json` (override with `CLAUDE_STATUSLINE_CACHE`). Shape: `{"fetched_at": <ms>, "data": {"five_hour": {"utilization": 52, "resets_at": "<ISO>"}, "seven_day": {...}}}`, with `resets_at` always an ISO 8601 UTC string. The workflow quota pause reads it to schedule the resume.
  - A window missing from stdin keeps its last known reset until that reset passes
  - Expired windows are removed
  - The file is written only when its content changes
  - It is read only when it is a regular file owned by the current user; anything else is ignored as if absent
- With the extra-usage opt-in on, responses are cached for 60 seconds, and a failed lookup for 30 seconds, in `<state dir>/claude-statusline-oauth-usage.json` (owner-only, `0600`), not in the temp directory

## Troubleshooting

**Status line not appearing after enable:**
- Restart Claude Code (settings require restart)
- Check that `node` is in your PATH

**Usage bars missing (only model/context/cost):**
- The session has just started; the bars appear after the first response
- API-key session, or no Pro/Max/Ultra subscription
- An older Claude Code that does not send `rate_limits`
- A window that has just reset (each window can be absent independently)

**Extra-usage segment missing:**
- The switch is off (`/workflow:setup-statusline status`)
- Extra usage is not enabled on the account
- Credentials were not found
- The undocumented endpoint changed

In every one of these cases the rest of the line still renders.

**Inspecting or clearing the reset cache:**
- Inspect: `cat "$(node -e "console.log(require('os').tmpdir())")/claude-statusline-usage.json"`
- Delete: `rm "$(node -e "console.log(require('os').tmpdir())")/claude-statusline-usage.json"`
