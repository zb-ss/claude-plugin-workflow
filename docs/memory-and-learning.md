# Memory & Learning

Workflow learnings are automatically saved and reused across sessions.

## Where Learnings Are Saved

| Location | Purpose | Auto-loaded? |
|----------|---------|--------------|
| **Project `CLAUDE.md`** | Workflow learnings for this project | Yes, always |
| **`~/.claude/CLAUDE.md`** | Your global coding preferences | Yes, always |

When a workflow completes, the completion-guard appends learnings to the **project's root `CLAUDE.md`** under a `## Workflow Learnings` section. This means:
- Learnings are auto-loaded by Claude Code for ALL sessions (not just workflows)
- They're shared with your team via git
- No special workflow commands needed to benefit from past learnings

## Project CLAUDE.md Example

```markdown
# Project: my-app

## Team Conventions
(your existing project instructions)

## Workflow Learnings

### Patterns Discovered
- Barrel exports in each module's index.ts
- Result<T, E> pattern for error handling

### Issues Resolved
- ESLint conflict with Prettier: added eslint-config-prettier

### Key Decisions
- Using repository pattern for data access
- Chose Zod over Yup for validation
```

## Memory Lifecycle

- **Auto-loaded** by Claude Code for ALL sessions (not just workflows)
- **Updated** at workflow completion by completion-guard agent
- **Shared** with team via git

The completion-guard also moves completed workflows from `active/` to `completed/` directory.

## Extract Patterns Mid-Session

```bash
/workflow:learn
```

Extracts reusable patterns from the current session:
- Error resolutions with root causes
- Debugging approaches that worked
- Workarounds for library quirks
- Project-specific conventions

Saves to:
- `<project>/CLAUDE.md` (project-specific, auto-loaded by CC)
- `~/.claude/skills/learned/<pattern>.md` (reusable across projects)

## Generate Skills from Git History

```bash
/workflow:skill-create
```

Analyzes git history to auto-generate project skills:
- Commit message conventions
- File co-change patterns
- Architecture patterns
- Testing conventions

Run once per project, skills are auto-loaded thereafter.

## Context Budget

Memory is designed to be lightweight:
- Project memory: ~1-2k tokens
- Learned skills: ~500 tokens each
- Git-generated skills: ~1k tokens total

This keeps context impact minimal while improving workflow quality.
