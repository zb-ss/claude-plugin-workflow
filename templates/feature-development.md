# Feature: {{TITLE}}

**Workflow ID:** {{WORKFLOW_ID}}
**Type:** feature
**Date:** {{DATE}}
**Branch:** {{BRANCH}}
**Mode:** {{MODE}}
**Status:** active

---

## Overview

### Description
{{DESCRIPTION}}

### Branch Info
- **Feature Branch:** {{BRANCH}}
- **Base Branch:** {{BASE_BRANCH}}

---

## Workflow Steps

### Step 0: Planning
**Agent:** Plan
**Status:** pending
**Started:**
**Completed:**

#### Objectives
- [ ] Identify language/framework in use
- [ ] Explore codebase for existing patterns and architecture
- [ ] Verify architecture aligns with best practices
- [ ] Identify all files to create/modify
- [ ] Document dependencies and prerequisites
- [ ] Create detailed implementation steps
- [ ] Identify potential risks and edge cases

#### Plan

```markdown
# Implementation Plan

(Planning agent will write the detailed plan here)

## Technology Stack
- Language:
- Framework:
- Frontend:
- Database:

## Files to Modify

## Files to Create

## Implementation Steps

## Testing Strategy

## Risks and Considerations
```

---

### Step 1: Implementation
**Agent:** focused-build
**Status:** pending
**Started:**
**Completed:**
**Depends On:** Step 0

#### Objectives
- [ ] Implement all planned changes
- [ ] Follow existing code patterns
- [ ] No syntax errors
- [ ] Code compiles/runs

#### Changed Files
| File | Action | Description |
|------|--------|-------------|
|      |        |             |

---

### Step 2: Code Review
**Agent:** review
**Status:** pending
**Iteration:** 0/3
**Started:**
**Completed:**
**Depends On:** Step 1

#### Review Criteria
- [ ] Implementation matches plan
- [ ] Code quality and readability
- [ ] Error handling is appropriate
- [ ] Edge cases covered
- [ ] Follows project conventions

#### Review Log
| Iteration | Verdict | Issues Found | Fixed |
|-----------|---------|--------------|-------|
| 1         |         |              |       |
| 2         |         |              |       |
| 3         |         |              |       |

#### Current Feedback

```markdown
(Review feedback will be written here)
```

---

### Step 3: Security Audit
**Agent:** security-auditor
**Status:** pending
**Iteration:** 0/2
**Started:**
**Completed:**
**Depends On:** Step 2

#### Security Checklist
- [ ] No injection vulnerabilities (SQL, command, XSS)
- [ ] Input validation present
- [ ] Authentication/authorization correct
- [ ] Sensitive data protected
- [ ] No hardcoded secrets
- [ ] Dependencies secure

#### Security Findings
| Severity | Issue | File:Line | Remediation | Fixed |
|----------|-------|-----------|-------------|-------|
|          |       |           |             |       |

---

### Step 4: Quality Gate
**Agent:** quality-gate
**Status:** pending
**Started:**
**Completed:**
**Depends On:** Step 3

#### Checks
- [ ] Build passes
- [ ] Type check passes
- [ ] Lint passes
- [ ] Tests pass
- [ ] Security scan passes

---

### Step 5: Completion Guard
**Agent:** completion-guard
**Status:** pending
**Started:**
**Completed:**
**Depends On:** Step 4

#### Final Verification
- [ ] All requirements implemented
- [ ] No incomplete code markers (TODO, FIXME)
- [ ] All quality gates passed
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
(Suggested commit message)
```

---

## Intervention Log
| Timestamp | Phase | User Instruction | Action Taken |
|-----------|-------|------------------|--------------|
|           |       |                  |              |

<!-- MANUAL: User notes below this line are preserved on regeneration -->

