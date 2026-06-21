# State Files

Workflows are tracked in human-readable state files that you can **view and edit in real-time**.

## State File Formats

| Format | Extension | Use Case |
|--------|-----------|----------|
| `org` | `.org` (default) | Emacs org-mode, structured sections |
| `md` | `.md` | Markdown, GitHub-friendly, easier to read |

Use `--format=md` to create markdown state files:

```bash
/workflow:start swarm: "Add user auth" --format=md
```

## Self-Describing Schema

Every state file carries `repo_key` and `repo_root` directly in its header so it can always locate itself regardless of how the environment is configured:

**Org-mode:**
```org
#+TITLE: Swarm: Add user authentication
#+PROPERTY: WORKFLOW_ID 20260204-abc123
#+PROPERTY: WORKFLOW_TYPE swarm
#+PROPERTY: REPO_KEY myapp-abc1234
#+PROPERTY: REPO_ROOT /home/user/projects/myapp
```

**Markdown:**
```markdown
# Swarm: Add user authentication

**Workflow ID:** 20260204-abc123
**Workflow Type:** swarm
**Repo Key:** myapp-abc1234
**Repo Root:** /home/user/projects/myapp
```

## Repo-Scoped Buckets

State files live in per-repository buckets so workflows from different repos never collide:

```
~/.claude-workflows/active/<repo-key>/<id>.org
```

`<repo-key>` is derived from the current repository's git remote URL (or the toplevel path when no remote exists). Resolve the exact active directory for the current repo:

```bash
node ~/.claude/plugins/workflow/lib/active-dir-cli.js
```

### Legacy Migration

Pre-v2 workflows stored directly under `~/.claude-workflows/active/` (no subdirectory) are still resumable — they surface under a `[legacy]` tag in each session until they complete. Migrate them with:

```bash
/workflow:migrate-legacy
```

## Org-Mode Format (Default)

```org
#+TITLE: Swarm: Add user authentication
#+PROPERTY: WORKFLOW_ID 20260204-abc123
#+PROPERTY: WORKFLOW_TYPE swarm
#+PROPERTY: REPO_KEY myapp-abc1234
#+PROPERTY: REPO_ROOT /home/user/projects/myapp

* Workflow Steps

** DONE Step 0: Codebase Analysis
:PROPERTIES:
:STATUS: completed
:COMPLETED_AT: 2026-02-04T10:25:00Z
:END:

** DONE Step 1: Planning
:PROPERTIES:
:STATUS: completed
:COMPLETED_AT: 2026-02-04T10:30:00Z
:END:

*** Plan
#+BEGIN_SRC markdown
# Implementation Plan
...
#+END_SRC

** IN-PROGRESS Step 2: Implementation Batch 1
:PROPERTIES:
:STATUS: in-progress
:STARTED_AT: 2026-02-04T10:35:00Z
:END:
```

**Emacs tips:**
- Use `org-mode` for collapsible sections (`TAB` to fold/unfold)
- Edit objectives, add notes — Claude reads the file before each step
- Use `org-todo` to manually mark steps if needed

## Markdown Format

```markdown
# Swarm: Add user authentication

**Workflow ID:** 20260204-abc123
**Workflow Type:** swarm
**Repo Key:** myapp-abc1234
**Repo Root:** /home/user/projects/myapp

## Workflow Steps

### Step 0: Codebase Analysis
**Status:** completed
**Completed:** 2026-02-04T10:25:00Z

### Step 1: Planning
**Status:** completed
**Completed:** 2026-02-04T10:30:00Z

### Step 2: Implementation Batch 1
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
| `~/.claude-workflows/active/<repo-key>/` | Active workflow state files (scoped per repository) |
| `~/.claude-workflows/active/` (flat) | Legacy / pre-v2 workflow state files (migrate with `/workflow:migrate-legacy`) |
| `~/.claude-workflows/completed/<repo-key>/` | Archived completed workflows |
| `~/.claude-workflows/context/` | Codebase context files (shared across repos) |
| `~/.claude-workflows/plans/` | Plan files |

## Environment Overrides

| Variable | Effect |
|----------|--------|
| `CLAUDE_WORKFLOW_STATE_DIR` | Override the entire state root (default `~/.claude-workflows`) |
| `CLAUDE_WORKFLOW_REPO_KEY` | Override the per-repo bucket name (default: derived from git remote / toplevel) |
| `CLAUDE_STATUSLINE_CACHE` | Override the rate-limit reset cache path read by `hooks/lib/rate-limit.js` |
