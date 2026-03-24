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

Execute components in dependency waves. The number of parallel components is **dynamic** — the supervisor decides based on task complexity, available quota, and component independence.

### Dynamic Parallelism

The supervisor chooses the parallel component count:
- **Default**: 4 parallel components (MAX_PARALLEL_COMPONENTS in mode config)
- **Scale up** to 6-8 if: components are small/independent, plenty of API quota remains
- **Scale down** to 1-2 if: components are large/complex, near rate limits, many file overlaps
- Read the statusline cache (`/tmp/claude-statusline-usage.json`) to check remaining quota before spawning

The supervisor should report its reasoning:
```
Parallel strategy: spawning 6 components (all independent, small scope, 72% quota remaining)
```

### Worktree Creation

For each component about to execute:

```bash
git worktree add .claude/worktrees/epic-{component_id} -b epic/{component_id}
```

This creates an isolated working copy on a new branch. Verify creation:
```bash
git worktree list
```

### Component Agent Spawn (Swarm-Style)

Each component gets a **supervisor agent** that orchestrates swarm-style parallel execution within its worktree. This is far more efficient than a single sequential agent — the component supervisor decomposes its work into parallel batches, just like swarm mode does for features.

For **small components** (complexity: low, <5 files), a single executor agent is sufficient.
For **medium/large components** (complexity: medium/high), use the full swarm pattern.

The supervisor decides which approach to use based on the architect's complexity estimate.

#### Small Component (single agent):
```
Agent(
  subagent_type="workflow:executor",
  model="sonnet",
  run_in_background=true,
  prompt="""
  ## Component: {component_name}

  **WORKING DIRECTORY:** {absolute_worktree_path}
  ALL file operations MUST use paths under this directory.
  Run `cd {absolute_worktree_path}` before any bash commands.

  **SCOPE:** Only modify files in: {files_scope}

  ## Interface Contracts
  Read: {project_root}/CONTRACTS.md
  Your component MUST implement: {interfaces.produces}
  Your component MAY consume: {interfaces.consumes}

  ## Dependency Context
  {summary_of_completed_dependency_outputs}

  ## Pipeline
  1. Plan → 2. Implement → 3. Self-review (iterate until PASS)
  4. Security check → 5. Run tests → 6. Verify completeness

  ## Create PR when done
  cd {absolute_worktree_path}
  git add -A && git commit -m "feat({component_id}): {component_name}"
  git push -u origin epic/{component_id}
  gh pr create --base main --head epic/{component_id} --title "feat({component_id}): {component_name}" --body "..."

  Report: files changed, test results, PR URL
  """
)
```

#### Medium/Large Component (swarm-style):
```
Agent(
  subagent_type="workflow:supervisor",
  model="sonnet",
  run_in_background=true,
  prompt="""
  ## Component Supervisor: {component_name}

  You are the ORCHESTRATOR for component "{component_id}".
  You NEVER write code — only delegate to executor agents.

  **WORKING DIRECTORY:** {absolute_worktree_path}
  ALL agents must work exclusively in this directory.

  **SCOPE:** {files_scope}

  ## Interface Contracts
  Read: {project_root}/CONTRACTS.md
  Component MUST implement: {interfaces.produces}
  Component MAY consume: {interfaces.consumes}

  ## Dependency Context
  {summary_of_completed_dependency_outputs}

  ## Orchestration Pipeline

  ### 1. Planning (yourself or spawn workflow:architect)
  Decompose this component into parallel implementation tasks.
  Each task gets non-overlapping file scope.

  ### 2. Implementation (parallel executors)
  Spawn up to 4 workflow:executor agents with run_in_background=true.
  Each gets a subset of files. Wait for all to complete.

  ### 3. Review (parallel reviewers)
  Spawn workflow:reviewer-deep + workflow:security-deep in parallel.
  Both must PASS. If FAIL: spawn executor to fix, then re-review.
  Iterate until both PASS.

  ### 4. Quality Gate
  Spawn workflow:quality-gate to run build/lint/test pipeline.
  Fix any failures. Iterate until PASS.

  ### 5. Completion Check
  Verify: all files created, interfaces match CONTRACTS.md, no TODOs, tests pass.

  ### 6. Create PR
  cd {absolute_worktree_path}
  git add -A && git commit -m "feat({component_id}): {component_name}"
  git push -u origin epic/{component_id}
  gh pr create --base main --head epic/{component_id} --title "feat({component_id}): {component_name}" --body "..."

  Report: files changed, test results, PR URL, agent summary
  """
)
```

### Wave Execution Loop

```
for each wave in dependency_order:
    # Filter to pending components only (skip completed on resume)
    pending = [c for c in wave if components[c].status == "pending"]

    # Determine parallel count dynamically
    quota = read_statusline_cache()  # check remaining API quota
    parallel_count = decide_parallelism(pending, quota):
        if quota.utilization > 85%: return min(2, len(pending))
        if all components are low complexity: return min(8, len(pending))
        if mixed complexity: return min(4, len(pending))
        default: return min(4, len(pending))

    # Spawn batch
    running_agents = []
    for component_id in pending[:parallel_count]:
        Create worktree
        Update component status to "in_progress"
        Choose agent type: supervisor (for medium/large) or executor (for small)
        Spawn agent with run_in_background=true
        running_agents.append(agent)

    Report: "Wave {N}: spawning {parallel_count} components ({reasoning})"

    # Wait for all agents in this batch
    for agent in running_agents:
        result = agent output
        Parse PR URL from result
        Update component: status=completed, pr_url=..., completed_at=...

        # Check if rate limited
        if result indicates rate limit:
            Handle rate limit (see below)
            return  # Will resume later

    # If wave has more pending components, run next batch
    remaining_in_wave = [c for c in wave if components[c].status == "pending"]
    if remaining_in_wave: continue wave loop

    # After wave fully completes, check for newly unblocked components
    Update state file
```

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
