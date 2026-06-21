---
name: migrate-legacy
description: Assign or archive unscoped legacy workflow state files (created before repo-scoping) so they stop leaking into every repo's session.
---

# Migrate Legacy Workflows

Workflows created before repo-scoping live as flat files directly under
`~/.claude-workflows/active/` with **no `repo_key`**. Because they belong to no
repository, the SessionStart hook can only flag them — and until they are
migrated they appear (as a "not tied to this repo" notice) in every session.
This command resolves them: **assign** each to its real repo, or **archive** it.

## Steps

**1. Resolve the plugin root and list the legacy files:**
```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/workflow}"
node "$PLUGIN_ROOT/lib/migrate-legacy-cli.js" list
```
This prints a JSON array of `{path, workflow_id, branch, description, phase}`.
If it's empty, tell the user there is nothing to migrate and stop.

**2. For each legacy workflow, decide its fate** — show the user the
`workflow_id`, `description`, `branch`, and `phase`, and ask whether to:

- **Assign it to a repo** — the user gives the absolute path of the repo it
  belongs to (often inferable from the branch/description). Run, with the target
  repo path as the cwd argument:
  ```bash
  node "$PLUGIN_ROOT/lib/migrate-legacy-cli.js" assign "<state-file-path>" "<target-repo-path>"
  ```
  This stamps `repo_key`/`repo_root` (derived from the target repo, realpath-
  normalized so it is stable across machines and symlinks), rewrites `org_file`,
  and moves the state file plus its `.org`/`.md` sibling into
  `active/<repo-key>/`. Afterwards it surfaces only in that repo's sessions.

- **Archive it** — if the work is finished or abandoned. Run:
  ```bash
  node "$PLUGIN_ROOT/lib/migrate-legacy-cli.js" archive "<state-file-path>" "$(date +%Y%m%d)"
  ```
  This moves the file and its siblings into
  `completed/_legacy-archived-<date>/` (recoverable, out of every active scope).

**3. Confirm** the flat `active/` root no longer holds any `.state.json`:
```bash
node "$PLUGIN_ROOT/lib/migrate-legacy-cli.js" list
```
An empty result means the leak source is gone.

## Notes
- This tool only ever touches **unstamped** flat-root files. A file that already
  has a `repo_key` is left alone (assign refuses it).
- Never hand-edit a flat path or hand-derive a repo-key — the CLI is the source
  of truth and realpath-normalizes consistently with the hooks.
