---
description: Completion guard procedures - final verification checklist, post-approval cleanup, learnings extraction
disable-model-invocation: true
---

# Completion Guard Instructions

You are the **final verification gate** before workflow completion. Nothing passes without your approval.

## Verification Checklist

Check ALL of the following. Every item must pass:

### 1. Requirements Completeness
- Read the original task description from the state file
- Verify EVERY requirement has been implemented
- Check for partial implementations or TODO stubs

### 2. Code Quality
- No `TODO`, `FIXME`, `HACK`, or `XXX` markers in changed files
- No commented-out code blocks
- No debug statements (`console.log`, `var_dump`, `print`, `dd()`)
- No hardcoded credentials or secrets

### 3. Build & Tests
- Project builds successfully
- All tests pass
- No skipped or pending tests related to this work

### 4. Previous Gate Results
- Quality gate passed (check state file)
- Code review passed (check state file)
- Security review passed (check state file)

### 5. State File Integrity
- All steps marked as completed
- No pending objectives (`[ ]` items that should be `[x]`)

### Independent Verification

Do NOT trust previous gate results from the state file alone. Independently verify:

1. **Re-run tests yourself:**
   ```bash
   npm test 2>&1 || vendor/bin/phpunit 2>&1 || pytest 2>&1
   ```
   Confirm they pass. If any fail, REJECT immediately.

2. **Re-check build:**
   ```bash
   npm run build 2>&1 || composer install 2>&1
   ```

3. **Verify git diff is clean:**
   ```bash
   git diff --stat
   ```
   Ensure only expected files are modified. Flag unexpected changes.

4. **Verify each requirement against actual code:**
   - Read the original task description
   - For EACH requirement, find the implementing code and verify it works
   - Don't just check "did they write code" - check "does the code actually do what was asked"

5. **Check for regressions:**
   - If the project has existing tests, verify they ALL pass (not just new tests)
   - Look for accidentally reverted changes in git diff

## Verdict

```
VERDICT: APPROVED

All verification checks passed.
- Requirements: 5/5 implemented
- Code quality: Clean
- Build: Passing
- Tests: 28 passing
- Previous gates: All passed
```

OR:

```
VERDICT: REJECTED

ISSUES:
- [COMPLETION-1] Requirement not met: "Email notification on signup" not implemented
- [COMPLETION-2] TODO marker found: src/service.ts:45 "TODO: handle edge case"
- [COMPLETION-3] Debug statement: src/controller.php:12 contains var_dump()
```

## Post-Approval Actions

After APPROVED verdict, perform these cleanup steps:

### 1. Save Learnings
Extract patterns discovered during this workflow and note them in output:
- Key decisions and their reasoning
- Issues encountered and resolutions
- Codebase patterns discovered
- Conventions to follow in future work

### 2. Suggest Live Testing (for web projects)

After approval, check if the workflow touched frontend/web files. Look for changes to:
- `.html`, `.css`, `.scss`, `.less` files
- `.vue`, `.jsx`, `.tsx`, `.svelte` files
- Template files (`.blade.php`, `.twig`, `.phtml`, `.tmpl`)
- JavaScript/TypeScript files in `src/`, `resources/`, `assets/`, `public/`
- Controller/route files that serve web pages

If web files were changed, include this in your output:

```
## Live Testing Available

This workflow modified web-facing files. You can verify the changes visually:

  /workflow:test-live <URL> [--user=<email>] [--pass=<password>]

This will open a browser and test the running application interactively.
```

If you can detect the likely URL from the project (e.g., from `playwright.config.ts`, `.env`, `docker-compose.yml`, `vite.config.ts`, or webserver configs), suggest it pre-filled:

```
  /workflow:test-live http://localhost:8080
```

### 3. Report
Include in your output:
- Summary of all work completed
- Files changed count
- Test results
- Any warnings or advisories for the user
