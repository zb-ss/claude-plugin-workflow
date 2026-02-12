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

## Recommended Settings

For optimal autonomous workflow execution, copy the recommended settings to your project:

```bash
# For shared settings (committed to git)
cp ~/.claude/plugins/workflow/resources/recommended-settings.json .claude/settings.json

# For personal settings (git-ignored)
cp ~/.claude/plugins/workflow/resources/recommended-settings.json .claude/settings.local.json
```

Or manually add to your `.claude/settings.json`:

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "additionalDirectories": [
      "~/.claude/workflows",
      "~/.claude/plans"
    ],
    "allow": [
      "Read", "Write", "Edit", "Glob", "Grep", "Task", "TodoWrite",
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

**Important:** The `additionalDirectories` setting grants Claude Code access to workflow state directories outside your project.

## Hooks

The plugin includes automated validation hooks (enabled by default, cross-platform):

| Hook | Trigger | Platforms |
|------|---------|-----------|
| TypeScript validation | After `.ts`/`.tsx` edits | Windows, macOS, Linux |
| PHP syntax check | After `.php` edits | Windows, macOS, Linux |
| Python syntax check | After `.py` edits | Windows, macOS, Linux |
| JSON validation | After `.json` writes | Windows, macOS, Linux |

Hooks are written in Node.js for full cross-platform compatibility. They gracefully skip validation if the required tool (php, python, etc.) is not installed.

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
