# Workflow Setup

name: setup
description: Configure Claude Code permissions for workflow plugin
user-invocable: true
arguments: none

## Instructions

Help the user configure their Claude Code settings for optimal workflow execution.

### Step 1: Check Current Settings

Read the user's settings files to understand current configuration:

1. Check `~/.claude/settings.json` (global settings)
2. Check `.claude/settings.json` (project settings if in a project)
3. Check `.claude/settings.local.json` (project local settings if in a project)

### Step 2: Identify Missing Permissions

The workflow plugin requires these permissions for autonomous operation:

**Critical for state management (add to global `~/.claude/settings.json`):**
```json
"Edit(~/.claude/workflows/**)",
"Write(~/.claude/workflows/**)",
"Edit(~/.claude/plans/**)",
"Write(~/.claude/plans/**)",
"Bash(mkdir -p ~/.claude/workflows)",
"Bash(mkdir -p ~/.claude/plans)"
```

**Recommended for workflows (can be global or project-level):**
```json
"Read", "Write", "Edit", "Glob", "Grep", "Task", "TodoWrite",
"Bash(git status)", "Bash(git diff *)", "Bash(git add *)",
"Bash(git checkout -b *)", "Bash(git switch -c *)",
"Bash(npm run *)", "Bash(npm test *)",
"Bash(composer *)", "Bash(php -l *)"
```

### Step 3: Show What's Missing

Compare current settings against required permissions and list what's missing.

### Step 4: Offer to Update

Ask the user if they want you to add the missing permissions to their settings.

**For global settings (`~/.claude/settings.json`):**
- Workflow state directory permissions are REQUIRED here
- Other permissions can optionally go here

**For project settings (`.claude/settings.json` or `.claude/settings.local.json`):**
- Project-specific build/test commands

### Step 5: Apply Changes

If the user agrees, update the appropriate settings file(s):

1. Read the current file
2. Parse the JSON
3. Merge the new permissions into `permissions.allow` array
4. Write the updated JSON

### Output Format

```
## Workflow Plugin Setup

### Current Configuration
- Global settings: [found/not found]
- Project settings: [found/not found]

### Missing Permissions
[List permissions that need to be added]

### Recommended Actions
1. Add workflow state permissions to ~/.claude/settings.json
2. [Other recommendations]

Would you like me to update your settings?
```

### Important Notes

- Always preserve existing permissions
- Don't duplicate entries
- Use proper JSON formatting
- Back up existing settings before modifying (mention the original content in output)
- Restart Claude Code is required after settings changes
