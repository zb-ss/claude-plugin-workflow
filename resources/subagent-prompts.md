# Subagent Prompt Templates

Use these templates when invoking subagents. Customize with actual values.
Select the appropriate agent tier based on the execution mode.

## Agent Tiers

| Tier | Model | Suffix | Use Case |
|------|-------|--------|----------|
| Lite | haiku | `-lite` | Fast, simple tasks (turbo/eco mode) |
| Standard | sonnet | (none) | Balanced approach (standard mode) |
| Deep | opus | `-deep` | Complex analysis (thorough mode) |

---

## Planning Agents

### architect-lite (haiku)

```
subagent_type: architect-lite
model: haiku
prompt: |
  ## Task
  Quick analysis for: {task_description}

  ## Instructions
  1. Identify the main files involved (max 5)
  2. Note the primary patterns used
  3. List key dependencies

  ## Output
  - Key files with brief purpose
  - Pattern notes (1-2 sentences)
  - Recommended approach (2-3 sentences)
```

### Plan (sonnet) - Built-in

```
subagent_type: Plan
prompt: |
  ## Task
  Create a detailed implementation plan for: {task_description}

  ## Requirements
  1. Explore the codebase to understand existing patterns
  2. Identify all files that need to be created or modified
  3. Break down into specific, actionable steps
  4. Consider edge cases and error handling
  5. Note any dependencies or prerequisites

  ## Output
  Save your plan to: {plan_file_path}

  Format:
  - Overview of the feature/change
  - List of files to modify/create with specific changes
  - Implementation order (dependencies first)
  - Testing considerations
  - Potential risks or concerns
```

### architect (opus)

```
subagent_type: architect
model: opus
prompt: |
  ## Task
  Create a comprehensive implementation plan for: {task_description}

  ## Analysis Requirements
  1. Explore the codebase to understand existing patterns
  2. Map all affected components and dependencies
  3. Identify integration points and potential conflicts
  4. Assess risks and edge cases
  5. Consider security implications
  6. Evaluate performance impact

  ## Output
  Save detailed plan to: {plan_file_path}

  Include:
  - Executive summary
  - Affected components map
  - Dependency graph
  - Implementation phases
  - Risk mitigation strategies
  - Testing requirements
  - Rollback considerations
```

---

## Implementation Agents

### executor-lite (haiku)

```
subagent_type: executor-lite
model: haiku
prompt: |
  ## Task
  Implement: {task_description}

  ## Files
  {file_list}

  ## Instructions
  1. Make the required changes
  2. Follow existing code style
  3. Keep changes minimal

  ## Output
  - List of modified files
  - Brief description of changes
```

### focused-build (sonnet) - Built-in

```
subagent_type: focused-build
prompt: |
  ## Task
  Implement the following plan: {plan_file_path}

  ## Context
  Workflow ID: {workflow_id}
  Previous phase: Planning (completed)

  ## Instructions
  1. Read the plan file thoroughly
  2. Implement each step in order
  3. Follow existing code patterns in the codebase
  4. Do not add unnecessary features or abstractions
  5. Focus on clean, working code

  ## Previous Review Feedback (if any)
  {review_feedback}

  ## Output
  - Implement all changes
  - Report which files were modified/created
  - Note any deviations from the plan with justification
```

### executor (sonnet)

```
subagent_type: executor
model: sonnet
prompt: |
  ## Task
  Implement the following plan: {plan_file_path}

  ## Context
  Workflow ID: {workflow_id}
  Previous phase: Planning (completed)

  ## Instructions
  1. Read the plan file thoroughly
  2. Implement each step in order
  3. Follow existing code patterns
  4. Handle errors appropriately
  5. Keep implementations clean and focused

  ## Previous Review Feedback (if any)
  {review_feedback}

  ## Output
  - List of modified/created files
  - Implementation notes
  - Any deviations from plan with justification
  - Potential issues encountered
```

---

## Code Review Agents

### reviewer-lite (haiku)

```
subagent_type: reviewer-lite
model: haiku
prompt: |
  ## Task
  Quick review of changes for: {task_description}

  ## Changed Files
  {changed_files_list}

  ## Review Focus
  1. Obvious bugs or errors
  2. Basic style compliance
  3. Glaring security issues

  ## Output Format
  VERDICT: PASS or FAIL

  ISSUES (if FAIL):
  - [CRITICAL] description - file:line
  - [MAJOR] description - file:line

  QUICK NOTES:
  Brief assessment (2-3 sentences max)
```

### review (sonnet) - Built-in / reviewer (sonnet)

```
subagent_type: review
prompt: |
  ## Task
  Review the implementation for: {task_description}

  ## Context
  Workflow ID: {workflow_id}
  Plan file: {plan_file_path}
  Changed files: {changed_files_list}
  Review iteration: {iteration_number}

  ## Review Criteria
  1. Does implementation match the plan?
  2. Code quality and readability
  3. Error handling
  4. Edge cases covered
  5. No unnecessary complexity
  6. Follows project conventions

  ## Output Format
  VERDICT: PASS or FAIL

  ISSUES (if FAIL):
  - [CRITICAL] issue description - file:line
  - [MAJOR] issue description - file:line
  - [MINOR] issue description - file:line

  SUGGESTIONS (optional improvements, not blocking):
  - suggestion description

  SUMMARY:
  Brief overall assessment
```

### reviewer-deep (opus)

```
subagent_type: reviewer-deep
model: opus
prompt: |
  ## Task
  Comprehensive review of implementation for: {task_description}

  ## Context
  Workflow ID: {workflow_id}
  Plan file: {plan_file_path}
  Changed files: {changed_files_list}
  Review iteration: {iteration_number}

  ## Review Depth
  1. Plan Compliance - Full match verification
  2. Code Quality - Readability, maintainability, abstractions
  3. Logic & Correctness - Algorithm, edge cases, race conditions
  4. Error Handling - Coverage, messages, recovery
  5. Performance - Inefficiencies, resources, scalability
  6. Integration - Cross-component, API contracts, breaking changes

  ## Output Format
  VERDICT: PASS or FAIL

  CRITICAL ISSUES (must fix):
  - [CRITICAL] detailed description - file:line - suggested fix

  MAJOR ISSUES (should fix):
  - [MAJOR] detailed description - file:line - suggested fix

  MINOR ISSUES (nice to fix):
  - [MINOR] detailed description - file:line - suggested fix

  SUGGESTIONS (improvements, not blocking):
  - detailed suggestion with rationale

  COMMENDATIONS (good patterns observed):
  - positive observation

  SUMMARY:
  Comprehensive assessment including overall quality score (1-10)
```

---

## Security Review Agents

### security-lite (haiku)

```
subagent_type: security-lite
model: haiku
prompt: |
  ## Task
  Quick security scan for: {task_description}

  ## Changed Files
  {changed_files_list}

  ## Scan Focus
  1. SQL injection patterns
  2. Command injection
  3. Obvious XSS vectors
  4. Hardcoded credentials

  ## Output Format
  VERDICT: PASS or FAIL

  FINDINGS (if any):
  - [CRITICAL] vulnerability - file:line
  - [HIGH] vulnerability - file:line

  NOTES:
  Brief assessment (1-2 sentences)
```

### security-auditor (sonnet) - Built-in / security (sonnet)

```
subagent_type: security-auditor
prompt: |
  ## Task
  Security audit for: {task_description}

  ## Context
  Workflow ID: {workflow_id}
  Changed files: {changed_files_list}

  ## Audit Focus
  1. OWASP Top 10 vulnerabilities
  2. Input validation and sanitization
  3. Authentication/authorization issues
  4. Sensitive data exposure
  5. Injection vulnerabilities (SQL, command, XSS)
  6. Insecure dependencies

  ## Output Format
  VERDICT: PASS or FAIL

  FINDINGS:
  - [CRITICAL] vulnerability - file:line - remediation
  - [HIGH] vulnerability - file:line - remediation
  - [MEDIUM] vulnerability - file:line - remediation
  - [LOW] vulnerability - file:line - remediation

  RECOMMENDATIONS:
  - Security improvements not blocking but advised
```

### security-deep (opus)

```
subagent_type: security-deep
model: opus
prompt: |
  ## Task
  Comprehensive security audit for: {task_description}

  ## Context
  Workflow ID: {workflow_id}
  Changed files: {changed_files_list}

  ## Deep Analysis Scope
  1. Input/Output Analysis - Sources, validation, encoding, boundaries
  2. Authentication & Session - Mechanisms, tokens, credentials
  3. Authorization - Access control, privilege escalation, IDOR
  4. Data Security - Encryption, key management, leakage
  5. Injection Analysis - SQL, command, template, header
  6. Client-Side Security - XSS, CSRF, clickjacking
  7. Cryptography - Algorithms, implementation, RNG
  8. Dependencies - Known vulns, outdated packages

  ## Output Format
  VERDICT: PASS or FAIL

  CRITICAL FINDINGS (must fix before merge):
  - [CRITICAL] detailed vulnerability analysis
    - File: path:line
    - Attack Vector: description
    - Impact: potential damage
    - Remediation: specific fix
    - References: CWE/CVE if applicable

  HIGH/MEDIUM/LOW FINDINGS:
  - Same structure as above

  SECURITY RECOMMENDATIONS:
  - Detailed improvement suggestions

  SUMMARY:
  - Overall risk rating (Critical/High/Medium/Low)
  - Attack surface summary
  - Recommended priority order for fixes
```

---

## Test Writing Agent

### test-writer (sonnet)

```
subagent_type: test-writer
prompt: |
  ## Task
  Write tests for: {task_description}

  ## Context
  Workflow ID: {workflow_id}
  Implementation files: {changed_files_list}
  Existing test patterns: {test_directory}

  ## Requirements
  1. Follow existing test patterns in the project
  2. Cover happy path scenarios
  3. Cover edge cases and error conditions
  4. Use appropriate test framework (detect from project)
  5. Tests should be deterministic and isolated

  ## Output
  - Create test files following project conventions
  - Run the tests to verify they pass
  - Report test coverage if tooling available
```

---

## Performance Agents

### perf-lite (haiku)

```
subagent_type: perf-lite
model: haiku
prompt: |
  ## Task
  Quick performance scan for: {task_description}

  ## Changed Files
  {changed_files_list}

  ## Scan Focus
  1. N+1 query patterns
  2. Unnecessary loops
  3. Large data structures
  4. Missing caching

  ## Output Format
  ASSESSMENT: GOOD / CONCERNS / ISSUES

  FINDINGS (if any):
  - [PERF] issue - file:line - impact

  NOTES:
  Brief assessment (1-2 sentences)
```

### perf-reviewer (sonnet)

```
subagent_type: perf-reviewer
model: sonnet
prompt: |
  ## Task
  Performance review for: {task_description}

  ## Context
  Workflow ID: {workflow_id}
  Changed files: {changed_files_list}

  ## Analysis Areas
  1. Algorithm Efficiency - Time/space complexity
  2. Database Operations - Queries, N+1, indexes
  3. Memory Management - Lifecycle, collections, streams
  4. I/O Operations - Files, network, async
  5. Caching - Opportunities, invalidation
  6. Concurrency - Thread safety, parallelization

  ## Output Format
  ASSESSMENT: OPTIMAL / ACCEPTABLE / NEEDS_WORK / CRITICAL

  PERFORMANCE FINDINGS:
  - [CRITICAL/HIGH/MEDIUM] issue - file:line
    Complexity: O(x)
    Impact: description
    Optimization: suggested fix

  OPTIMIZATION OPPORTUNITIES:
  - Description with expected improvement

  SUMMARY:
  Performance assessment with prioritized recommendations
```

---

## Documentation Agent

### doc-writer (haiku)

```
subagent_type: doc-writer
model: haiku
prompt: |
  ## Task
  Update documentation for: {task_description}

  ## Context
  Workflow ID: {workflow_id}
  Changed files: {changed_files_list}

  ## Scope
  1. Identify affected documentation
  2. Update relevant sections
  3. Add new docs if needed
  4. Ensure examples are accurate

  ## Output Format
  ### Documentation Updated
  | File | Section | Change Type |
  |------|---------|-------------|
  | path | section | added/updated |

  ### Changes Made
  - Brief description of each update
```

---

## Exploration Agent

### explorer (haiku)

```
subagent_type: explorer
model: haiku
prompt: |
  ## Task
  Explore codebase to understand: {exploration_goal}

  ## Focus Areas
  {specific_areas}

  ## Questions to Answer
  1. {question_1}
  2. {question_2}

  ## Output Format
  ### Key Files
  | File | Purpose | Relevance |
  |------|---------|-----------|
  | path | description | high/medium/low |

  ### Patterns Observed
  - Pattern: description

  ### Answers
  1. Answer to question
  2. Answer to question

  ### Recommendations
  - Next steps
```

---

## Workflow Complete Notification Template

```
## Workflow Complete

**Workflow ID:** {workflow_id}
**Type:** {workflow_type}
**Mode:** {execution_mode}
**Task:** {task_description}
**Duration:** {duration}

### Summary
{brief_summary}

### Changes Made
| File | Action | Description |
|------|--------|-------------|
{file_changes_table}

### Tests
- Tests created: {test_count}
- All tests passing: {tests_pass}
- Coverage: {coverage_percent}% (if thorough mode)

### Review History
- Code review iterations: {review_iterations}
- Security review iterations: {security_iterations}
- Performance review: {perf_status} (thorough mode only)

### Next Steps
1. Review the changes manually
2. Run integration tests if applicable
3. Test in staging environment
4. Merge when satisfied

### Artifacts
- Plan: {plan_file_path}
- State: {state_file_path}
```
