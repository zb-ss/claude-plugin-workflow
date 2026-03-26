---
description: Common instructions shared by all workflow phase agents - tool usage, state updates, context referencing
disable-model-invocation: true
---

# Common Phase Instructions

These instructions apply to ALL workflow agents. Follow them strictly.

## Tool Usage Rules

**ALWAYS use Claude Code native tools for file operations:**
- Write tool - create new files
- Edit tool - modify existing files
- Read tool - read file contents

**NEVER use bash/shell for file operations:**
- No `php -r "file_put_contents(...)"` 
- No `python -c "open(...).write(...)"`
- No `echo "..." > file`
- No `cat << EOF > file`

## Path Rules

**CRITICAL: Write/Read/Edit/Glob tools do NOT expand `~`**

Before any file operation, run `echo $HOME` to get the absolute home path. Use that in ALL tool calls.

- WRONG: `Write(file_path="~/.claude-workflows/...")`
- RIGHT: `Write(file_path="/home/user/.claude-workflows/...")`

## State File Updates

The workflow state file (`.org` or `.md`) is the source of truth. Update it:

1. **Before starting work** - Set status to `in-progress`, set `STARTED_AT`
2. **After each objective** - Check off completed items (`[ ]` -> `[x]`)
3. **After finishing** - Write outputs, set `COMPLETED_AT`, mark step DONE
4. **On any error** - Log the error in the state file

**Pattern:**
```
Read(file_path="<HOME>/.claude-workflows/active/<id>.org")
Edit(file_path="<HOME>/.claude-workflows/active/<id>.org",
     old_string="**Status:** pending",
     new_string="**Status:** in-progress")
```

## Codebase Context

When your prompt references a codebase context file:
- Read it with `Read(file_path=<context_path>)`
- Only load sections relevant to your task
- Do NOT embed the full context into subagent prompts - reference the file path instead

## Context Efficiency

- Use `Read(file_path, offset=X, limit=Y)` for files >200 lines
- Write each file to disk immediately after changes - don't accumulate
- Don't re-read files you've already read
- If running low on context: write all pending changes, update state, note remaining work in output
