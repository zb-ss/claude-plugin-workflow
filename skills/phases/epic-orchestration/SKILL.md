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
    ],
    "execution_path": "epic",
    "reasoning": "4 components, multi-wave DAG, disjoint file scopes → separate PRs",
    "confidence": 0.85
  }
  ```

  Also emit `confidence` (0–1): how well-specified and unambiguous the task is.
  Persist to `state.architecture.confidence`. In autonomous runs, a value below
  the configured `confidence_threshold` makes the driver **park** the task
  (`blocked` label + a comment asking for clarification) rather than guess.

  The dependency_order is a list of waves — each wave contains components that can run in parallel.

  **Decision rule (emitted for EVERY task — the architect decomposes first, then
  the supervisor routes on this field without asking the user):** set
  `execution_path: "epic"` if ANY of — component count ≥ 3, the DAG has > 1 wave,
  or ≥ 2 components with disjoint file scopes mapping to separate PRs; otherwise
  `"swarm"` (one component, or several with shared scope in a single wave).
  """
)
```

After the architect completes:
1. Parse the component list from the output
2. Write CONTRACTS.md to the project root (if architect hasn't already)
3. Update the state file with components, dependency_order, interfaces, and `execution_path`/`reasoning` (under `state.architecture`); the supervisor routes swarm vs epic on `execution_path`
4. Mark architecture gate as passed

## Gate: capability_preflight (runs once, after architecture, before component execution)

After the architect agent returns and state is updated, run the preflight gate
**before** creating any worktrees or spawning component agents:

```python
# Follow the full capability_preflight protocol in agents/supervisor.md.
# Key points specific to epic mode:
# - Pass REPO_ROOT = the main worktree root (not a component worktree).
# - state.review_depth from risk-classify sets the floor for the per-component
#   review lenses (§ "Review" inside each component supervisor) AND the
#   integration-level review in Phase 3.4.
# - If the gate blocks (missing tools, autonomous mode): set
#   state.parked = True and return — do NOT create any worktrees.
# - On pass: set_gate("capability_preflight", "passed") and continue.
```

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
  ## SCRUB GATE: the push/PR below crosses into {target_repo}. If that repo is
  ## not private, every `git push` / `gh pr create` is auto-intercepted by the
  ## scrub-guard PreToolUse hook (blocks on internal markers). If it blocks,
  ## genericize/redact the flagged content and retry — never history-rewrite.
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

Rate-limit detection and pause/resume are **shared across all workflow types**.
Follow the protocol defined in
`skills/shared/rate-limit-handling.md` — the same logic that swarm, feature,
and translate workflows use.

In short:
1. After every agent spawn, run `detectRateLimit(<agent output>)` from
   `hooks/lib/rate-limit.js`.
2. If non-null, call `applyRateLimitPause(state, …)` with the soonest reset
   time from `getNextResetIso()`.
3. Schedule a one-shot `CronCreate` with the prompt from `buildResumePrompt`
   and the cron expression from `buildCronExpression`.
4. Report the pause via `buildPauseReport()` and return.

Resume is handled by `/workflow:resume`, which clears the pause when
`resumes_at` has passed and dispatches into the epic resume branch
(component-level or integration-level — see resume/SKILL.md).

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

## Gate: spec_conformance (after integration, before e2e_validation / post-merge review)

After Phase 3.3 (full test suite passes) and Phase 3.4 (integration review passes),
run spec_conformance against the **merged** integration branch before advancing:

```python
# Follow the full spec_conformance protocol in agents/supervisor.md.
# Key points specific to epic mode:
# - acceptance_criteria = state.workflow.acceptance_criteria (epic-level, not per-component).
# - diff_summary = the cumulative diff of the integration branch vs main.
# - test_output = Phase 3.3 test suite results.
# - On FAIL: route each FAIL [CRITERION-N] back to a workflow:executor operating
#   on the integration branch (same fix-loop used for [ISSUE-N] findings); then
#   re-run the test suite (Phase 3.3) and re-run spec_conformance. Repeat until PASS.
# - On PASS: set_gate("spec_conformance", "passed") and advance to Phase 3.5
#   (create integration PR) and then Phase 4 (post-merge review).
```

## Phase 4: Post-Merge Review (mandatory in thorough)

After Phase 3 closes with all components merged and integration tests green,
the supervisor MUST invoke the fan-out review engine. The full protocol is
defined in `skills/phases/post-merge-review/SKILL.md`; follow it verbatim.

In summary:

1. Build an N-lens roster (core lenses: functional-completeness, security,
   code-quality; add extended lenses — performance, data-integrity, API-contract,
   etc. — scaled to the change profile and remaining quota).
2. Spawn the full roster in parallel (`run_in_background=true`, opus tier);
   each lens reports **every** candidate finding against
   `state.workflow.description` + `state.architecture.components` +
   `state.components` (per-component plans). Lenses do not emit a verdict.
3. Loop-until-dry: keep spawning fresh roster rounds until K=2 consecutive
   rounds surface no new findings (dedup on file+line+claim).
4. Adversarially verify every fresh finding with ≥3 independent skeptics
   (correctness, reachability, reproduction); a finding is confirmed only on a
   majority of CONFIRMED votes.
5. Route confirmed findings to `workflow:executor` for fixes; after each
   Fix-Report, **re-run the entire engine from Step 1** (fixed point). Reset
   seen/dry; keep the all-time confirmed log for the audit trail.
6. The gate passes only when a complete find→verify cycle yields zero confirmed
   findings, K dry rounds in a row. On `MAX_FIX_CYCLES` exhaustion: pause and
   surface the still-confirmed items to the user — do not auto-pass.
7. Write the full audit trail to `<id>.review.md`; mark
   `gates.post_merge_review.status = "passed"`; advance to `completion_guard`.

This phase is **zero-tolerance**: a single confirmed finding blocks the gate.
The fan-out engine's adversarial verification ensures the gate is both
exhaustive and trustworthy — it does not cry wolf on noise, but it does not
let real gaps through.

## State Update Pattern

After EVERY significant action, update the state:
- Component started → update component status + started_at
- Component completed → update status + completed_at + pr_url
- Rate limit hit → update phase.rate_limit
- Merge completed → update integration.merged list
- Gate passed → update gates object

Use Read + Edit on the state.json file. Also update the org/md file for human readability.
