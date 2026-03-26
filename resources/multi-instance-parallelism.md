# Multi-Instance Parallelism Guide

This guide explains how to run multiple Claude Code sessions in parallel for maximum throughput on large projects.

## Parallelism Levels

| Level | Method | Throughput | Coordination |
|-------|--------|------------|--------------|
| **Instance** | Git worktrees | Highest | Manual |
| **Session** | `/fork` command | High | Automatic |
| **Agent** | Swarm mode | Medium | Automatic |

## Git Worktrees (Instance-Level)

Git worktrees allow multiple checkouts of the same repository, enabling completely isolated parallel development.

### When to Use Worktrees

- Large features that can be split into independent parts
- Multiple developers/instances working simultaneously
- Context window is filling up in a single session
- Need true isolation (no file conflicts)

### Setup

```bash
# From your main project directory
cd ~/projects/myapp

# Create worktrees for parallel features
git worktree add ../myapp-feature-auth feature/auth
git worktree add ../myapp-feature-api feature/api
git worktree add ../myapp-feature-ui feature/ui

# List active worktrees
git worktree list
```

### Running Parallel Workflows

**Terminal 1 (Auth Feature):**
```bash
cd ~/projects/myapp-feature-auth
claude
# Then: /workflow:start feature "Add user authentication"
```

**Terminal 2 (API Feature):**
```bash
cd ~/projects/myapp-feature-api
claude
# Then: /workflow:start feature "Build REST API endpoints"
```

**Terminal 3 (UI Feature):**
```bash
cd ~/projects/myapp-feature-ui
claude
# Then: /workflow:start feature "Create dashboard components"
```

### Merging Back

```bash
# After features complete, merge from main repo
cd ~/projects/myapp

git checkout main
git merge feature/auth
git merge feature/api
git merge feature/ui

# Clean up worktrees
git worktree remove ../myapp-feature-auth
git worktree remove ../myapp-feature-api
git worktree remove ../myapp-feature-ui
```

## The Cascade Method

Organize multiple terminals for optimal workflow:

```
┌─────────────────────────────────────────────────────────────────┐
│                    TERMINAL LAYOUT                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Terminal 1        Terminal 2        Terminal 3        Terminal 4
│  (oldest)                                              (newest) │
│     ↓                  ↓                 ↓                ↓     │
│  Feature A         Feature B         Feature C        Research  │
│  [CODE CHANGES]    [CODE CHANGES]    [CODE CHANGES]   [READ ONLY]
│                                                                 │
│  Progress flows left → right                                    │
│  Newest tasks on the right                                      │
│  Max 3-4 concurrent code-changing sessions                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Rules

1. **Work left-to-right** - Oldest tasks on left, newest on right
2. **Max 3-4 code sessions** - More becomes hard to coordinate
3. **Dedicated research session** - One session for exploration (no code changes)
4. **Label everything** - Use `/rename` to name each session

### Session Types

| Session Type | Purpose | Code Changes |
|--------------|---------|--------------|
| **Implementation** | Writing features | Yes |
| **Research** | Exploring codebase, reading docs | No |
| **Review** | Code review, testing | Minimal |

## Fork Command (Session-Level)

Use `/fork` for branching within a single Claude Code instance:

```bash
# In main session, fork for parallel research
/fork

# Fork inherits context but runs independently
# Good for: questions, exploration, experiments
```

### When to Fork vs Worktree

| Scenario | Use Fork | Use Worktree |
|----------|----------|--------------|
| Quick question about codebase | ✅ | |
| Research external API | ✅ | |
| Parallel feature development | | ✅ |
| Different git branches | | ✅ |
| Shared context needed | ✅ | |
| Complete isolation needed | | ✅ |

## Combining with Swarm Mode

For maximum parallelism, combine all levels:

```
┌─────────────────────────────────────────────────────────────────┐
│              MAXIMUM PARALLELISM ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  INSTANCE LEVEL (Git Worktrees)                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Worktree 1  │  │ Worktree 2  │  │ Worktree 3  │             │
│  │ feature/auth│  │ feature/api │  │ feature/ui  │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│  SESSION LEVEL (Claude Code instances)                          │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ /workflow:  │  │ /workflow:  │  │ /workflow:  │             │
│  │ start --mode│  │ start --mode│  │ start --mode│             │
│  │ =swarm      │  │ =swarm      │  │ =standard   │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│  AGENT LEVEL (Swarm mode in each session)                       │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ 4 parallel  │  │ 4 parallel  │  │ sequential  │             │
│  │ executors   │  │ executors   │  │ execution   │             │
│  │ 3 architects│  │ 3 architects│  │             │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  Total: 3 worktrees × (4 executors + 3 architects) = massive    │
│         parallel capacity                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Coordination Strategies

### Memory Sharing

Project memory is stored per-project, so all worktrees share learnings:

```
~/.claude-workflows/memory/myapp.md  ← Shared by all worktrees
```

This means:
- Patterns discovered in worktree 1 are available in worktree 2
- Key decisions are consistent across sessions
- No duplicate learning needed

### Avoiding Conflicts

1. **Plan the split first** - Decide which features go to which worktree
2. **Interface-first** - Define interfaces before parallel implementation
3. **No shared files** - Each worktree works on different files
4. **Merge frequently** - Don't let branches diverge too far

### Communication Between Sessions

If sessions need to coordinate:

```bash
# Session 1: Write a note
echo "Auth API ready at /api/auth/*" >> ~/.claude-workflows/notes/myapp.md

# Session 2: Check for notes
cat ~/.claude-workflows/notes/myapp.md
```

## Quick Reference

### Start Parallel Development

```bash
# 1. Create worktrees
git worktree add ../myapp-auth feature/auth
git worktree add ../myapp-api feature/api

# 2. Open terminals and start workflows
# Terminal 1:
cd ../myapp-auth && claude
# /workflow:start feature swarm: "Implement authentication"

# Terminal 2:
cd ../myapp-api && claude
# /workflow:start feature swarm: "Implement API endpoints"
```

### Monitor Progress

```bash
# Check all worktrees
git worktree list

# Check workflow status in each
# (run in each terminal)
/workflow:status
```

### Finish and Merge

```bash
# In main repo
cd ~/projects/myapp
git checkout main

# Merge completed features
git merge feature/auth
git merge feature/api

# Clean up
git worktree remove ../myapp-auth
git worktree remove ../myapp-api
git branch -d feature/auth feature/api
```

## Best Practices

1. **Start small** - Begin with 2 worktrees, scale up as needed
2. **Clear boundaries** - Define exactly what each worktree handles
3. **Shared nothing** - Avoid touching the same files in parallel
4. **Merge often** - Don't let branches diverge for too long
5. **Use swarm selectively** - Not every worktree needs swarm mode
6. **Monitor resources** - Multiple Claude instances use more API quota

## Scaling Guidelines

| Project Size | Recommended Parallelism |
|--------------|------------------------|
| Small (< 10 files) | Single session, standard mode |
| Medium (10-50 files) | Single session, swarm mode |
| Large (50-200 files) | 2-3 worktrees, swarm mode |
| Very Large (200+ files) | 3-4 worktrees, swarm mode |

## Troubleshooting

### Worktree Conflicts

```bash
# If worktree is locked
git worktree unlock ../myapp-feature

# If worktree is corrupted
git worktree remove --force ../myapp-feature
git worktree add ../myapp-feature feature-branch
```

### Memory Not Shared

Ensure all worktrees use the same project slug:
```bash
# Check project name
basename "$(git rev-parse --show-toplevel)"
```

### Context Window Full

If a session's context fills up:
1. Complete current task
2. Save learnings: `/workflow:learn`
3. Start fresh session or fork
