---
name: verify
description: Run verification loop on current changes
user_invocable: true
usage: /workflow:verify [--phase=<phase>]
arguments:
  - name: phase
    required: false
    description: Specific phase to run (build, type, lint, test, security, diff)
---

# Verification Loop

Run a structured verification loop on the current workflow changes. Checks build, types, lint, tests, security, and diff.

## Usage

```bash
# Run full verification
/workflow:verify

# Run specific phase
/workflow:verify --phase=build
/workflow:verify --phase=type
/workflow:verify --phase=lint
/workflow:verify --phase=test
/workflow:verify --phase=security
/workflow:verify --phase=diff
```

## Verification Phases

| Phase | Description | Tools Used |
|-------|-------------|------------|
| `build` | Compile/build check | Framework build command |
| `type` | Type checking | tsc, mypy, phpstan, etc. |
| `lint` | Code style/lint | eslint, prettier, phpcs, etc. |
| `test` | Run test suite | jest, phpunit, pytest, etc. |
| `security` | Security scan | npm audit, composer audit, etc. |
| `diff` | Review changes | git diff analysis |

## Instructions

When the user invokes this skill:

1. **Detect project type**
   - Check for package.json (Node.js)
   - Check for composer.json (PHP)
   - Check for pyproject.toml / requirements.txt (Python)
   - Check for Cargo.toml (Rust)
   - Adapt commands accordingly

2. **Run verification phases**

   For each phase (unless specific phase requested):

   ### Build Phase
   ```bash
   # Node.js
   npm run build 2>&1 || yarn build 2>&1

   # PHP
   composer validate && composer install --dry-run

   # Python
   python -m py_compile <changed_files>
   ```

   ### Type Phase
   ```bash
   # TypeScript
   npx tsc --noEmit

   # PHP
   vendor/bin/phpstan analyse <changed_files>

   # Python
   mypy <changed_files>
   ```

   ### Lint Phase
   ```bash
   # JavaScript/TypeScript
   npx eslint <changed_files>

   # PHP
   vendor/bin/phpcs <changed_files>

   # Python
   ruff check <changed_files>
   ```

   ### Test Phase
   ```bash
   # Node.js
   npm test

   # PHP
   vendor/bin/phpunit

   # Python
   pytest
   ```

   ### Security Phase
   ```bash
   # Node.js
   npm audit --audit-level=high

   # PHP
   composer audit

   # Python
   pip-audit
   ```

   ### Diff Phase
   - Run `git diff --stat`
   - Analyze changed files
   - Report additions/deletions/modifications

3. **Collect results**
   - Track PASS/FAIL for each phase
   - Capture error messages
   - Record timing

4. **Generate report**

## Output Format

```
╔══════════════════════════════════════════════════════════════╗
║                    VERIFICATION REPORT                        ║
╠══════════════════════════════════════════════════════════════╣
║ Phase     │ Status │ Duration │ Details                       ║
╠═══════════╪════════╪══════════╪═══════════════════════════════╣
║ Build     │ ✓ PASS │ 2.3s     │ Compiled successfully         ║
║ Type      │ ✓ PASS │ 1.1s     │ No type errors                ║
║ Lint      │ ✗ FAIL │ 0.8s     │ 2 errors, 3 warnings          ║
║ Test      │ ✓ PASS │ 5.2s     │ 42 passed, 0 failed           ║
║ Security  │ ⚠ WARN │ 1.5s     │ 1 moderate vulnerability      ║
║ Diff      │ ✓ PASS │ 0.2s     │ 5 files, +120 -45 lines       ║
╚══════════════════════════════════════════════════════════════╝

OVERALL: FAIL (1 blocking issue)

BLOCKING ISSUES:
1. [Lint] src/utils/helper.ts:42 - Missing semicolon
2. [Lint] src/utils/helper.ts:55 - Unused variable 'temp'

WARNINGS (non-blocking):
1. [Security] lodash@4.17.20 has moderate severity vulnerability
   Recommendation: Upgrade to lodash@4.17.21

NEXT STEPS:
1. Fix lint errors in src/utils/helper.ts
2. Run /workflow:verify --phase=lint to re-check
```

## Phase Detection

The skill auto-detects available phases based on project configuration:

| File Present | Phases Enabled |
|--------------|----------------|
| package.json | build, lint, test |
| tsconfig.json | type |
| .eslintrc* | lint |
| composer.json | build, lint, test |
| phpstan.neon | type |
| pyproject.toml | type, lint, test |

## Exit Codes

- `0` - All phases passed
- `1` - One or more phases failed
- `2` - Configuration error (missing tools)

## Integration with Workflow

Results are logged to workflow state:
- Updates `verification` section in state
- Records timestamp and results
- Can be used by review agents for context
