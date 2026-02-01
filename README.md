# Workflow Plugin for Claude Code

Automated development workflow orchestration with org-mode tracking.

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

## Usage Examples

### Start New Workflow
```bash
/workflow:start feature "Add user authentication"
/workflow:start bugfix "Fix login validation"
/workflow:start refactor "Extract payment service"
```

### Check Status
```bash
/workflow:status                # Current workflow status
/workflow:status --all          # All active workflows
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

## Features

- Org-mode based state tracking
- Subagent orchestration
- Progress persistence
- Error recovery
- Branch management

## Workflow Best Practices

1. **Explore-Plan-Code Pattern**: Understand codebase before changes
2. **Incremental Progress**: Complete one unit, validate, proceed
3. **State Persistence**: Org file is the source of truth
4. **Error Recovery**: Log errors, offer recovery options

## Requirements

- Claude Code with Task tool access
- Git repository

## License

MIT
