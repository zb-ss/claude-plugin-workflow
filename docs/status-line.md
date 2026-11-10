# Status Line

Display your 5-hour and 7-day usage limits, context window, and session cost directly in the Claude Code status bar.

## Preview

```
Opus │ 5h █████░░░░░  52% 2h30m │ 7d ████░░░░░░  35% 3d │ ctx ████░░░░░░  42% │ $0.12
```

## Segments

| Segment | Description | Source | Color |
|---------|-------------|--------|-------|
| **Model** | Current model name | stdin JSON | White bold |
| **5h** | 5-hour rolling session limit + time until reset | stdin JSON (`rate_limits`) | Green / Yellow / Red |
| **7d** | 7-day weekly limit (all models) + time until reset | stdin JSON (`rate_limits`) | Green / Yellow / Red |
| **+** | Extra usage spend vs monthly cap | opt-in, off by default | Cyan |
| **ctx** | Context window usage | stdin JSON | Green / Yellow / Red |
| **Cost** | Session cost in USD | stdin JSON | Cyan |

Colors adapt based on usage: green (< 70%), yellow (70-89%), red (90%+).

## Setup

```bash
/workflow:setup-statusline enable
```

Then **restart Claude Code** to see the status line. `enable` also asks whether to turn on the optional extra-usage segment (default: No).

## Manage

```bash
/workflow:setup-statusline status    # Check current configuration
/workflow:setup-statusline enable    # Add status line to settings
/workflow:setup-statusline disable   # Remove status line from settings
```

## How It Works

- Everything comes from the JSON Claude Code passes to the status line on stdin: model, context, cost and the `rate_limits` windows
- No credentials are read and no network call is made
- Each run records the window resets in a small cache file (see Reset cache)

## When the usage bars are missing

The 5h and 7d bars are simply absent when Claude Code sends no data for them. Each window can be absent independently. Typical causes:

- The session has just started; the bars appear after the first response
- An API-key session, or no Pro, Max or Ultra subscription
- An older Claude Code that does not send `rate_limits`
- A window that has just reset

The rest of the line (model, context, cost) still renders.

## Extra usage (opt-in)

Off by default. Turning it on makes the status line read your local Claude credentials (`~/.claude/.credentials.json`, or the macOS Keychain) and call an undocumented Anthropic usage endpoint. That endpoint may change or stop working.

When on, it adds the `+` segment between 7d and ctx and can fill the 5h and 7d bars at session start, before Claude Code sends them:

```
Opus │ 5h █████░░░░░  52% 2h30m │ 7d ████░░░░░░  35% 3d │ +  29% $11.61/$40.00 │ ctx ████░░░░░░  42% │ $0.12
```

**Turn it on or off**

- `/workflow:setup-statusline enable` asks and records your answer; `disable` turns it off
- Or edit `~/.claude-workflows/statusline.json` (the directory follows `CLAUDE_WORKFLOW_STATE_DIR` if set):

```json
{ "extra_usage": true }
```

Only the JSON value `true` enables it. The change applies on the next status line refresh.

**Behaviour**

- When both stdin and the fetched data have a window, stdin wins
- If the lookup fails for any reason (no credentials, network error, changed endpoint), the default line is shown unchanged
- Responses are cached for 60 seconds, and a failed lookup for 30 seconds, in `claude-statusline-oauth-usage.json` in the state directory (owner-only, `0600`); a failure never falls back to older data
- `rate_limits.spend_limit` (a gateway spend limit) is a different thing and is not shown

## Reset cache

The workflow quota pause reads the next reset time from a cache file:

- Path: `claude-statusline-usage.json` in the system temp directory; override with `CLAUDE_STATUSLINE_CACHE`
- Shape: `{"fetched_at": <ms>, "data": {"five_hour": {"utilization": 52, "resets_at": "<ISO>"}, "seven_day": {...}}}`, where `resets_at` is always an ISO 8601 UTC string
- A window missing from stdin keeps its last known reset until that reset passes
- Expired windows are removed
- The file is written only when its content changes, and not created when there is nothing to record
- The status line reads an existing file only when it is a regular file owned by you. A file owned by another user, or anything that is not a regular file, is ignored as if absent; the temp directory is shared on multi-user machines

Inspect it with `cat "$(node -e "console.log(require('os').tmpdir())")/claude-statusline-usage.json"`; deleting it is safe.

## Requirements

- Node.js (included with Claude Code)
- Claude Pro, Max or Ultra subscription for the 5h and 7d bars

## Notes

- The status line updates after each assistant message (debounced 300ms)
