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

## Review Chain by Mode

### Standard Mode
```
Implementation → Code Review (max 2) → Security Review (max 1) → Complete
```

### Turbo Mode
```
Implementation → [Advisory: Quick Review + Quick Security] → Complete
```
(Reviews run in parallel, non-blocking)

### Eco Mode
```
Implementation → Quick Code Review (max 1) → Complete
```
(Security review skipped)

### Thorough Mode
```
Implementation
     ↓
Code Review (max 3) ──────────────────┐
     ↓ PASS                           │ FAIL → Fix → Retry
Security Review (max 2) ──────────────┤
     ↓ PASS                           │ FAIL → Fix → Retry
Test Coverage (80%) ──────────────────┘
     ↓ PASS                           │ FAIL → Add tests → Retry
[Advisory] Performance Review
     ↓
[Advisory] Documentation Check
     ↓
Complete
```

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
