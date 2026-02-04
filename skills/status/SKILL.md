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

**Use Glob tool** (preferred over bash):
```
Glob(pattern="~/.claude/workflows/active/*")
```

This finds both `.org` and `.md` workflow files.

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

State file: ~/.claude/workflows/active/<id>.<format>
```

### 3. Show Recent Completed

If `$ARGUMENTS` is "completed" or "history":

```
Glob(pattern="~/.claude/workflows/completed/*")
```

Show last 5 completed workflows with their summaries.

### 4. Show All (--all flag)

If `$ARGUMENTS` contains `--all`:

Show all workflows including:
- Active workflows
- Light-style JSON state (if exists)
- Recent completed workflows

### Important Notes

- **Use Glob and Read tools** instead of bash ls/cat to avoid permission issues
- Support both `.org` and `.md` formats
- Parse format-specific syntax (org properties vs markdown headers)
