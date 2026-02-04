# Workflow Setup

name: setup
description: Configure Claude Code permissions and initialize workflow directories
user-invocable: true
arguments: none

## Instructions

Help the user configure their Claude Code settings and initialize workflow directories for optimal execution.

### Step 1: Initialize Workflow Directories

**CRITICAL:** Before checking settings, ensure all required directories exist.

Use the Write tool to create `.gitkeep` files in each directory. This implicitly creates the directories without needing bash mkdir (which may prompt for permission).

Required directories to create:
```
~/.claude/workflows/
~/.claude/workflows/active/
~/.claude/workflows/completed/
~/.claude/workflows/context/
~/.claude/workflows/memory/
~/.claude/plans/
~/.claude/skills/
~/.claude/skills/learned/
```

For each directory, use:
```
Write(file_path="~/.claude/workflows/active/.gitkeep", content="")
```

**Alternative:** Run the initialization script (if user prefers bash):
```bash
node ~/.claude/plugins/workflow/lib/init-directories.js
```

### Step 2: Check Current Settings

Read the user's settings files to understand current configuration:

1. Check `~/.claude/settings.json` (global settings)
2. Check `.claude/settings.json` (project settings if in a project)
3. Check `.claude/settings.local.json` (project local settings if in a project)

### Step 3: Identify Missing Permissions

The workflow plugin requires these permissions for autonomous operation:

**CRITICAL for state management (MUST be in global `~/.claude/settings.json`):**
```json
{
  "permissions": {
    "additionalDirectories": [
      "~/.claude/workflows",
      "~/.claude/plans",
      "~/.claude/skills"
    ]
  }
}
```

The `additionalDirectories` setting grants access to paths outside the project directory. **Without this, workflows cannot create state files.**

**Recommended for workflows (can be global or project-level):**
```json
{
  "permissions": {
    "allow": [
      "Read", "Write", "Edit", "Glob", "Grep", "Task", "TodoWrite",
      "Bash(git status)", "Bash(git diff *)", "Bash(git add *)",
      "Bash(git checkout -b *)", "Bash(git switch -c *)",
      "Bash(npm run *)", "Bash(npm test *)",
      "Bash(composer *)", "Bash(php -l *)"
    ]
  }
}
```

### Step 4: Show Status

Report the status in a clear format:

```
## Workflow Plugin Setup

### Directory Status
✓ ~/.claude/workflows/active/     (exists)
✓ ~/.claude/workflows/completed/  (exists)
✓ ~/.claude/workflows/context/    (exists)
✓ ~/.claude/workflows/memory/     (created)
✓ ~/.claude/plans/                (exists)
✓ ~/.claude/skills/learned/       (created)

### Settings Status
- Global settings (~/.claude/settings.json): [found/not found]
- Project settings (.claude/settings.json): [found/not found]

### Permission Check
✓ additionalDirectories includes ~/.claude/workflows
✗ additionalDirectories missing ~/.claude/plans
✗ additionalDirectories missing ~/.claude/skills

### Recommended Actions
1. Add missing paths to additionalDirectories in ~/.claude/settings.json
2. [Other recommendations]
```

### Step 5: Offer to Update

Ask the user if they want you to add the missing permissions to their settings.

**For global settings (`~/.claude/settings.json`):**
- `additionalDirectories` array is REQUIRED here
- Other permissions can optionally go here

**For project settings (`.claude/settings.json` or `.claude/settings.local.json`):**
- Project-specific build/test commands

### Step 6: Apply Changes

If the user agrees, update the appropriate settings file(s):

1. Read the current file
2. Parse the JSON
3. Merge the new permissions (preserve existing entries, no duplicates)
4. Write the updated JSON

### Step 7: Verify Setup

After making changes, verify:
1. All directories exist
2. Settings file is valid JSON
3. Required paths are in additionalDirectories

### Important Notes

- **Use Write tool for directory creation** (avoids bash permission prompts)
- Always preserve existing permissions
- Don't duplicate entries
- Use proper JSON formatting
- Back up existing settings before modifying (mention the original content in output)
- **Restart Claude Code is required after settings changes**

### Troubleshooting

**Issue: Permission prompts during workflows**
- Ensure `additionalDirectories` includes all workflow paths
- Ensure relevant Bash commands are in `allow` list
- Restart Claude Code after settings changes

**Issue: State files not being created**
- Run `/workflow:setup` to verify directory structure
- Check that `~/.claude/workflows/active/` is writable

**Issue: Context/memory not loading**
- Verify `~/.claude/workflows/context/` exists
- Verify `~/.claude/workflows/memory/` exists
