# Workflow Plugin for Claude Code

Automated development workflow orchestration with tiered agents and execution modes.

## Installation

In Claude Code, run:

```
/plugin marketplace add zb-ss/claude-plugin-workflow
/plugin install workflow@zb-ss-claude-plugin-workflow
```

After installation, run the setup command to configure permissions:

```
/workflow:setup
```

This will check your settings and offer to add the required permissions for autonomous workflow execution.

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| setup | `/workflow:setup` | Configure permissions for workflow plugin |
| start | `/workflow:start` | Start a new development workflow |
| status | `/workflow:status` | Check workflow status |
| resume | `/workflow:resume` | Resume an existing workflow |
| mode | `/workflow:mode` | Switch execution mode |
| verify | `/workflow:verify` | Run verification loop |

## Usage Examples

### Start New Workflow

```bash
# Standard mode (default)
/workflow:start feature "Add user authentication"

# With specific mode
/workflow:start feature "Add payment processing" --mode=thorough
/workflow:start bugfix "Fix login validation" --mode=eco

# With light style (JSON state instead of org)
/workflow:start bugfix "Quick typo fix" --mode=eco --style=light
```

### Execution Modes

| Mode | Description | Model | Review Depth |
|------|-------------|-------|--------------|
| `standard` | Balanced (default) | sonnet | 1 code + 1 security |
| `turbo` | Maximum speed | haiku | Advisory only |
| `eco` | Token-efficient | haiku | 1 code review |
| `thorough` | Maximum quality | opus (reviews) | Multi-gate chain |

### Planning Styles

| Style | Storage | Use Case |
|-------|---------|----------|
| `full` | Org file (default) | Complex features, audit trail |
| `light` | JSON file | Quick fixes, simple tasks |

### Switch Mode Mid-Workflow

```bash
/workflow:mode thorough   # Switch to thorough for remaining steps
/workflow:mode eco        # Switch to eco to save tokens
```

### Run Verification

```bash
/workflow:verify                # Full verification loop
/workflow:verify --phase=build  # Just build check
/workflow:verify --phase=test   # Just run tests
```

### Check Status

```bash
/workflow:status           # Current workflow status
/workflow:status --all     # All active workflows
```

### Resume Workflow

```bash
/workflow:resume                # Resume last workflow
/workflow:resume auth-feature   # Resume specific workflow
```

## Workflow Types

- **feature**: New feature development
- **bugfix**: Bug fix workflow
- **refactor**: Code refactoring

## Agents

The plugin includes 16 tiered agents:

### Codebase Analysis
- `codebase-analyzer` (sonnet) - Extracts conventions, patterns, best practices

### Planning
- `architect-lite` (haiku) - Quick analysis
- `architect` (opus) - Deep architectural planning

### Implementation
- `executor-lite` (haiku) - Simple changes
- `executor` (sonnet) - Standard implementation

### Code Review
- `reviewer-lite` (haiku) - Quick review
- `reviewer` (sonnet) - Standard review
- `reviewer-deep` (opus) - Comprehensive review

### Security
- `security-lite` (haiku) - Quick security scan
- `security` (sonnet) - OWASP coverage
- `security-deep` (opus) - Deep security audit

### Other
- `explorer` (haiku) - Codebase exploration
- `test-writer` (sonnet) - Test generation
- `perf-lite` (haiku) - Quick performance check
- `perf-reviewer` (sonnet) - Performance analysis
- `doc-writer` (haiku) - Documentation updates

## Workflow Pipeline

All workflows start with codebase analysis to ensure consistency:

```
Codebase Analysis → Extracts conventions and patterns
     ↓
Planning → Creates implementation plan using context
     ↓
Implementation → Follows conventions from context
     ↓
Review Chain → Validates against codebase patterns
```

## Thorough Mode Review Chain

In thorough mode, ALL gates must pass:

```
Codebase Analysis (fresh)
     ↓
Planning (architect/opus)
     ↓
Implementation
     ↓
Code Review (opus) → FAIL → Fix → Retry (max 3)
     ↓ PASS
Security Review (opus) → FAIL → Fix → Retry (max 2)
     ↓ PASS
Test Coverage (80% min) → FAIL → Add tests → Retry
     ↓ PASS
[Advisory] Performance Review
     ↓
[Advisory] Documentation Check
     ↓
COMPLETE
```

## Hooks

The plugin includes automated hooks (enabled by default):

- **TypeScript**: Type-check after edits
- **PHP**: Syntax-check after edits
- **Python**: Syntax-check after edits
- **JSON**: Validate after writes
- **Safety**: Block dangerous commands

## Features

- **Codebase analysis** before planning (extracts conventions)
- **Parallel agent execution** where phases are independent
- **Fully autonomous mode** - no permission prompts for safe operations
- Org-mode based state tracking (default)
- JSON state for light style
- Tiered agent routing by mode
- Multi-agent review chains
- Verification loops
- Progress persistence
- Error recovery
- Branch management

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

## Parallel Execution

| Mode | Parallel Behavior |
|------|-------------------|
| turbo | Code + Security reviews parallel, multi-file implementation |
| standard | Code + Security reviews parallel on first pass |
| thorough | Performance + Documentation checks parallel |
| eco | Sequential only (minimize tokens) |

## Workflow Best Practices

1. **Explore-Plan-Code Pattern**: Understand codebase before changes
2. **Incremental Progress**: Complete one unit, validate, proceed
3. **State Persistence**: State file is the source of truth
4. **Error Recovery**: Log errors, offer recovery options

## Mode Selection Guide

| Scenario | Recommended Mode |
|----------|------------------|
| Quick prototype | turbo |
| Simple bug fix | eco |
| Regular feature | standard |
| Security-sensitive | thorough |
| Production release | thorough |
| Budget-conscious | eco |

## Requirements

- Claude Code with Task tool access
- Git repository

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
    "allow": [
      "Read", "Write", "Edit", "Glob", "Grep", "Task", "TodoWrite",
      "Edit(~/.claude/workflows/**)",
      "Write(~/.claude/workflows/**)",
      "Edit(~/.claude/plans/**)",
      "Write(~/.claude/plans/**)",
      "Bash(mkdir -p ~/.claude/workflows)",
      "Bash(mkdir -p ~/.claude/plans)",
      "Bash(git status)", "Bash(git diff *)", "Bash(git add *)",
      "Bash(git checkout -b *)", "Bash(npm run *)", "Bash(npm test *)",
      "Bash(composer *)", "Bash(php -l *)", "Bash(python -m pytest *)"
    ],
    "ask": [
      "Bash(git commit *)", "Bash(git push *)", "Bash(rm *)"
    ],
    "deny": [
      "Bash(rm -rf *)", "Bash(git reset --hard *)", "Bash(git push --force *)"
    ]
  }
}
```

**Important:** The `~/.claude/workflows/**` and `~/.claude/plans/**` permissions allow the workflow to manage state files without prompts.

See `resources/recommended-settings.json` for the full configuration.

**Note:** Plugins cannot set permissions directly. Users must configure their project settings.

## License

MIT
