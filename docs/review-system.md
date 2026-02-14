# Review System

The review system enforces a zero-issue-tolerance policy with structured tracking to ensure nothing slips through.

## Zero Tolerance Policy

**ALL modes enforce:**
- NO skipping quality gates
- NO advisory-only reviews (everything blocks)
- NO partial completion
- NO scope reduction to pass tests
- MANDATORY completion guard approval

## Strict Verdicts

PASS requires **zero issues** at any severity level (CRITICAL, MAJOR, MINOR). There are no exceptions, thresholds, or "good enough" verdicts.

Non-blocking suggestions are reported as **IMPROVEMENTS** and do not affect the verdict.

### Verdict Rules (All Reviewer Tiers)

```
- PASS: ZERO issues at any severity (CRITICAL, MAJOR, MINOR)
- FAIL: ANY issue at any severity level
- IMPROVEMENTS: Non-blocking suggestions (do not affect verdict)
- If ANY issue exists at any severity level, verdict MUST be FAIL
```

## Structured Issue Tracking

Every issue gets a unique sequential ID for tracking across review iterations:

```
VERDICT: FAIL

ISSUES:
- [ISSUE-1] [CRITICAL] SQL injection in user input - src/auth.php:42 - use parameterized query
- [ISSUE-2] [MAJOR] Missing null check - src/service.ts:18 - add guard clause
- [ISSUE-3] [MINOR] Inconsistent naming - src/helper.ts:7 - rename to camelCase

TOTAL: 3 issues (1 CRITICAL, 1 MAJOR, 1 MINOR)
ALL issues must be resolved before PASS.

IMPROVEMENTS (non-blocking, does not affect verdict):
- Consider extracting validation to a shared helper
```

Each issue includes:
- **Unique ID** (`[ISSUE-N]`) for tracking across iterations
- **Severity** (`CRITICAL`, `MAJOR`, `MINOR`)
- **Description** of the problem
- **Location** (`file:line`)
- **Suggested fix**

## Issue Verification on Re-review

When a reviewer runs on iteration > 1, it receives the previous issue list and must explicitly verify each one:

```
## Previous Issue Verification

[ISSUE-1] ✓ RESOLVED - parameterized query now used
[ISSUE-2] ✗ NOT RESOLVED - null check still missing
[ISSUE-3] ⚠ REGRESSED - renamed but introduced typo in import

## New Issues
[ISSUE-4] [MINOR] unused import left behind - src/helper.ts:1
```

**Re-review rules:**
- PASS only if ALL previous issues are resolved AND zero new issues found
- New issues get IDs starting from the previous max + 1
- `⚠ REGRESSED` means the fix itself introduced a new problem

## Structured Executor Fix Protocol

When an executor receives review issues, it must address every one by ID:

```
## Fix Report

[ISSUE-1] FIXED: replaced string concatenation with parameterized query in auth.php:42
[ISSUE-2] FIXED: added null guard clause with early return in service.ts:18
[ISSUE-3] DISPUTE: naming follows project convention per codebase context (uses snake_case for variables)
```

**Fix protocol rules:**
1. Address EVERY issue by ID - no exceptions
2. For each issue: read the file, understand root cause, apply fix, self-verify
3. `FIXED` - describe what was changed and why
4. `DISPUTE` - provide detailed justification why this is not an issue (reviewer evaluates on re-review)
5. **Skipping an issue ID is not allowed**

## Auto-Escalation

If the review loop exhausts its configured max iterations without passing:

1. **Auto-escalate to opus** for both the reviewer and executor
2. Grant **2 additional iterations** at the opus tier
3. If still failing after escalation, **pause workflow** for manual intervention

```
iteration 1: reviewer (sonnet) -> FAIL
iteration 2: executor fixes -> reviewer (sonnet) -> FAIL
iteration 3: executor fixes -> reviewer (sonnet) -> FAIL  [max reached]
--- AUTO-ESCALATION ---
iteration 4: executor (opus) fixes -> reviewer-deep (opus) -> FAIL
iteration 5: executor (opus) fixes -> reviewer-deep (opus) -> PASS ✓
```

This ensures that issues solvable by a more capable model don't block the workflow unnecessarily.

## Post-Quality-Gate Review

When the quality gate auto-fixes code (lint errors, type errors, etc.), a targeted review runs on only the changed files:

1. Quality gate reports `CHANGES_MADE: true` with a list of changed files
2. A `reviewer-lite` runs on **only** those files
3. Focus: Did the auto-fixes introduce bugs, break patterns, or deviate from conventions?
4. Max 2 iterations for this targeted review loop

If no code changes were made by the quality gate, this step is skipped.

## Codebase-Aware Reviews

All reviewers read the project's codebase context file (`~/.claude/workflows/context/<project>.md`) to check implementations against:

- Established naming conventions
- Architectural patterns
- Error handling styles
- Framework-specific best practices
- SOLID principles compliance

Standard (`reviewer`) and deep (`reviewer-deep`) tiers can optionally load framework-specific skills (e.g., `laravel-conventions`, `vue-conventions`) for deeper best-practice enforcement.

## Completion Guard Code Quality Spot-Check

The completion guard performs a final code quality spot-check on changed files:

1. **Naming Conventions** - Variables, functions, classes follow project conventions
2. **Anti-Pattern Detection** - No obvious anti-patterns for the detected framework
3. **Error Handling** - Follows project error handling patterns
4. **Code Duplication** - No significant duplication with existing codebase
5. **Function Size** - Functions/methods are reasonably sized (<30 lines)

Any violation = FAIL with specific file:line references.

## Review Iteration Limits by Mode

| Mode | Code Review | Security | Auto-Escalation |
|------|------------|----------|-----------------|
| eco | max 2 | max 1 | Yes |
| turbo | max 2 | max 1 | Yes |
| standard | max 3 | max 2 | Yes |
| thorough | max 3 | max 2 | Already uses opus |
| swarm | 3-architect | 3-architect | N/A |

## Quality Gate Pipeline

```
Implementation Complete -> Code Review PASS
        |
   QUALITY GATE (MANDATORY)
   Build -> Type -> Lint -> Test -> Security
        | FAIL: Auto-fix loop (max 3)
        | PASS
   POST-QUALITY-GATE REVIEW
   (if quality gate made code changes)
        | PASS (or no changes made)
   COMPLETION GUARD (MANDATORY)
   Requirements + Code quality spot-check
        | APPROVED
   COMPLETE
```
