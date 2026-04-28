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

State files are stored at `~/.claude-workflows/active/<repo-key>/<id>.org`,
where `<repo-key>` is derived from the current repository's git remote (or
toplevel path) so workflows in different repos do not collide. Resolve the
exact path by running `node ~/.claude/plugins/workflow/lib/active-dir-cli.js`,
or override either piece via `CLAUDE_WORKFLOW_STATE_DIR` /
`CLAUDE_WORKFLOW_REPO_KEY`.

Pre-v2 workflows that live directly under `~/.claude-workflows/active/` (no
subdirectory) are still resumable — they are surfaced under a `[legacy]` tag
in every session until they complete.

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
| `~/.claude-workflows/active/<repo-key>/` | Active workflow state files (per repository) |
| `~/.claude-workflows/active/` (flat) | Legacy / pre-v2 workflow state files |
| `~/.claude-workflows/completed/<repo-key>/` | Archived completed workflows |
| `~/.claude-workflows/context/` | Codebase context files (shared across repos) |
| `~/.claude-workflows/memory/` | Project memory files (shared across repos) |
| `~/.claude-workflows/plans/` | Plan files |

### Environment overrides

| Variable | Effect |
|----------|--------|
| `CLAUDE_WORKFLOW_STATE_DIR` | Override the entire state root (default `~/.claude-workflows`) |
| `CLAUDE_WORKFLOW_REPO_KEY` | Override the per-repo bucket name (default: derived from git remote / toplevel) |
| `CLAUDE_STATUSLINE_CACHE` | Override the rate-limit reset cache path read by `hooks/lib/rate-limit.js` |
```
