# Mode Routing Guide

This document explains how agents are selected based on execution mode.

## Mode Overview

| Mode | Primary Model | Review Depth | Token Usage | Use Case |
|------|---------------|--------------|-------------|----------|
| standard | sonnet | Balanced | Medium | Default, most tasks |
| turbo | haiku | Advisory | Low | Speed-critical |
| eco | haiku | Minimal | Very Low | Budget-conscious |
| thorough | opus (reviews) | Multi-gate | High | Critical code |

## Agent Routing Matrix

### Codebase Analysis Phase (Step 0)

| Mode | Agent | Model | Behavior |
|------|-------|-------|----------|
| standard | codebase-analyzer | sonnet | Generate if missing or stale (>7 days) |
| turbo | codebase-analyzer | sonnet | Use cache if available, else generate |
| eco | SKIP | - | Use existing context only, never generate |
| thorough | codebase-analyzer | sonnet | Always regenerate fresh |

Context file: `~/.claude/workflows/context/<project-slug>.md`

### Planning Phase

| Mode | Agent | Model | Depth |
|------|-------|-------|-------|
| standard | Plan (built-in) | sonnet | Full planning |
| turbo | architect-lite | haiku | Quick analysis |
| eco | architect-lite | haiku | Minimal planning |
| thorough | architect | opus | Deep analysis |

### Implementation Phase

| Mode | Agent | Model | Approach |
|------|-------|-------|----------|
| standard | focused-build (built-in) | sonnet | Balanced |
| turbo | executor-lite | haiku | Fast, direct |
| eco | executor-lite | haiku | Minimal |
| thorough | executor | sonnet | Careful |

### Code Review Phase

| Mode | Agent | Model | Iterations | Blocking |
|------|-------|-------|------------|----------|
| standard | reviewer | sonnet | Max 2 | Yes |
| turbo | reviewer-lite | haiku | 1 | No (advisory) |
| eco | reviewer-lite | haiku | 1 | Yes |
| thorough | reviewer-deep | opus | Max 3 | Yes |

### Security Review Phase

| Mode | Agent | Model | Iterations | Blocking |
|------|-------|-------|------------|----------|
| standard | security | sonnet | Max 1 | Yes |
| turbo | security-lite | haiku | 0 | No (advisory) |
| eco | security-lite | haiku | 0 | No |
| thorough | security-deep | opus | Max 2 | Yes |

### Test Phase

| Mode | Agent | Model | Required | Coverage |
|------|-------|-------|----------|----------|
| standard | test-writer | sonnet | Optional | - |
| turbo | - | - | No | - |
| eco | - | - | No | - |
| thorough | test-writer | sonnet | Yes | 80% min |

### Performance Review Phase

| Mode | Agent | Model | Blocking |
|------|-------|-------|----------|
| standard | - | - | Skipped |
| turbo | - | - | Skipped |
| eco | - | - | Skipped |
| thorough | perf-reviewer | sonnet | No (advisory) |

### Documentation Phase

| Mode | Agent | Model | Blocking |
|------|-------|-------|----------|
| standard | - | - | Skipped |
| turbo | - | - | Skipped |
| eco | - | - | Skipped |
| thorough | doc-writer | haiku | No (advisory) |

### Quality Gate Phase (MANDATORY)

| Mode | Agent | Model | Checks | Blocking |
|------|-------|-------|--------|----------|
| standard | quality-gate | sonnet | Full (build, type, lint, test, security) | **YES** |
| turbo | quality-gate | haiku | Abbreviated (build, lint) | **YES** |
| eco | quality-gate | haiku | Minimal (build, lint) | **YES** |
| thorough | quality-gate | sonnet | Full + coverage check | **YES** |

### Completion Guard Phase (MANDATORY)

| Mode | Agent | Model | Verification | Blocking |
|------|-------|-------|--------------|----------|
| standard | completion-guard | sonnet | Requirements + Build + Tests + TODOs | **YES** |
| turbo | completion-guard | haiku | Quick check (build + tests) | **YES** |
| eco | completion-guard | haiku | Minimal (build + TODOs) | **YES** |
| thorough | completion-guard | opus | Full verification (all checks) | **YES** |

## Review Chain by Mode - MANDATORY GATES

**CRITICAL:** All modes now have mandatory quality gates. NO reviews can be skipped.

### Standard Mode
```
Codebase Analysis
     ↓
Planning
     ↓
Implementation
     ↓
Code Review (max 2) ──────────┐
     ↓ PASS                   │ FAIL → Fix → Retry
Security Review (max 1) ──────┘
     ↓ PASS
QUALITY GATE (MANDATORY) ─────┐
     ↓ PASS                   │ FAIL → Auto-fix → Retry (max 3)
COMPLETION GUARD (MANDATORY) ─┘
     ↓ APPROVED
Complete
```

### Turbo Mode
```
Codebase Analysis (cached)
     ↓
Planning (quick)
     ↓
Implementation
     ↓
Code Review (1 iter) ─────────┐
Security Review (1 iter) ─────┤ Run in parallel, but BLOCKING
     ↓ BOTH PASS              │ FAIL → Fix → Retry
QUALITY GATE (abbreviated) ───┘
     ↓ PASS
COMPLETION GUARD (quick) ─────
     ↓ APPROVED
Complete
```
(Reviews run in parallel but are still BLOCKING - not advisory)

### Eco Mode
```
[Use existing context]
     ↓
Planning (minimal)
     ↓
Implementation
     ↓
Code Review (max 1) ──────────┐
Security Review (1 iter) ─────┤ BLOCKING
     ↓ PASS                   │ FAIL → Fix → Retry
QUALITY GATE (build+lint) ────┘
     ↓ PASS
COMPLETION GUARD (MANDATORY) ─
     ↓ APPROVED
Complete
```

### Thorough Mode
```
Codebase Analysis (fresh)
     ↓
Planning (architect/opus)
     ↓
Implementation
     ↓
Code Review (max 3) ──────────┐
     ↓ PASS                   │ FAIL → Fix → Retry
Security Review (max 2) ──────┤
     ↓ PASS                   │ FAIL → Fix → Retry
Test Coverage (80%) ──────────┘
     ↓ PASS                   │ FAIL → Add tests → Retry
QUALITY GATE (FULL) ──────────┐
     ↓ PASS                   │ FAIL → Auto-fix → Retry (max 3)
COMPLETION GUARD (opus) ──────┘
     ↓ APPROVED
[Advisory] Performance Review
     ↓
[Advisory] Documentation Check
     ↓
Complete
```

## Zero Tolerance Policy

**All modes enforce:**
- NO skipping quality gates
- NO advisory-only reviews (everything blocks)
- NO partial completion
- NO scope reduction to pass
- MANDATORY completion guard approval

## Model Selection Rationale

### Haiku (Fast, Cheap)
- Pattern matching tasks
- Simple code changes
- Quick reviews
- Advisory checks

### Sonnet (Balanced)
- Standard implementations
- Standard reviews
- Test writing
- Performance analysis

### Opus (Deep, Expensive)
- Complex planning
- Deep code review
- Security audits
- Subtle issue detection

## Switching Modes

Users can switch modes mid-workflow using:

```bash
/workflow:mode <mode>
```

The new mode applies to remaining phases only. Completed phases are not re-run.

## Cost Estimation

Approximate relative token costs:

| Mode | Planning | Implementation | Review | Total Multiplier |
|------|----------|----------------|--------|------------------|
| eco | 1x | 1x | 0.5x | ~0.5x |
| turbo | 0.5x | 1x | 0.5x | ~0.7x |
| standard | 1.5x | 1x | 1.5x | 1x (baseline) |
| thorough | 3x | 1.5x | 5x | ~3x |

## Best Practices

1. **Start with standard** - Switch if needed
2. **Use eco for simple fixes** - Single file, clear scope
3. **Use turbo for prototypes** - Plan to review manually
4. **Use thorough for production** - Security-sensitive code
5. **Switch modes as needed** - Don't commit to wrong mode early
