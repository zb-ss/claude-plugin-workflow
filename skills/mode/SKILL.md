---
name: mode
description: Switch execution mode for current workflow
user_invocable: true
usage: /workflow:mode <mode>
arguments:
  - name: mode
    required: true
    description: Target mode (standard, turbo, eco, thorough)
---

# Switch Execution Mode

Switch the execution mode for the current workflow. This affects agent routing and review depth for remaining steps.

## Usage

```
/workflow:mode <mode>
```

## Available Modes

| Mode | Description | Primary Models | Review Depth |
|------|-------------|----------------|--------------|
| `standard` | Balanced approach (default) | sonnet | 1 code + 1 security |
| `turbo` | Maximum speed | haiku | Advisory only |
| `eco` | Token-efficient | haiku | 1 code review |
| `thorough` | Maximum quality | opus for reviews | Multi-gate chain |

## Examples

```bash
# Switch to thorough mode for remaining steps
/workflow:mode thorough

# Switch to eco mode to conserve tokens
/workflow:mode eco

# Switch to turbo for quick iteration
/workflow:mode turbo
```

## Instructions

When the user invokes this skill:

1. **Check for active workflow**
   - Look for workflow state in `~/.claude/workflows/state.json` or active org file
   - If no active workflow, inform user and suggest using `/workflow:start`

2. **Validate the requested mode**
   - Must be one of: `standard`, `turbo`, `eco`, `thorough`
   - If invalid, show available options

3. **Update workflow state**
   - For org-mode state: Update `#+MODE:` property
   - For JSON state: Update `mode` field
   - Log the mode change with timestamp

4. **Load new mode configuration**
   - Read configuration from `modes/<mode>.org`
   - Apply new agent routing for remaining steps
   - Show summary of what changes

5. **Confirm to user**
   - Display current phase
   - Show which agents will be used for remaining steps
   - Warn about implications (e.g., thorough mode = more iterations)

## Mode Effects

### Switching to `standard`
- Code review: reviewer (sonnet)
- Security: security (sonnet)
- Tests: optional

### Switching to `turbo`
- All reviews become advisory (non-blocking)
- Uses haiku models
- Parallel execution enabled

### Switching to `eco`
- Minimal exploration
- Single review iteration
- Haiku models only

### Switching to `thorough`
- All gates become mandatory
- Uses opus for reviews
- 80% test coverage required
- Maximum 3 review iterations

## State Update Example

### Org-mode
```org
#+MODE: thorough
#+MODE_CHANGED: 2024-01-15T14:30:00Z
#+MODE_REASON: User requested for security-sensitive feature
```

### JSON State
```json
{
  "mode": "thorough",
  "mode_changed_at": "2024-01-15T14:30:00Z",
  "previous_mode": "standard"
}
```
