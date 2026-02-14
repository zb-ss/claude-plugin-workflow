# Status Line

Display your API usage limits, context window, and session cost directly in the Claude Code status bar.

## Preview

```
Opus | 5h ██████████ 100% 2h30m | 7d █████░░░░░  52% 3d | + 29% $11.61/$40.00 | ctx ████░░░░░░  42% | $0.87
```

## Segments

| Segment | Description | Color |
|---------|-------------|-------|
| **Model** | Current model name | White bold |
| **5h** | 5-hour rolling session limit + time until reset | Green / Yellow / Red |
| **7d** | 7-day weekly limit (all models) + time until reset | Green / Yellow / Red |
| **+** | Extra usage spend vs monthly cap (OAuth only) | Cyan |
| **ctx** | Context window usage | Green / Yellow / Red |
| **Cost** | Session cost in USD | Cyan |

Colors adapt based on usage: green (< 70%), yellow (70-89%), red (90%+).

## Setup

```bash
/workflow:setup-statusline enable
```

Then **restart Claude Code** to see the status line.

## Manage

```bash
/workflow:setup-statusline status    # Check current configuration
/workflow:setup-statusline enable    # Add status line to settings
/workflow:setup-statusline disable   # Remove status line from settings
```

## How It Works

- Fetches usage limits from the Anthropic OAuth API (same data as `/usage`)
- Reads session info (model, context, cost) from Claude Code's stdin JSON
- Caches API responses for 60 seconds to avoid excessive calls
- Cross-platform credential retrieval:
  - **Linux/Windows/WSL**: Reads `~/.claude/.credentials.json`
  - **macOS**: Falls back to Keychain if file not found

## Requirements

- Claude Code Pro or Max subscription (for OAuth credentials)
- Node.js (included with Claude Code)

## Notes

- Uses an undocumented API endpoint (`/api/oauth/usage`) - may change in future
- If credentials are not found, only context and cost are shown (no usage bars)
- The status line updates after each assistant message (debounced 300ms)
