---
description: Quality gate procedures - build/type/lint/test pipeline, auto-fix loop, changes signaling
disable-model-invocation: true
---

# Quality Gate Instructions

You are executing the **quality gate** phase. Run all automated checks and fix issues.

## Pipeline Sequence

Run these checks in order. Stop on first failure, fix, then re-run from the beginning:

### 1. Build Check
```bash
# Detect and run build
npm run build 2>&1 || composer install 2>&1 || echo "No build step"
```

### 2. Type Check
```bash
# TypeScript
npx tsc --noEmit 2>&1
# PHP (syntax only)
find . -name "*.php" -not -path "./vendor/*" -exec php -l {} \; 2>&1 | grep -v "No syntax errors"
```

### 3. Lint Check
```bash
# JavaScript/TypeScript
npx eslint . --ext .ts,.tsx,.js,.jsx 2>&1
# PHP
vendor/bin/phpcs --standard=PSR12 src/ 2>&1
```

### 4. Test Suite
```bash
# Run project tests
npm test 2>&1 || vendor/bin/phpunit 2>&1 || pytest 2>&1
```

### 4b. Regression Check
```bash
# Run FULL test suite, not just new tests
# Verify existing tests haven't broken
npm test 2>&1 || vendor/bin/phpunit 2>&1 || pytest 2>&1
```
If any previously-passing tests now fail, this is a CRITICAL regression. Report it immediately.

### 5. Security Check
```bash
npm audit --production 2>&1 || composer audit 2>&1
```

Adapt commands to what's available in the project. Skip checks that don't apply.

## Auto-Fix Loop

For each failing check:
1. Read the error output
2. Fix the issue in the source files
3. Re-run the check
4. Max 3 fix attempts per check

## CHANGES_MADE Signal

If you made ANY code changes during auto-fixing, include in your output:
```
CHANGES_MADE: true
FILES_CHANGED:
- src/Service.php (fixed type error)
- tests/ServiceTest.php (fixed assertion)
```

This signals the orchestrator to run a targeted review of changed files.

## Verdict

```
VERDICT: PASS
All checks passed:
- Build: OK
- Types: OK  
- Lint: OK (2 auto-fixed)
- Tests: 42 passed, 0 failed
- Security: No vulnerabilities
CHANGES_MADE: false
```

OR:

```
VERDICT: FAIL
Failed checks:
- Tests: 3 failures after max fix attempts
  - test_user_creation: AssertionError at line 42
  - test_auth_flow: Timeout after 30s
  - test_validation: Expected 422, got 500
CHANGES_MADE: true
FILES_CHANGED:
- src/Validator.php (attempted fix, still failing)
```
