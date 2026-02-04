# Bugfix: {{TITLE}}

**Workflow ID:** {{WORKFLOW_ID}}
**Type:** bugfix
**Date:** {{DATE}}
**Branch:** {{BRANCH}}
**Mode:** {{MODE}}
**Status:** active

---

## Overview

### Description
{{DESCRIPTION}}

### Branch Info
- **Fix Branch:** {{BRANCH}}
- **Base Branch:** {{BASE_BRANCH}}

---

## Workflow Steps

### Step 0: Investigation
**Agent:** Plan
**Status:** pending
**Started:**
**Completed:**

#### Objectives
- [ ] Understand the reported bug/issue
- [ ] Identify reproduction steps
- [ ] Locate the root cause
- [ ] Identify affected files
- [ ] Assess impact and scope

#### Investigation Notes

```markdown
# Bug Investigation

## Reported Issue

## Reproduction Steps
1.
2.
3.

## Root Cause Analysis

## Affected Files

## Proposed Fix
```

---

### Step 1: Implementation
**Agent:** focused-build
**Status:** pending
**Started:**
**Completed:**
**Depends On:** Step 0

#### Objectives
- [ ] Implement the fix
- [ ] No regression introduced
- [ ] Code compiles/runs

#### Changed Files
| File | Action | Description |
|------|--------|-------------|
|      |        |             |

---

### Step 2: Code Review
**Agent:** review
**Status:** pending
**Iteration:** 0/2
**Started:**
**Completed:**
**Depends On:** Step 1

#### Review Criteria
- [ ] Fix addresses the root cause
- [ ] No side effects introduced
- [ ] Code quality maintained
- [ ] Edge cases covered

#### Review Log
| Iteration | Verdict | Issues Found | Fixed |
|-----------|---------|--------------|-------|
| 1         |         |              |       |
| 2         |         |              |       |

---

### Step 3: Quality Gate
**Agent:** quality-gate
**Status:** pending
**Started:**
**Completed:**
**Depends On:** Step 2

#### Checks
- [ ] Build passes
- [ ] Tests pass
- [ ] Regression tests pass

---

### Step 4: Completion Guard
**Agent:** completion-guard
**Status:** pending
**Started:**
**Completed:**
**Depends On:** Step 3

#### Final Verification
- [ ] Bug is fixed
- [ ] No new bugs introduced
- [ ] Ready for commit

---

## Completion Summary

**Completed At:**
**Total Duration:**

### Files Changed
| File | Lines Added | Lines Removed |
|------|-------------|---------------|
|      |             |               |

### Commit Message
```
fix: (Suggested commit message)
```

---

## Intervention Log
| Timestamp | Phase | User Instruction | Action Taken |
|-----------|-------|------------------|--------------|
|           |       |                  |              |

<!-- MANUAL: User notes below this line are preserved on regeneration -->

