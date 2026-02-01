# Workflow Plugin for Claude Code

Automated development workflow orchestration with tiered agents and execution modes.

## Installation

In Claude Code, run:

```
/plugin marketplace add zb-ss/claude-plugin-workflow
/plugin install workflow@zb-ss-claude-plugin-workflow
```

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
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

The plugin includes 15 tiered agents:

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

## Thorough Mode Review Chain

In thorough mode, ALL gates must pass:

```
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

- Org-mode based state tracking (default)
- JSON state for light style
- Tiered agent routing by mode
- Multi-agent review chains
- Verification loops
- Progress persistence
- Error recovery
- Branch management

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

## License

MIT
