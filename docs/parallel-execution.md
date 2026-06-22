# Parallel Execution

## Agent-Level (Within Session)

| Workflow | Parallel Behavior |
|----------|-------------------|
| swarm | Up to 4 executors per batch, N-lens fan-out review gate runs in parallel (loop-until-dry + adversarial verification + zero-tolerance routing) |
| epic | Up to 4 component worktrees in parallel per wave; each component runs its own swarm-style pipeline |

## Instance-Level (Multiple Sessions)

For maximum throughput, use **git worktrees** to run multiple Claude Code sessions in parallel. Epic mode manages worktrees automatically — this section is for manual parallelism when running multiple swarm workflows side-by-side:

```bash
# Create isolated worktrees for parallel independent workstreams
git worktree add ../myapp-auth feature/auth
git worktree add ../myapp-api feature/api

# Terminal 1: Auth workstream
cd ../myapp-auth && claude
# /workflow:start swarm: "Implement authentication"

# Terminal 2: API workstream
cd ../myapp-api && claude
# /workflow:start swarm: "Implement API endpoints"
```

State files are repo-scoped (`~/.claude-workflows/active/<repo-key>/`) so each worktree's workflows do not collide.

## The Cascade Method

Organize terminals left-to-right:
- Oldest tasks on left, newest on right
- Max 3-4 concurrent code-changing sessions
- One dedicated research/exploration session (read-only)

## Parallelism Levels

| Level | Method | Use Case |
|-------|--------|----------|
| Agent | Swarm executor batches | Parallel subtasks within one feature |
| Component | Epic worktrees | Independent components, full isolation per component |
| Instance | Manual git worktrees | Side-by-side swarm runs on different features |

## Combined Approach

For very large projects combining manual instance parallelism with swarm:

```
3 manual worktrees x swarm mode (4 executors each) = 12 parallel executors
```

See `resources/multi-instance-parallelism.md` for the full guide.
