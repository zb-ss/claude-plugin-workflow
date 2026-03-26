# Workflow Setup

name: setup
description: Configure Claude Code permissions and initialize workflow directories
user-invocable: true
arguments: none

## Instructions

Help the user configure their Claude Code settings and initialize workflow directories for optimal execution.

### Step 1: Initialize Workflow Directories

**CRITICAL:** Before checking settings, ensure all required directories exist.

**Step 1a: Get home directory path**
First, get the absolute home directory path:
```bash
echo $HOME
```
This returns something like `/home/username` or `/Users/username`.

**Step 1b: Create directories using ABSOLUTE paths**
Use the Write tool to create `.gitkeep` files. **IMPORTANT:** The Write tool does NOT expand `~` - you MUST use absolute paths.

Required directories (replace `/home/user` with actual home path):
```
/home/user/.claude-workflows/active/
/home/user/.claude-workflows/completed/
/home/user/.claude-workflows/context/
/home/user/.claude-workflows/memory/
/home/user/.claude-workflows/plans/
/home/user/.claude/skills/
/home/user/.claude/skills/learned/
```

For each directory, use Write with the FULL absolute path:
```
Write(file_path="/home/user/.claude-workflows/active/.gitkeep", content="")
```

**Alternative:** Run the initialization script (works with tilde expansion):
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
      "~/.claude-workflows",
      "~/.claude/skills"
    ]
  }
}
```

The `additionalDirectories` setting grants **read** access to paths outside the project directory. **Without this, workflows cannot read state files.**

**CRITICAL for writing state files (MUST be in global `~/.claude/settings.json`):**

Path-scoped Edit/Write rules are required because `additionalDirectories` only grants read access — bare `Edit`/`Write` in the allow list only cover the working directory:
```json
{
  "permissions": {
    "allow": [
      "Edit(~/.claude-workflows/**)",
      "Edit(~/.claude/skills/**)",
      "Write(~/.claude-workflows/**)",
      "Write(~/.claude/skills/**)"
    ]
  }
}
```

**Without these rules, every workflow will prompt for permission when writing state/org files.**

**Recommended for workflows (can be global or project-level):**
```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
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

**How it works:** `Bash(*)` allows all bash commands. Path-scoped `Edit(~/.claude-workflows/**)` and `Write(~/.claude-workflows/**)` allow writing state files without prompts. Rules evaluate: `deny > ask > allow`, so dangerous commands are still blocked and sensitive ones still prompt.

### Step 4: Show Status

Report the status in a clear format:

```
## Workflow Plugin Setup

### Directory Status
✓ ~/.claude-workflows/active/     (exists)
✓ ~/.claude-workflows/completed/  (exists)
✓ ~/.claude-workflows/context/    (exists)
✓ ~/.claude-workflows/memory/     (created)
✓ ~/.claude-workflows/plans/      (exists)
✓ ~/.claude/skills/learned/       (created)

### Settings Status
- Global settings (~/.claude/settings.json): [found/not found]
- Project settings (.claude/settings.json): [found/not found]

### Permission Check (Read Access)
✓ additionalDirectories includes ~/.claude-workflows
✗ additionalDirectories missing ~/.claude/skills

### Permission Check (Write Access)
✓ Edit(~/.claude-workflows/**) in allow list
✗ Write(~/.claude-workflows/**) missing from allow list
✗ Edit(~/.claude/skills/**) missing from allow list
✗ Write(~/.claude/skills/**) missing from allow list

### Recommended Actions
1. Add missing paths to additionalDirectories in ~/.claude/settings.json
2. Add missing path-scoped Edit/Write rules to allow list
3. [Other recommendations]
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

### Step 6b: Recommend Environment Variables

Check if the Agent Teams env var is set:

```bash
echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
```

Show the env var status in the report:

```
### Environment Variables
⚠ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: [not set / set]
  Enables: Swarm mode Agent Teams - peer-to-peer agent messaging (experimental)
  How to set: Add to your shell profile and restart Claude Code
```

If not set, recommend the user add it to their shell profile:

**bash/zsh** (`~/.bashrc` or `~/.zshrc`):
```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

**fish** (`~/.config/fish/config.fish`):
```fish
set -x CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS 1
```

**Important**: Do NOT auto-modify shell profile files. Only show the command for the user to add manually. This env var is optional but enhances swarm mode when available.

### Step 7: Verify Setup

After making changes, verify:
1. All directories exist
2. Settings file is valid JSON
3. Required paths are in additionalDirectories

### Important Notes

- **Use Write tool for directory creation** (cross-platform, auto-creates parents)
- Always preserve existing permissions
- Don't duplicate entries
- Use proper JSON formatting
- Back up existing settings before modifying (mention the original content in output)
- **Restart Claude Code is required after settings changes**

### Troubleshooting

**Issue: Permission prompts during workflows**
- Ensure `Bash(*)` is in the `allow` list (allows all bash commands)
- Ensure `additionalDirectories` includes `~/.claude-workflows` (plans are under `~/.claude-workflows/plans/` so one entry covers both)
- Restart Claude Code after settings changes

**Issue: Permission prompts when writing state/org files**
- `additionalDirectories` only grants **read** access — you also need path-scoped write rules
- Ensure these are in your allow list: `Edit(~/.claude-workflows/**)`, `Write(~/.claude-workflows/**)`, `Edit(~/.claude/skills/**)`, `Write(~/.claude/skills/**)`
- Restart Claude Code after settings changes

**Issue: State files not being created**
- Run `/workflow:setup` to verify directory structure
- Check that `~/.claude-workflows/active/` is writable
- Ensure `Write(~/.claude-workflows/**)` is in your allow list

**Issue: Context/memory not loading**
- Verify `~/.claude-workflows/context/` exists
- Verify `~/.claude-workflows/memory/` exists
