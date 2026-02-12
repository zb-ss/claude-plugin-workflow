# Subagent Prompt Templates

Use these templates when invoking subagents. Customize with actual values.
Select the appropriate agent tier based on the execution mode.

## CRITICAL: Use Workflow Agents Only

**ALWAYS use `workflow:` prefixed agents** to ensure they use native tools (Write/Edit) instead of bash commands for file operations.

All custom workflow agents must use the `workflow:` prefix (e.g., `workflow:executor`, `workflow:reviewer`, `workflow:security`). The only exception is the built-in `Plan` agent which is read-only.

---

## CRITICAL: Write Tool Path Requirements

**The Write tool does NOT expand `~`** - you MUST use absolute paths!

```
WRONG: Write(~/.claude/workflows/active/state.org)  → ERROR
RIGHT: Write(/home/user/.claude/workflows/active/state.org) → SUCCESS
```

**Before writing to user directories, ALWAYS get $HOME first:**

```bash
# Step 1: Get HOME path
echo $HOME
# Output: /home/zashboy

# Step 2: Use absolute path in Write tool
Write(/home/zashboy/.claude/workflows/active/state.org)
```

This applies to ALL file operations in `~/.claude/` directories.

---

## Context Resilience

**ALL agent spawns MUST include `max_turns`** to prevent unbounded context growth. Values come from the mode config's `MAX_TURNS_*` properties. See `resources/context-resilience.md` for the canonical table.

**Reference, don't embed context:** Instead of inlining the codebase context file contents, provide the path and let the agent read it:

```
## Codebase Context
Read the context file at: <HOME>/.claude/workflows/context/<project-slug>.md
Focus on: [relevant sections for this task]
```

This keeps prompts lean and lets each agent manage their own context budget.

---

## Agent Tiers

| Tier | Model | Suffix | Use Case |
|------|-------|--------|----------|
| Lite | haiku | `-lite` | Fast, simple tasks (turbo/eco mode) |
| Standard | sonnet | (none) | Balanced approach (standard mode) |
| Deep | opus | `-deep` | Complex analysis (thorough mode) |

---

## Codebase Analysis Agent

### codebase-analyzer (sonnet)

Runs **before planning** to extract conventions and best practices.

```
subagent_type: workflow:codebase-analyzer
model: sonnet
max_turns: 20
prompt: |
  ## Task
  Analyze the codebase to extract conventions and best practices.

  ## Project Root
  {project_root}

  ## CRITICAL: Tool Usage
  - Use `Write` tool to save the context document
  - NEVER use bash commands for file operations
  - Get $HOME first, then use absolute paths (Write doesn't expand ~)

  ## Analysis Scope
  1. Stack Detection - Languages, frameworks, tools
  2. Project Structure - Directory layout, entry points
  3. Naming Conventions - Files, classes, methods, variables, DB
  4. Architectural Patterns - Design patterns, layer separation
  5. Code Style - Indentation, quotes, formatting
  6. Error Handling - Exceptions, logging, validation
  7. Testing Patterns - Framework, naming, organization
  8. Documentation Style - Docblocks, comments

  ## Output
  Save context document to: $HOME/.claude/workflows/context/{project-slug}.md

  This context will be injected into all subsequent agent prompts
  to ensure consistency with established patterns.
```

**Context file is referenced (not embedded) in all other agents:**

```
## Codebase Context
Read the context file at: <HOME>/.claude/workflows/context/<project>.md
Focus on: [relevant sections for this task]

## Task
{actual task instructions}
```

---

## Planning Agents

### architect-lite (haiku)

```
subagent_type: workflow:architect-lite
model: haiku
max_turns: 8
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
subagent_type: workflow:architect
model: opus
max_turns: 15
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
subagent_type: workflow:executor-lite
model: haiku
max_turns: 15
prompt: |
  ## Task
  Implement: {task_description}

  ## Files
  {file_list}

  ## CRITICAL: Tool Usage
  - Use `Write` tool to CREATE new files
  - Use `Edit` tool to MODIFY existing files
  - NEVER use bash commands for file operations:
    - NO `php -r "file_put_contents(...)"`
    - NO `python -c "open(...).write(...)"`
    - NO `echo "..." > file`
  - Write tool does NOT expand ~ - get $HOME first, use absolute paths

  ## Skill Loading (Optional)
  Load recommended skills from codebase context if available:
  `Skill(skill: "{skill-name}")`

  ## Instructions
  1. Load recommended skills (if available)
  2. Make the required changes
  3. Follow existing code style
  4. Keep changes minimal

  ## Review Issues to Fix (if any - MANDATORY fix ALL)
  {numbered_issues_list}

  ### Fix Protocol (when review issues are provided)
  1. Address EVERY issue by ID - no exceptions
  2. For each issue:
     a. Read the file at the specified line
     b. Apply the fix
     c. Self-verify: re-read the code to confirm the fix
  3. Report: [ISSUE-N] FIXED: <what was changed>
  4. False positives: [ISSUE-N] DISPUTE: <justification>
  5. Do NOT skip any issue.

  ## Output
  - List of modified files
  - Brief description of changes
  - Fix report (if review issues were provided)
```

### executor (sonnet)

```
subagent_type: workflow:executor
model: sonnet
max_turns: 25
prompt: |
  ## Task
  Implement the following plan: {plan_file_path}

  ## Context
  Workflow ID: {workflow_id}
  Previous phase: Planning (completed)

  ## CRITICAL: Tool Usage
  - Use `Write` tool to CREATE new files
  - Use `Edit` tool to MODIFY existing files
  - Use `Read` tool to read file contents
  - NEVER use bash commands for file operations:
    - NO `php -r "file_put_contents(...)"`
    - NO `python -c "open(...).write(...)"`
    - NO `echo "..." > file`
    - NO `cat << EOF > file`
  Native tools work cross-platform and respect permissions.

  ## Skill Loading (Optional)
  If codebase context lists "Recommended Skills", load them first:
  `Skill(skill: "{skill-name}")`
  Continue without skills if not installed.

  ## Instructions
  1. Read the plan file thoroughly
  2. Load recommended skills from codebase context (if available)
  3. Implement each step in order
  4. Follow existing code patterns
  5. Handle errors appropriately
  6. Keep implementations clean and focused

  ## Previous Review Feedback (if any)
  {review_feedback}

  ## Review Issues to Fix (if any - MANDATORY fix ALL)
  {numbered_issues_list}

  ### Fix Protocol (when review issues are provided)
  1. Address EVERY issue by ID - no exceptions
  2. For each issue:
     a. Read the file at the specified line
     b. Understand the root cause
     c. Apply the fix
     d. Self-verify: re-read the code to confirm the fix is correct
  3. Report fixes:
     - [ISSUE-1] FIXED: <what was changed and why>
     - [ISSUE-2] FIXED: <what was changed and why>
  4. If you believe an issue is a false positive:
     - [ISSUE-N] DISPUTE: <detailed justification>
  5. CRITICAL: Do NOT skip any issue. Every issue ID must appear in your output.

  ## Output
  - List of modified/created files
  - Implementation notes
  - Any deviations from plan with justification
  - Potential issues encountered
  - Fix report (if review issues were provided)
```

---

## Code Review Agents

### reviewer-lite (haiku)

```
subagent_type: workflow:reviewer-lite
model: haiku
max_turns: 8
prompt: |
  ## Task
  Quick review of changes for: {task_description}

  ## Changed Files
  {changed_files_list}

  ## Codebase Context
  Read the context file at: <HOME>/.claude/workflows/context/<project>.md
  Focus on: Naming conventions, code style

  ## Review Focus
  1. Obvious bugs or errors
  2. Basic style compliance
  3. Glaring security issues
  4. Naming convention violations (from codebase context)

  ## Verdict Rules
  - PASS: ZERO issues at any severity (CRITICAL, MAJOR, MINOR)
  - FAIL: ANY issue at any severity level
  - If ANY issue exists, verdict MUST be FAIL

  ## Previous Issues (if iteration > 1)
  {previous_issues_list}

  ### Re-review Protocol (if iteration > 1)
  1. For EACH previous issue, verify:
     - [ISSUE-N] ✓ RESOLVED / ✗ NOT RESOLVED / ⚠ REGRESSED
  2. Scan for NEW issues (IDs start from max+1)
  3. PASS only if ALL previous resolved AND zero new issues

  ## Output Format
  VERDICT: PASS or FAIL

  ISSUES (if FAIL):
  - [ISSUE-1] [CRITICAL] description - file:line - suggested fix
  - [ISSUE-2] [MAJOR] description - file:line - suggested fix
  - [ISSUE-3] [MINOR] description - file:line - suggested fix

  TOTAL: N issues (X CRITICAL, Y MAJOR, Z MINOR)

  IMPROVEMENTS (non-blocking):
  - suggestion

  QUICK NOTES:
  Brief assessment (2-3 sentences max)
```

### reviewer (sonnet)

```
subagent_type: workflow:reviewer
max_turns: 12
prompt: |
  ## Task
  Review the implementation for: {task_description}

  ## Context
  Workflow ID: {workflow_id}
  Plan file: {plan_file_path}
  Changed files: {changed_files_list}
  Review iteration: {iteration_number}

  ## Codebase Context
  Read the context file at: <HOME>/.claude/workflows/context/<project>.md
  Focus on: Naming conventions, architectural patterns, error handling, code style

  ## Language & Framework Best Practices
  Check the implementation against:
  1. Framework conventions (detected from codebase context)
  2. Language idioms and best practices
  3. Project-specific patterns and naming conventions
  4. SOLID principles compliance
  5. Security patterns appropriate for the framework

  ## Skill Loading (Optional)
  If codebase context lists "Recommended Skills", load them:
  Skill(skill: "{skill-name}")

  ## Review Criteria
  1. Does implementation match the plan?
  2. Code quality and readability
  3. Error handling
  4. Edge cases covered
  5. No unnecessary complexity
  6. Follows project conventions (from codebase context)

  ## Verdict Rules
  - PASS: ZERO issues at any severity (CRITICAL, MAJOR, MINOR)
  - FAIL: ANY issue at any severity level
  - If ANY issue exists, verdict MUST be FAIL

  ## Previous Issues (if iteration > 1)
  {previous_issues_list}

  ### Re-review Protocol (if iteration > 1)
  1. For EACH previous issue, verify:
     - [ISSUE-N] ✓ RESOLVED / ✗ NOT RESOLVED / ⚠ REGRESSED
  2. Scan for NEW issues (IDs start from max+1)
  3. PASS only if ALL previous resolved AND zero new issues

  ## Output Format
  VERDICT: PASS or FAIL

  ISSUES (if FAIL):
  - [ISSUE-1] [CRITICAL] issue - file:line - suggested fix
  - [ISSUE-2] [MAJOR] issue - file:line - suggested fix
  - [ISSUE-3] [MINOR] issue - file:line - suggested fix

  TOTAL: N issues (X CRITICAL, Y MAJOR, Z MINOR)

  IMPROVEMENTS (non-blocking):
  - suggestion description

  SUMMARY:
  Brief overall assessment
```

### reviewer-deep (opus)

```
subagent_type: workflow:reviewer-deep
model: opus
max_turns: 15
prompt: |
  ## Task
  Comprehensive review of implementation for: {task_description}

  ## Context
  Workflow ID: {workflow_id}
  Plan file: {plan_file_path}
  Changed files: {changed_files_list}
  Review iteration: {iteration_number}

  ## Codebase Context
  Read the context file at: <HOME>/.claude/workflows/context/<project>.md
  Focus on: Naming conventions, architectural patterns, error handling, code style

  ## Language & Framework Best Practices
  Check the implementation against:
  1. Framework conventions (detected from codebase context)
  2. Language idioms and best practices
  3. Project-specific patterns and naming conventions
  4. SOLID principles compliance
  5. Security patterns appropriate for the framework

  ## Skill Loading (Optional)
  If codebase context lists "Recommended Skills", load them:
  Skill(skill: "{skill-name}")

  ## Review Depth
  1. Plan Compliance - Full match verification
  2. Code Quality - Readability, maintainability, abstractions
  3. Logic & Correctness - Algorithm, edge cases, race conditions
  4. Error Handling - Coverage, messages, recovery
  5. Performance - Inefficiencies, resources, scalability
  6. Integration - Cross-component, API contracts, breaking changes

  ## Verdict Rules
  - PASS: ZERO issues at any severity (CRITICAL, MAJOR, MINOR)
  - FAIL: ANY issue at any severity level
  - If ANY issue exists, verdict MUST be FAIL

  ## Previous Issues (if iteration > 1)
  {previous_issues_list}

  ### Re-review Protocol (if iteration > 1)
  1. For EACH previous issue, verify:
     - [ISSUE-N] ✓ RESOLVED / ✗ NOT RESOLVED / ⚠ REGRESSED
  2. Scan for NEW issues (IDs start from max+1)
  3. PASS only if ALL previous resolved AND zero new issues

  ## Output Format
  VERDICT: PASS or FAIL

  ISSUES (if FAIL):
  - [ISSUE-1] [CRITICAL] detailed description - file:line - suggested fix
  - [ISSUE-2] [MAJOR] detailed description - file:line - suggested fix
  - [ISSUE-3] [MINOR] detailed description - file:line - suggested fix

  TOTAL: N issues (X CRITICAL, Y MAJOR, Z MINOR)

  IMPROVEMENTS (non-blocking):
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
subagent_type: workflow:security-lite
model: haiku
max_turns: 8
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

### security (sonnet)

```
subagent_type: workflow:security
max_turns: 10
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
subagent_type: workflow:security-deep
model: opus
max_turns: 12
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
subagent_type: workflow:test-writer
max_turns: 20
prompt: |
  ## Task
  Write tests for: {task_description}

  ## Context
  Workflow ID: {workflow_id}
  Implementation files: {changed_files_list}
  Existing test patterns: {test_directory}

  ## CRITICAL: Tool Usage
  - Use `Write` tool to CREATE new test files
  - Use `Edit` tool to MODIFY existing test files
  - NEVER use bash commands for file operations:
    - NO `php -r "file_put_contents(...)"`
    - NO `python -c "open(...).write(...)"`
    - NO `echo "..." > file`

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
subagent_type: workflow:perf-lite
model: haiku
max_turns: 8
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
subagent_type: workflow:perf-reviewer
model: sonnet
max_turns: 10
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
subagent_type: workflow:doc-writer
model: haiku
max_turns: 8
prompt: |
  ## Task
  Update documentation for: {task_description}

  ## Context
  Workflow ID: {workflow_id}
  Changed files: {changed_files_list}

  ## CRITICAL: Tool Usage
  - Use `Write` tool to CREATE new documentation files
  - Use `Edit` tool to MODIFY existing documentation
  - NEVER use bash commands for file operations

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
subagent_type: workflow:explorer
model: haiku
max_turns: 10
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
