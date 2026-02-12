# Parallel Execution

## Agent-Level (Within Session)

| Mode | Parallel Behavior |
|------|-------------------|
| turbo | Code + Security reviews parallel, multi-file implementation |
| standard | Code + Security reviews parallel on first pass |
| thorough | Performance + Documentation checks parallel |
| eco | Sequential only (minimize tokens) |
| swarm | 4 executors/batch, 3-architect validation, aggressive parallelism |

## Instance-Level (Multiple Sessions)

For maximum throughput on large projects, use **git worktrees** to run multiple Claude Code sessions in parallel:

```bash
# Create isolated worktrees for parallel features
git worktree add ../myapp-auth feature/auth
git worktree add ../myapp-api feature/api

# Terminal 1: Auth feature
cd ../myapp-auth && claude
# /workflow:start feature swarm: "Implement authentication"

# Terminal 2: API feature
cd ../myapp-api && claude
# /workflow:start feature swarm: "Implement API endpoints"
```

## The Cascade Method

Organize terminals left-to-right:
- Oldest tasks on left, newest on right
- Max 3-4 concurrent code-changing sessions
- One dedicated research session (read-only)

## Parallelism Levels

| Level | Method | Use Case |
|-------|--------|----------|
| Agent | Swarm mode | Parallel subtasks within one feature |
| Session | `/fork` | Quick parallel exploration |
| Instance | Git worktrees | Independent features, maximum isolation |

## Combined Approach

For very large projects:

```
3 worktrees x swarm mode (4 executors each) = 12 parallel executors
```

See `resources/multi-instance-parallelism.md` for the full guide.
