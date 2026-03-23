---
description: Epic workflow orchestration - multi-component projects with worktree isolation and dependency ordering
disable-model-invocation: true
---

# Epic Orchestration Instructions

You are orchestrating an **epic workflow** — a multi-component project where each component runs in an isolated git worktree, creates its own PR, and components are merged and integration-tested at the end.

## Phase 1: Architecture Planning

Spawn the architect agent (opus) to decompose the project:

```
Agent(
  subagent_type="workflow:architect",
  model="opus",
  prompt="""
  ## Epic Architecture Planning

  Project: {description}
  
  Decompose this project into self-contained components. For each component:
  
  1. **ID**: short kebab-case identifier (e.g., "lexer", "parser", "type-checker")
  2. **Name**: human-readable name
  3. **Description**: what this component does
  4. **Files**: directories/files this component owns (exclusive scope)
  5. **Dependencies**: list of component IDs that must complete before this one
  6. **Interfaces**: what this component produces (types, APIs) and consumes
  7. **Complexity**: low/medium/high estimate
  
  ## Rules
  - Components MUST have non-overlapping file scopes
  - Dependencies MUST form a DAG (no cycles)
  - Each component should be implementable independently with mocked/stubbed dependencies
  - Leaf components (no dependencies) should be identified — they run first
  - Interface contracts between components must be explicit
  
  ## Output Format
  
  1. Write `CONTRACTS.md` to the project root defining all shared interfaces
  2. Return a JSON component list:
  ```json
  {
    "components": [
      {
        "id": "lexer",
        "name": "Lexer/Tokenizer",
        "description": "Tokenizes source code into a token stream",
        "files": ["src/lexer/"],
        "dependencies": [],
        "interfaces": {
          "produces": ["Token type", "Lexer class"],
          "consumes": []
        },
        "complexity": "medium"
      }
    ],
    "dependency_order": [
      ["lexer", "scanner"],
      ["parser"],
      ["type_checker"],
      ["codegen"]
    ]
  }
  ```
  
  The dependency_order is a list of waves — each wave contains components that can run in parallel.
  """
)
```

After the architect completes:
1. Parse the component list from the output
2. Write CONTRACTS.md to the project root (if architect hasn't already)
3. Update the epic state file with components, dependency_order, and interfaces
4. Mark architecture gate as passed

## Phase 2: Component Execution

Execute components in dependency waves. For each wave, run up to MAX_PARALLEL_COMPONENTS simultaneously.

### Worktree Creation

For each component about to execute:

```bash
git worktree add .claude/worktrees/epic-{component_id} -b epic/{component_id}
```

This creates an isolated working copy on a new branch. Verify creation:
```bash
git worktree list
```

### Component Agent Spawn

Each component gets a single agent that runs the full sub-workflow pipeline internally:

```
Agent(
  subagent_type="workflow:executor",
  model="sonnet",
  run_in_background=true,
  prompt="""
  ## Component Sub-Workflow: {component_name}
  
  You are implementing component "{component_id}" of epic workflow "{workflow_id}".
  
  **WORKING DIRECTORY:** {absolute_worktree_path}
  ALL file operations MUST use paths under this directory.
  Run `cd {absolute_worktree_path}` before any bash commands.
  
  **SCOPE:** Only modify files in: {files_scope}
  
  ## Interface Contracts
  Read: {project_root}/CONTRACTS.md
  Your component MUST implement these interfaces: {interfaces.produces}
  Your component MAY consume these interfaces: {interfaces.consumes}
  
  ## Dependency Context
  {summary_of_completed_dependency_outputs}
  
  ## Execute This Pipeline In Order
  
  ### 1. Planning
  Analyze the component scope. Plan the implementation:
  - Files to create/modify
  - Implementation approach
  - How interfaces will be implemented
  - Testing strategy
  
  ### 2. Implementation
  Implement the component. Follow project conventions.
  Write each file immediately after creating it.
  
  ### 3. Self-Review
  Review your own code against these criteria:
  - VERDICT: PASS or FAIL
  - Check: correctness, error handling, edge cases, naming conventions
  - If FAIL: fix issues, then re-review
  - Iterate until PASS
  
  ### 4. Security Check
  Review for security issues:
  - Input validation
  - Injection vulnerabilities
  - Data exposure
  - Authentication/authorization (if applicable)
  
  ### 5. Quality Gate
  Run available checks:
  ```bash
  cd {absolute_worktree_path}
  npm test 2>&1 || vendor/bin/phpunit 2>&1 || pytest 2>&1 || echo "No tests"
  npm run build 2>&1 || echo "No build step"
  ```
  Fix any failures. Iterate until all pass.
  
  ### 6. Completion Check
  Verify:
  - All planned files created
  - Interfaces implemented per CONTRACTS.md
  - No TODO/FIXME markers
  - Tests pass
  
  ## Create PR
  
  After all checks pass, create a PR:
  ```bash
  cd {absolute_worktree_path}
  git add -A
  git commit -m "feat({component_id}): {component_name} implementation"
  git push -u origin epic/{component_id}
  gh pr create --base main --head epic/{component_id} \
    --title "feat({component_id}): {component_name}" \
    --body "Component of epic workflow {workflow_id}. ..."
  ```
  
  ## Output
  Report:
  - Files created/modified (list)
  - Test results
  - PR URL
  - Any issues or warnings
  """
)
```

### Wave Execution Loop

```
for each wave in dependency_order:
    # Filter to pending components only (skip completed on resume)
    pending = [c for c in wave if components[c].status == "pending"]
    
    # Spawn up to MAX_PARALLEL_COMPONENTS
    running_agents = []
    for component_id in pending[:MAX_PARALLEL_COMPONENTS]:
        Create worktree
        Update component status to "in_progress"
        Spawn agent with run_in_background=true
        running_agents.append(agent)
    
    # Wait for all agents in this wave
    for agent in running_agents:
        result = agent output
        Parse PR URL from result
        Update component: status=completed, pr_url=..., completed_at=...
        
        # Check if rate limited
        if result indicates rate limit:
            Handle rate limit (see below)
            return  # Will resume later
    
    # After wave completes, check for newly unblocked components
    Update state file
```

### Handling Remaining Components in Large Waves

If a wave has more components than MAX_PARALLEL_COMPONENTS:
- Run the first batch, wait for completion
- Run the next batch from the same wave
- Continue until all components in the wave are done

## Rate Limit Handling

### Detection

Watch for these signals after agent spawns:
- Agent output contains: "rate limit", "429", "capacity", "overloaded", "throttled"
- Agent returns empty or error output unexpectedly
- Multiple agents fail simultaneously

### Response

1. Read the statusline cache for exact reset time:
```bash
cat /tmp/claude-statusline-usage.json
```
Parse `data.five_hour.resets_at` or `data.seven_day.resets_at` (whichever is sooner).

2. Update state:
```json
"phase": {
  "rate_limit": {
    "paused_at": "<now ISO>",
    "resumes_at": "<resets_at ISO>",
    "reason": "5-hour session limit reached"
  }
}
```

3. Schedule auto-resume (within current session):
Calculate the cron expression from resets_at:
```
resets_at = "2026-03-24T15:30:00Z"
→ Convert to local time
→ CronCreate(cron="30 15 24 3 *", prompt="/workflow:resume {workflow_id}", recurring=false)
```
Store the cron job ID in state: `rate_limit.cron_job_id`

4. Report to user:
```
Rate limit reached. Workflow paused.
  Resumes at: {resets_at} ({human_readable_countdown})
  Auto-resume scheduled: Yes (within this session)
  
  If you close this session, run /workflow:resume when you return.
```

## Phase 3: Integration

After ALL components complete:

### 3.1 Create Integration Branch
```bash
git checkout main
git pull origin main
git checkout -b epic/{workflow_id}/integration
```

### 3.2 Merge Components in Dependency Order

Merge leaves first (no dependencies), then their dependents, up to roots:

```bash
# For each component in topological merge order:
git merge epic/{component_id} --no-ff -m "Merge component: {component_name}"
```

If merge conflicts occur:
- Log the conflicting files
- Spawn epic-integrator agent to resolve conflicts
- After resolution, continue merging remaining components

### 3.3 Run Full Test Suite
```bash
npm test 2>&1 || vendor/bin/phpunit 2>&1 || pytest 2>&1
npm run build 2>&1
```

If tests fail, spawn executor agent to fix integration issues. Iterate until pass.

### 3.4 Integration Review

Spawn parallel review agents:
```
Agent(subagent_type="workflow:reviewer-deep", model="opus", run_in_background=true,
  prompt="Review the full integrated codebase for cross-component issues...")
Agent(subagent_type="workflow:security-deep", model="opus", run_in_background=true,
  prompt="Security review of the full integrated codebase...")
```

Both must PASS. If FAIL, fix and re-review.

### 3.5 Create Integration PR
```bash
git push -u origin epic/{workflow_id}/integration
gh pr create --base main --head epic/{workflow_id}/integration \
  --title "epic: {title}" \
  --body "Integration PR for epic workflow {workflow_id}. ..."
```

### 3.6 Worktree Cleanup

After integration PR is created, clean up worktrees:
```bash
# For each component:
git worktree remove .claude/worktrees/epic-{component_id}
git branch -d epic/{component_id}  # or leave for reference
```

## State Update Pattern

After EVERY significant action, update the state:
- Component started → update component status + started_at
- Component completed → update status + completed_at + pr_url
- Rate limit hit → update phase.rate_limit
- Merge completed → update integration.merged list
- Gate passed → update gates object

Use Read + Edit on the state.json file. Also update the org/md file for human readability.
