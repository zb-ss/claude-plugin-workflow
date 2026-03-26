# Workflow Learn

Extract reusable patterns from the current session and save them for future use.

## Usage
```
/workflow:learn [pattern-name]
```

## What This Does

1. Analyzes the current conversation for reusable patterns
2. Filters out trivial fixes (typos, simple syntax)
3. Saves valuable learnings to `~/.claude-workflows/memory/`
4. Creates skill files for highly reusable patterns

## Input
$ARGUMENTS

---

## Instructions

You are extracting learnings from this session. Follow these steps:

### Step 1: Analyze Session

Review the conversation history for:

1. **Error Resolutions** - Root causes and fixes that could recur
2. **Debugging Approaches** - Tool combinations that worked well
3. **Workarounds** - Library quirks, API limitations, version-specific solutions
4. **Codebase Patterns** - Discovered conventions and architectural decisions
5. **Key Decisions** - Important choices made and their reasoning

### Step 2: Filter for Value

**INCLUDE patterns that are:**
- Reusable across similar situations
- Non-obvious solutions
- Project-specific conventions
- Error patterns that might recur

**EXCLUDE patterns that are:**
- Trivial fixes (typos, basic syntax)
- One-time issues (temporary outages)
- Already documented in codebase-analyzer context
- Too specific to generalize

### Step 3: Determine Storage

Based on what you found, choose the appropriate storage:

#### Option A: Project CLAUDE.md (default)
For project-specific learnings - auto-loaded by Claude Code for ALL sessions.

```bash
# Get project root
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# Append to project's CLAUDE.md under "## Workflow Learnings" section
# File: $PROJECT_ROOT/CLAUDE.md
```

Append learnings under `## Workflow Learnings` with subsections:
- Patterns Discovered
- Issues Resolved
- Key Decisions

#### Option B: Reusable Skill
For patterns that apply across multiple projects.

Create a skill file at `<HOME>/.claude/skills/learned/<pattern-name>.md` (resolve `<HOME>` via `echo $HOME`).

```markdown
# <Pattern Name>

> Extracted: {{DATE}}
> Applicability: <when this pattern applies>

## Problem

<specific issue this addresses>

## Solution

<the reusable pattern or technique>

## Example

<code demonstration if relevant>

## Trigger Conditions

<when this skill should activate>
```

### Step 4: Save Learnings

1. Get the project root:
   ```bash
   PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   ```

2. Read existing CLAUDE.md if present:
   ```bash
   cat "$PROJECT_ROOT/CLAUDE.md" 2>/dev/null || echo "# Project Instructions"
   ```

3. Append new learnings under `## Workflow Learnings` section
   - If section doesn't exist, create it
   - Avoid duplicating existing entries

4. For reusable skills, create the skill file using Write tool with absolute path (never `~`)

### Step 5: Report

Summarize what was learned:

```
┌─────────────────────────────────────────────────────────┐
│ LEARNINGS EXTRACTED                                     │
├─────────────────────────────────────────────────────────┤
│ Project CLAUDE.md Updated: <project>/CLAUDE.md          │
│ (Auto-loaded by Claude Code for all sessions)           │
│                                                         │
│ New Patterns:                                           │
│ • <pattern 1>                                           │
│ • <pattern 2>                                           │
│                                                         │
│ Reusable Skills Created:                                │
│ • ~/.claude/skills/learned/<skill-name>.md              │
│                                                         │
│ Filtered Out (trivial):                                 │
│ • <why certain things were excluded>                    │
└─────────────────────────────────────────────────────────┘
```

## Quality Guidelines

### Good Patterns to Extract

```markdown
## Problem
Jest tests fail with "Cannot find module" when using path aliases

## Solution
Add moduleNameMapper to jest.config.js matching tsconfig paths:
```js
moduleNameMapper: {
  '^@/(.*)$': '<rootDir>/src/$1'
}
```

## Trigger
When seeing path alias import errors in Jest tests
```

### Patterns to Skip

- "Fixed typo in variable name" (too trivial)
- "Server was down, waited and retried" (one-time issue)
- "Added semicolon" (basic syntax)

## Memory File Format

```markdown
# Project Memory: my-project

## Last Updated
2024-01-15T10:30:00Z

## Key Decisions
- Using repository pattern for data access (decided 2024-01-10)
- Chose Zod over Yup for validation - better TypeScript inference

## Patterns Discovered
- This codebase uses barrel exports in each module's index.ts
- Error handling follows Result<T, E> pattern, not exceptions

## Issues Resolved
- ESLint conflict with Prettier: added eslint-config-prettier
- TypeScript strict mode broke 15 files: documented fixes in MIGRATION.md

## Conventions Learned
- All API responses wrapped in { data, error, meta } envelope
- Feature flags stored in config/features.ts, not env vars
```

## Integration with Workflows

When a workflow completes successfully, it should call `/workflow:learn` to extract patterns before closing. This ensures continuous improvement of project knowledge.
