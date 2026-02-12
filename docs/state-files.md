# State Files

Workflows are tracked in human-readable state files that you can **view and edit in real-time**.

## Planning Styles

| Style | Storage | Use Case |
|-------|---------|----------|
| `full` | State file (default) | Complex features, audit trail, user-editable |
| `light` | JSON file | Quick fixes, simple tasks, minimal overhead |

## State File Formats

| Format | Extension | Use Case |
|--------|-----------|----------|
| `org` | `.org` (default) | Emacs org-mode, structured sections |
| `md` | `.md` | Markdown, GitHub-friendly, easier to read |

Use `--format=md` to create markdown state files:

```bash
/workflow:start feature "Add user auth" --format=md
```

## Org-Mode Format (Default)

State files are stored at `~/.claude/workflows/active/<id>.org`:

```org
#+TITLE: Feature: Add user authentication
#+PROPERTY: WORKFLOW_ID 20260204-abc123
#+PROPERTY: MODE thorough

* Workflow Steps

** DONE Step 0: Planning
:PROPERTIES:
:STATUS: completed
:COMPLETED_AT: 2026-02-04T10:30:00Z
:END:

*** Plan
#+BEGIN_SRC markdown
# Implementation Plan
...
#+END_SRC

** IN-PROGRESS Step 1: Implementation
:PROPERTIES:
:STATUS: in-progress
:STARTED_AT: 2026-02-04T10:35:00Z
:END:
```

**Emacs tips:**
- Use `org-mode` for collapsible sections (`TAB` to fold/unfold)
- Edit objectives, add notes - Claude reads the file before each step
- Use `org-todo` to manually mark steps if needed

## Markdown Format

```markdown
# Feature: Add user authentication

**Workflow ID:** 20260204-abc123
**Mode:** thorough

## Workflow Steps

### Step 0: Planning
**Status:** completed
**Completed:** 2026-02-04T10:30:00Z

#### Plan
...

### Step 1: Implementation
**Status:** in-progress
**Started:** 2026-02-04T10:35:00Z
```

## Live Editing

You can edit the state file while the workflow runs:
- Add notes or context for Claude to see
- Manually check off objectives
- Modify the plan before implementation starts
- Add intervention notes

Claude reads the state file before each step, so your edits are respected.

## File Locations

| Path | Purpose |
|------|---------|
| `~/.claude/workflows/active/` | Active workflow state files |
| `~/.claude/workflows/completed/` | Archived completed workflows |
| `~/.claude/workflows/context/` | Codebase context files |
| `~/.claude/workflows/memory/` | Project memory files |
| `~/.claude/plans/` | Plan files |
```
