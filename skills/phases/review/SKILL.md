---
description: Review phase procedures - verdict rules, issue format, re-review protocol, zero-tolerance policy
disable-model-invocation: true
---

# Review Phase Instructions

You are executing a **review phase** (code review or security review). Apply zero-tolerance quality standards.

## Zero-Tolerance Policy

- **PASS** requires: Zero issues at ANY severity (CRITICAL, MAJOR, MINOR)
- **FAIL**: ANY issue at any severity level
- No thresholds, no exceptions, no "good enough"
- Never reduce scope to make code pass
- Never suggest deleting tests or commenting out code

## Verdict Format

Your output MUST include a structured verdict:

```
VERDICT: PASS

No issues found. Code meets all quality standards.
```

OR:

```
VERDICT: FAIL

ISSUES:
- [ISSUE-1] [CRITICAL] SQL injection in user input - src/auth.php:42
  Description: User input concatenated directly into SQL query
  Fix: Use parameterized query with PDO::prepare()
  
- [ISSUE-2] [MAJOR] Missing null check - src/service.ts:18
  Description: Method assumes non-null but caller can pass null
  Fix: Add guard clause at method entry

- [ISSUE-3] [MINOR] Inconsistent naming - src/helper.ts:7
  Description: Method uses camelCase but project convention is snake_case
  Fix: Rename to match convention

TOTAL: 3 issues (1 CRITICAL, 1 MAJOR, 1 MINOR)
```

## Issue Severity Levels

- **CRITICAL**: Security vulnerabilities, data loss risks, crashes in production
- **MAJOR**: Logic errors, missing validation, broken functionality, poor error handling
- **MINOR**: Naming inconsistencies, style violations, missing docs for complex code

## Re-Review Protocol

When reviewing code that was previously reviewed (iteration > 1):

1. **Verify previous fixes**: Check each previously reported issue
2. **Report verification**:
   ```
   [ISSUE-1] RESOLVED - parameterized query now used
   [ISSUE-2] NOT RESOLVED - null check still missing
   [ISSUE-3] REGRESSED - renamed but introduced typo in import
   ```
3. **Check for new issues** introduced by the fixes
4. **Evaluate disputes**: If the implementer disputed an issue with `DISPUTE:`, evaluate their justification. Accept if valid, re-flag if not.

## Scope

- Review ONLY the files changed in this workflow
- Compare against project conventions from codebase context
- Check for OWASP top 10 in security reviews
- Verify error handling, edge cases, and input validation

## Library & API Verification

When reviewing code that uses external libraries:
- Verify import paths are correct
- Check that API methods being called actually exist in the library version used
- Flag deprecated API usage
- If Context7 MCP is available, use it to verify library API signatures

## Iterate Until Done

Reviews iterate until ALL issues are resolved. There is no "good enough":
- Do not soften your verdict because iterations are high
- Do not skip minor issues to speed up the process
- Every iteration should be as thorough as the first
- If you find new issues introduced by fixes, report them with new ISSUE IDs

## Auto-Escalation

If you are on the final allowed iteration and issues remain, note in your output:
```
ESCALATION RECOMMENDED: Issues remain after max iterations. 
Recommend opus-tier review for remaining issues.
```
