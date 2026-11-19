# Settings & Permissions

## Autonomous Execution

Workflows run **without asking permission** for:
- File read/write/edit operations
- Branch creation
- Validation commands (lint, type-check)
- Build and test commands
- Subagent spawning

**User confirmation required only for:**
- Git commits (user reviews first)
- Git push
- File deletion
- Destructive operations

`/workflow:do` never commits. The autonomous driver does: it commits, pushes and opens
pull requests on a branch per issue, so unattended runs need `git push` and
`gh pr create` allowed (see `resources/autonomy-config.md`). In a driver run the push
hook allows only `cd "<repo>" && git push -u origin <branch>` (never the default branch,
no other flags or refspecs) and `cd "<repo>" && gh pr create` with `--title`, `--body`,
`--body-file`, `--base`, `--head`, `--draft` and `--repo`; everything else, including
GitHub MCP write tools, is denied.

## Recommended Settings

For optimal autonomous workflow execution, copy the recommended settings to your project:

```bash
# For shared settings (committed to git)
cp $CLAUDE_PLUGIN_ROOT/resources/recommended-settings.json .claude/settings.json

# For personal settings (git-ignored)
cp $CLAUDE_PLUGIN_ROOT/resources/recommended-settings.json .claude/settings.local.json
```

Or manually add to your `.claude/settings.json`:

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "additionalDirectories": [
      "~/.claude-workflows",
      "~/.claude/skills"
    ],
    "allow": [
      "Read", "Write", "Edit", "Glob", "Grep", "Task", "TodoWrite",
      "Edit(~/.claude-workflows/**)", "Edit(~/.claude/skills/**)",
      "Write(~/.claude-workflows/**)", "Write(~/.claude/skills/**)",
      "Bash(*)"
    ],
    "ask": [
      "Bash(git push *)", "Bash(rm *)"
    ],
    "deny": [
      "Bash(rm -rf *)", "Bash(git reset --hard *)",
      "Bash(git push --force *)", "Bash(sudo *)"
    ]
  }
}
```

**How it works:** Rules evaluate in order: `deny > ask > allow`. `Bash(*)` allows all bash commands except those matched by `deny` (always blocked) or `ask` (prompts for confirmation).

**Important:** The `additionalDirectories` setting grants Claude Code **read** access to workflow state directories outside your project. The path-scoped `Edit(~/.claude-workflows/**)` and `Write(~/.claude-workflows/**)` rules are what actually allow **writing** state files without permission prompts — bare `Edit`/`Write` alone only cover the working directory. One entry covers the whole state directory.

## Hooks

The plugin ships these hooks (enabled by default, cross-platform):

| Hook | Trigger | Purpose |
|------|---------|---------|
| Scrub gate | Before `git push`, `gh pr create` and GitHub MCP writes | Scans the repository a push runs in (`cd <dir> && git push` or `git -C <dir> push`) and any `--body-file`, and blocks internal information from reaching a public repository |
| Setup check | Session start (new sessions only) | Prints one line when the model-tier note, the session model or a configured scrub denylist needs attention; prints nothing otherwise |

Hooks are written in Node.js for full cross-platform compatibility.

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| Linux | Full | Native support |
| macOS | Full | Native support |
| Windows | Full | Cross-platform hooks |
| WSL | Full | Runs as Linux |

## Requirements

- Claude Code with Task tool access
- Git repository
- Node.js (for hooks - included with Claude Code)
