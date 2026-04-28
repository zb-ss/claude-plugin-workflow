# Workflow Status

Check the status of active or recent workflows.

## Usage
```
/workflow:status [workflow_id]
/workflow:status completed
/workflow:status --all
```

## Input
$ARGUMENTS

## Instructions

### 1. List Active Workflows

If no `$ARGUMENTS` provided, list all active workflows.

**First, resolve the home and repo-scoped active directories:**
```bash
echo $HOME
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/workflow}"
ACTIVE_DIR=$(node "$PLUGIN_ROOT/lib/active-dir-cli.js")
```

**Then use Glob tool with ABSOLUTE paths** (never use `~` in tool calls). Search
both the repo-scoped dir AND the legacy flat root for backward compatibility:
```
Glob(pattern="$ACTIVE_DIR/*")
Glob(pattern="$HOME/.claude-workflows/active/*.state.json")    # legacy
Glob(pattern="$HOME/.claude-workflows/active/*.org")           # legacy
Glob(pattern="$HOME/.claude-workflows/active/*.md")            # legacy
```

This finds both `.org` and `.md` workflow files for this repository (and legacy
flat-layout files if any remain).

For each workflow file found:
1. Read the file using Read tool
2. Extract metadata:
   - Workflow ID (from filename or header)
   - Type (feature/bugfix/refactor)
   - Description
   - Current step
   - Mode
   - Started at
3. Display summary

### 2. Show Specific Workflow

If `$ARGUMENTS` contains a workflow ID:

1. Find the file (check both `.org` and `.md` extensions)
2. Read the full file using Read tool
3. Parse all steps and their statuses
4. Display a summary:

```
Workflow: <ID>
Type: <type>
Format: <org|md>
Description: <description>
Branch: <branch>
Mode: <mode>
Started: <timestamp>
Status: <active|paused|completed>

Steps:
  [✓] Step 0: Planning - completed
  [✓] Step 1: Implementation - completed
  [→] Step 2: Code Review - in progress (iteration 2/3)
  [ ] Step 3: Security Audit - pending
  [ ] Step 4: Test Writing - pending
  [ ] Step 5: Completion - pending

Current: Code Review (iteration 2, found 3 issues)

State file: $ACTIVE_DIR/<id>.<format>     (or legacy: $HOME/.claude-workflows/active/<id>.<format>)
```

### 3. Show Recent Completed

If `$ARGUMENTS` is "completed" or "history":

```
COMPLETED_DIR="$HOME/.claude-workflows/completed/$(node "$PLUGIN_ROOT/lib/repo-key-cli.js")"
Glob(pattern="$COMPLETED_DIR/*")
Glob(pattern="$HOME/.claude-workflows/completed/*")    # legacy
```

Show last 5 completed workflows with their summaries.

### 4. Show All (--all flag)

If `$ARGUMENTS` contains `--all`:

Show all workflows including:
- Active workflows
- Light-style JSON state (if exists)
- Recent completed workflows

### Important Notes

- **Prefer Glob and Read tools** over bash ls/cat for cross-platform reliability
- Support both `.org` and `.md` formats
- Parse format-specific syntax (org properties vs markdown headers)
