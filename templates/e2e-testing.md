# E2E Testing: {{TITLE}}

**Workflow ID:** {{WORKFLOW_ID}}
**Type:** e2e-testing
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

### Test Configuration
- **Base URL:** {{BASE_URL}}
- **Framework:** {{FRAMEWORK}}
- **Auth Strategy:** {{AUTH_STRATEGY}}
- **Exploration Depth:** {{DEPTH}}
- **Output Directory:** {{OUTPUT_DIR}}

---

## Workflow Steps

### Step 0: Setup
**Agent:** Supervisor (inline)
**Status:** pending
**Started:**
**Completed:**

#### Objectives
- [ ] Detect package manager (npm/yarn/pnpm)
- [ ] Check for @playwright/test installation
- [ ] Install @playwright/test if missing
- [ ] Check for playwright.config.ts
- [ ] Generate playwright.config.ts if missing
- [ ] Install Playwright browsers (chromium by default)
- [ ] Verify Playwright MCP tools are accessible
- [ ] Create output directory structure

#### Setup Summary
| Component | Status | Version | Notes |
|-----------|--------|---------|-------|
| Package Manager |  |  |  |
| @playwright/test |  |  |  |
| playwright.config.ts |  |  |  |
| Browsers Installed |  |  |  |
| MCP Tools |  |  |  |

---

### Step 1: Exploration
**Agent:** workflow:e2e-explorer
**Status:** pending
**Started:**
**Completed:**
**Depends On:** Step 0

#### Objectives
- [ ] Navigate to base URL
- [ ] Map navigation structure (menus, links)
- [ ] Discover pages up to depth limit
- [ ] Identify forms and interactive elements
- [ ] Detect authentication requirements
- [ ] Identify dynamic content areas
- [ ] Build comprehensive app map JSON
- [ ] Generate exploration report

#### App Map Summary
| Metric | Count | Notes |
|--------|-------|-------|
| Pages Discovered |  |  |
| Forms Found |  |  |
| Buttons/Actions |  |  |
| Auth Required |  |  |
| Dynamic Elements |  |  |
| External Links |  |  |

#### Exploration Notes

```markdown
(Exploration findings and observations will be recorded here)
```

---

### Step 2: Test Generation
**Agent:** workflow:e2e-generator
**Status:** pending
**Started:**
**Completed:**
**Depends On:** Step 1

#### Objectives
- [ ] Read and parse app map JSON
- [ ] Group features into logical test suites
- [ ] Generate test specs per feature/page
- [ ] Create authentication setup if needed
- [ ] Create page objects (if thorough mode)
- [ ] Generate fixtures for common data
- [ ] Validate TypeScript syntax for all tests
- [ ] Create README for test suite

#### Generated Files
| File | Type | Lines | Features Covered |
|------|------|-------|------------------|
|      |      |       |                  |

#### Test Coverage Map
| Feature/Page | Test File | Auth Required | Assertions |
|--------------|-----------|---------------|------------|
|              |           |               |            |

---

### Step 3: Test Validation
**Agent:** workflow:e2e-reviewer
**Status:** pending
**Iteration:** 0/3
**Started:**
**Completed:**
**Depends On:** Step 2

#### Validation Criteria
- [ ] All tests compile (TypeScript check)
- [ ] All tests run without errors
- [ ] No flaky selectors (accessibility selectors preferred: getByRole > getByLabel > getByText)
- [ ] No hard-coded waits (use waitFor*)
- [ ] Proper test isolation (no shared state)
- [ ] Accessibility selectors used where possible
- [ ] Meaningful assertions (not just element exists)
- [ ] Screenshots on failure configured
- [ ] Parallel execution safe

#### Test Run Results
| Run | Total Tests | Passed | Failed | Flaky | Duration |
|-----|-------------|--------|--------|-------|----------|
| 1   |             |        |        |       |          |
| 2   |             |        |        |       |          |
| 3   |             |        |        |       |          |

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

### Step 4: Quality Gate
**Agent:** workflow:quality-gate
**Status:** pending
**Started:**
**Completed:**
**Depends On:** Step 3

#### Checks
- [ ] TypeScript compilation passes
- [ ] Lint passes (eslint)
- [ ] All E2E tests pass
- [ ] No security issues in test code
- [ ] Test coverage meets threshold
- [ ] CI integration ready

#### Quality Metrics
| Check | Status | Details |
|-------|--------|---------|
| TypeScript |  |  |
| Lint |  |  |
| E2E Tests |  |  |
| Security |  |  |
| Coverage |  |  |

---

### Step 5: Completion Guard
**Agent:** workflow:completion-guard
**Status:** pending
**Started:**
**Completed:**
**Depends On:** Step 4

#### Final Verification
- [ ] All discovered features have tests
- [ ] App map coverage is complete
- [ ] No TODO/FIXME markers in tests
- [ ] Tests are deterministic (no random failures)
- [ ] Authentication flows tested
- [ ] Error states tested
- [ ] Ready for CI integration
- [ ] Documentation complete

#### Coverage Report
| Coverage Type | Percentage | Notes |
|---------------|------------|-------|
| Pages |  |  |
| Forms |  |  |
| User Flows |  |  |
| Auth Scenarios |  |  |

---

## Completion Summary

**Completed At:**
**Total Duration:**

### Files Changed
| File | Lines Added | Lines Removed |
|------|-------------|---------------|
|      |             |               |

### Test Suite Statistics
- **Total Test Files:**
- **Total Test Cases:**
- **Total Assertions:**
- **Average Test Duration:**

### CI Integration

```bash
# Add this to your CI pipeline
npx playwright test

# Or for specific browsers
npx playwright test --project=chromium

# Run in headed mode for debugging
npx playwright test --headed

# Generate HTML report
npx playwright show-report
```

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
