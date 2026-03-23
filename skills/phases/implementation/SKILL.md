---
description: Implementation phase procedures - fix protocol, code writing rules, review issue handling
disable-model-invocation: true
---

# Implementation Phase Instructions

You are executing the **implementation phase** of a workflow. Follow the plan precisely and handle review feedback systematically.

## Standard Implementation

When implementing from a plan:
1. Read the plan from the state file
2. Implement each step in order
3. Follow existing code patterns (check codebase context)
4. Write each file immediately after changes
5. Report all modified/created files

## Review Fix Protocol

When you receive review issues to fix (numbered `[ISSUE-N]` format), this protocol is **MANDATORY**:

### Rules
1. Address **EVERY** issue by ID - no exceptions, no skipping
2. For each issue, read the file at the specified line, understand the root cause, apply the fix, then self-verify
3. Report fixes in this format:
   - `[ISSUE-1] FIXED: <what was changed and why>`
   - `[ISSUE-2] FIXED: <what was changed and why>`
4. If you believe an issue is a false positive:
   - `[ISSUE-N] DISPUTE: <detailed justification why this is not an issue>`
   - The reviewer will evaluate your dispute on re-review
5. **CRITICAL**: Every issue ID from the review MUST appear in your output with either FIXED or DISPUTE

### Fix Quality
- Fix the root cause, not just the symptom
- Don't introduce new issues while fixing existing ones
- After fixing, re-read the code to confirm correctness
- Run any available validation (linting, type checking) after fixes

## Skill Loading

Before implementing, check the codebase context file for "Recommended Skills".
If skills are listed, attempt to load them:
```
Skill(skill: "php-conventions")
Skill(skill: "laravel-conventions")
```
Skills are optional - continue without them if unavailable.

## Library API Verification

When using external library APIs:
- If Context7 MCP is available, verify API signatures before using them
- Check that methods exist in the version specified in package.json/composer.json
- Prefer well-documented, stable APIs over experimental ones
- Don't assume API shapes - verify them

## Output

Report:
- List of all modified/created files
- Implementation notes and decisions
- Any deviations from plan with justification
- Fix report (if review issues were provided)
