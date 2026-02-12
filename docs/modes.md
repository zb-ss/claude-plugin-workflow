# Execution Modes

The workflow plugin supports 5 execution modes. Modes control agent selection, model tier, review depth, and parallelism.

## Mode Overview

| Mode | Description | Primary Model | Code Review | Security |
|------|-------------|---------------|-------------|----------|
| `standard` | Balanced (default) | sonnet | max 3 iterations | max 2 iterations |
| `turbo` | Maximum speed | haiku | max 2 iterations | max 1 iteration |
| `eco` | Token-efficient | haiku | max 2 iterations | max 1 iteration |
| `thorough` | Maximum quality | opus (reviews) | max 3 iterations | max 2 iterations |
| `swarm` | Maximum parallelism | opus (validation) | 3-architect competitive | 3-architect competitive |

All modes enforce **mandatory blocking reviews**. No advisory-only mode exists.

## Auto Mode Detection

The plugin auto-selects the best mode based on task analysis when no `--mode` flag is provided.

| Task Type | Auto-Selected Mode |
|-----------|-------------------|
| Auth, security, payment | **thorough** |
| Database migrations | **thorough** |
| New features | **standard** |
| Bug fixes | **standard** |
| Typos, docs, config | **eco** |
| Prototypes (with `quick:`) | **turbo** |

**Keyword triggers** (prefix your task):
- `thorough:`, `careful:`, `production:` -> thorough mode
- `quick:`, `fast:`, `prototype:` -> turbo mode
- `eco:`, `simple:`, `minor:` -> eco mode
- `swarm:`, `parallel:`, `multiagent:` -> swarm mode

Override with `--mode=<mode>` flag (always wins over auto-detection).

## Standard Mode

Balanced approach with good quality and reasonable speed. Default for most tasks.

**Agent routing:**

| Phase | Agent | Model |
|-------|-------|-------|
| Codebase Analysis | codebase-analyzer | sonnet |
| Planning | Plan (built-in) | sonnet |
| Implementation | executor | sonnet |
| Code Review | reviewer | sonnet |
| Security | security | sonnet |
| Tests | test-writer | sonnet |

**Pipeline:**

```
Codebase Analysis
     |
Planning
     |
Implementation
     |
Code Review (max 3) -> FAIL -> Structured fix by ID -> Re-review
     | PASS              (auto-escalate to opus if exhausted)
Security Review (max 2) -> FAIL -> Fix -> Retry
     | PASS
QUALITY GATE -> Auto-fix loop (max 3)
     | PASS
POST-QG REVIEW (if QG changed files)
     | PASS
COMPLETION GUARD -> Architect sign-off + code quality spot-check
     | APPROVED
COMPLETE
```

## Turbo Mode

Maximum speed using haiku models and parallel execution. Best for experienced developers who will review output themselves.

**Agent routing:**

| Phase | Agent | Model |
|-------|-------|-------|
| Codebase Analysis | codebase-analyzer | sonnet (cached) |
| Planning | architect-lite | haiku |
| Implementation | executor-lite | haiku |
| Code Review | reviewer-lite | haiku |
| Security | security-lite | haiku |

**Pipeline:**

```
Implementation
     |
Quick Review (max 2) -> FAIL -> Fix -> Retry
     | PASS
Quick Security (max 1) -> FAIL -> Fix -> Retry
     | PASS
QUALITY GATE (abbreviated)
     |
COMPLETION GUARD (quick check)
     |
COMPLETE
```

Reviews are blocking (must pass) but use lite agents for speed.

## Eco Mode

Token-efficient with haiku-first approach. Best for budget-conscious usage or simple, well-defined tasks.

**Agent routing:**

| Phase | Agent | Model |
|-------|-------|-------|
| Codebase Analysis | SKIP | - |
| Planning | architect-lite | haiku |
| Implementation | executor-lite | haiku |
| Code Review | reviewer-lite | haiku |
| Security | security-lite | haiku |

**Pipeline:**

```
Implementation
     |
Code Review (max 2) -> FAIL -> Fix -> Retry
     | PASS
Security Review (max 1) -> FAIL -> Fix -> Retry
     | PASS
QUALITY GATE (build + lint only)
     |
COMPLETION GUARD
     |
COMPLETE
```

**Limitations:** May miss edge cases. Limited security coverage. No deep analysis.

## Thorough Mode

Maximum quality for security-sensitive or production-critical code.

**Agent routing:**

| Phase | Agent | Model |
|-------|-------|-------|
| Codebase Analysis | codebase-analyzer | sonnet |
| Planning | architect | opus |
| Implementation | executor | sonnet |
| Code Review | reviewer-deep | opus |
| Security | security-deep | opus |
| Tests | test-writer | sonnet |
| Performance | perf-reviewer | sonnet |
| Documentation | doc-writer | haiku |

**Pipeline:**

```
Codebase Analysis (fresh)
     |
Planning (architect/opus)
     |
Implementation
     |
Code Review (opus, max 3) -> FAIL -> Fix -> Retry
     | PASS
Security Review (opus, max 2) -> FAIL -> Fix -> Retry
     | PASS
Test Coverage (80% min) -> FAIL -> Add tests -> Retry
     | PASS
QUALITY GATE (full) -> FAIL -> Auto-fix -> Retry (max 3)
     | PASS
COMPLETION GUARD (opus) -> Full verification
     | APPROVED
[Advisory] Performance Review
     |
[Advisory] Documentation Check
     |
COMPLETE
```

## Swarm Mode

See [Swarm Mode](swarm-mode.md) for the full guide.

## Mode Selection Guide

| Scenario | Recommended Mode |
|----------|------------------|
| Quick prototype | turbo |
| Simple bug fix | eco |
| Regular feature | standard |
| Large multi-file feature | swarm |
| Multi-service implementation | swarm |
| Security-sensitive | thorough |
| Production release | thorough |
| Budget-conscious | eco |

## Switching Modes Mid-Workflow

```bash
/workflow:mode thorough   # Switch to thorough for remaining steps
/workflow:mode eco        # Switch to eco to save tokens
```
