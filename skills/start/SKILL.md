# Workflow Orchestrator

Start a long-running autonomous workflow (swarm or epic). Native Claude prompting handles small tasks — this skill is for work that warrants a full autonomous execution pipeline.

## AGENTIC MODE ACTIVE

This workflow runs in **fully autonomous agentic mode**. Do NOT ask for permission on non-destructive operations.

> **REQUIRED:** The project MUST have `Bash(*)` in its permissions allow list.
> Without this, bash commands will prompt for permission and break autonomous execution.
> Run `/workflow:setup` or copy settings: `cp ~/.claude/plugins/workflow/resources/recommended-settings.json .claude/settings.local.json`

### CRITICAL: Never Use `~` in Tool Calls

The Write, Read, Glob, and Edit tools do NOT expand `~`. You MUST run `echo $HOME` first and use the absolute path in ALL tool calls.

- `Write(file_path="~/.claude-workflows/...")` → **WILL FAIL**
- `Glob(pattern="~/.claude-workflows/*")` → **WILL FAIL**
- `Read(file_path="~/.claude-workflows/...")` → **WILL FAIL**
- `Write(file_path="<HOME>/.claude-workflows/active/<repo-key>/...")` → WORKS

**Wherever this document references `~/.claude/...` paths, you MUST substitute the actual absolute home path.**

### CRITICAL: Workflows are repo-scoped

Workflow state lives under `<state-root>/active/<repo-key>/` where `<repo-key>` is
derived from the current repo's git remote (or its toplevel path). This keeps
workflows in different repos isolated from each other.

**Always resolve `<ACTIVE_DIR>` before reading or writing state files.** Use the
plugin helper (Step 0d below) — never hardcode a repo-key, never write to the
flat `<state-root>/active/` root for new workflows.

### Permission Model

**DO WITHOUT ASKING (autonomous):**
- Read any file in the project
- Write/Edit files in the project
- Create directories
- Create feature branches (`git checkout -b`, `git switch -c`)
- Run validation commands (`php -l`, `npm run lint`, `tsc --noEmit`)
- Run build commands (`npm run build`, `composer install`)
- Run test suites (`npm test`, `phpunit`, `pytest`)
- Spawn subagents via Agent tool
- File operations (`mkdir`, `cp`, `mv` within project)
- Git operations (`git add`, `git status`, `git diff`, `git stash`)

**ASK BEFORE (requires user confirmation):**
- `git commit` - User reviews and commits
- `git push` - User pushes when ready
- Deleting files (`rm`) - Confirm before removal
- Operations outside project directory

**ALWAYS BLOCKED:**
- `rm -rf` on directories
- `git reset --hard`
- `git push --force`
- System file modifications
- Package publishing

### Autonomous Execution Principle

**CRITICAL:** During workflow execution, proceed autonomously through all phases without stopping to ask "Should I continue?" or "Is this okay?" for routine operations. The user has already approved the workflow by starting it.

Only pause for:
1. Explicit user intervention (they type something)
2. Review gate failures after max iterations
3. Truly destructive operations
4. Ambiguous requirements needing clarification

**Best Practice:** Work incrementally, validate often, keep state updated.

---

## Usage
```
/workflow:start <description> [--format=<format>]
```

## Workflow Types

There are two execution paths — the architect phase decides **deterministically**
from its own decomposition (it never asks the user):

- **swarm** — single-worktree parallel execution (executor batches in one tree, one PR).
- **epic** — multi-worktree orchestration: one worktree + PR per component, dependency-ordered integration.

**Decision rule (over the architect's decomposition).** Run the component
decomposition first — even for candidate-swarm tasks — producing file scopes, a
dependency DAG, `dependency_order` waves, and per-component complexity (see
`skills/phases/epic-orchestration/SKILL.md`). Then choose **epic** if ANY hold:
component count ≥ 3 · the dependency DAG has more than one wave · ≥ 2 components
with disjoint file scopes that map cleanly to separate PRs. Otherwise **swarm**
(one component, or several with shared/overlapping scope and a single wave). The
architect returns `execution_path: "swarm" | "epic"` plus a one-line `reasoning`,
persisted to `state.architecture.execution_path`; the supervisor routes on it
without re-asking. The scrub gate adapts: epic scrubs before *each* component PR
and the integration PR; swarm scrubs once before its commit/PR.

## State File Formats

| Format | Extension | Use Case |
|--------|-----------|----------|
| `org` | `.org` (default) | Emacs org-mode, structured sections, collapsible |
| `md` | `.md` | Markdown, GitHub-friendly, easier to read |

**Note:** Both formats support the same features. Choose based on your editor preference.

## Examples
```
/workflow:start Add user authentication with JWT tokens
/workflow:start Fix race condition in payment processing
/workflow:start Build a complete REST API with auth, CRUD, and real-time notifications
/workflow:start Add API endpoint --format=md
```

## Input
$ARGUMENTS

---

## Supervisor Instructions

You are the **supervisor agent** for this workflow. You coordinate the entire process, spawn subagents for each phase, and can receive instructions from the user at any time.

### Key Principles

1. **You control the flow** - You decide when to proceed, loop back, or pause
2. **User can intervene** - If user types anything, prioritize their input
3. **State file is source of truth** - Always update and read from state (org or JSON)
4. **Be transparent** - Report progress clearly after each step
5. **Route agents by mode** - Use the correct agent tier for the selected mode

### Fresh Context Launch (Optional)

For long workflows or when the user's session already has significant context, launch the entire workflow as a subagent to get a fresh context window.

**When to launch as subagent:**
- `--fresh` or `--isolated` flag is present: always
- epic workflows: by default (most likely to hit context limits)
- swarm workflows: run inline unless context is already heavy

**Launch pattern:**
```python
# Parent session launches workflow in fresh context
Agent(
    subagent_type="general-purpose",
    model="sonnet",
    max_turns=50,
    run_in_background=true,
    prompt=f"""
    You are running a workflow. Follow the instructions in:
    <HOME>/.claude/plugins/workflow/skills/start/SKILL.md

    User's task: {original_task}
    Arguments: {workflow_args}
    """
)
# Parent monitors via TaskOutput and reports progress to user
```

The parent session only launches and relays results. For interactive control (pausing between steps), skip the subagent launch and run inline.

### Initialization

**IMPORTANT:** Follow these steps in order. Do NOT skip the directory initialization.

#### Step 0: Pre-flight Directory Check (CRITICAL)

**BEFORE doing anything else**, ensure workflow directories exist.

**Step 0a:** Run `echo $HOME` → store result as `$HOME_PATH` for ALL tool calls (never use `~`).

**Step 0b:** Create workflow directories using Write tool with absolute paths:
```
active/.gitkeep, completed/.gitkeep, context/.gitkeep → under $HOME_PATH/.claude-workflows/
$HOME_PATH/.claude-workflows/plans/.gitkeep
```
If creation fails, STOP and tell user to run `/workflow:setup`.

**Step 0c:** Run `node -e "console.log(require('os').tmpdir())"` → store as `$TMPDIR_PATH`.

**Step 0d (CRITICAL — repo-scoped active dir):** Resolve the per-repo active
directory by invoking the plugin helper:

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/workflow}"
ACTIVE_DIR=$(node "$PLUGIN_ROOT/lib/active-dir-cli.js")
REPO_KEY=$(node "$PLUGIN_ROOT/lib/repo-key-cli.js")
REPO_ROOT=$(node -e "console.log(require('$PLUGIN_ROOT/lib/repo-key').getRepoRoot())")
echo "$ACTIVE_DIR | $REPO_KEY | $REPO_ROOT"
```

Store all three:
- `$ACTIVE_DIR` — the per-repo bucket; parent directory for ALL state files in
  this workflow. **Never** write a `.state.json` to the flat `active/` root —
  the hooks reject it and unscoped files leak into every repo's session.
- `$REPO_KEY` and `$REPO_ROOT` — stamped into the state object at Step 5b so the
  workflow is self-describing and matchable across machines and symlinked
  checkouts. The helper auto-creates the directory and honors
  `CLAUDE_WORKFLOW_STATE_DIR` / `CLAUDE_WORKFLOW_REPO_KEY`.

If the helper cannot be found, fix `$CLAUDE_PLUGIN_ROOT` and retry. **Do NOT
hand-derive the key in bash** — a bash hash without `realpath` normalization
diverges from the resolver and produces a second key for the same repo (the
symlink/cross-machine mismatch). The Node resolver is the single source of truth.

#### Step 1: Parse input

1. **Parse input**:
   - Look for `--format=<format>` flag (default: `org`, options: `org`, `md`)
   - Everything else = description
   - The architect phase runs the component decomposition and applies the deterministic **Decision rule** (see "Workflow Types" above) to set `execution_path: swarm|epic` + `reasoning` in `state.architecture`; do not ask the user

#### Epic Workflow Special Handling

When the architect selects the **epic** execution path:
- **Tests**: Always enabled (mandatory — skip test optionality question)
- **Branch**: Managed automatically (epic/{component_id} per component — skip branch question)
- **Template**: Use `templates/epic-development.<format>`
- **Initial phase**: `architecture` (not `planning`)
- **Phase order**: architecture → component_execution → integration → **post_merge_review** → completion_guard

The `post_merge_review` phase invokes the fan-out review engine defined in
`skills/phases/post-merge-review/SKILL.md` — an N-lens roster (functional
completeness, security, code-quality, plus extended lenses scaled to the change
profile) runs in parallel, adversarially verifies every finding with ≥3
independent skeptics, routes confirmed issues to an executor, and loops until a
complete dry cycle yields zero confirmed findings.

For swarm workflows, `post_merge_review` is **not** inserted by default (it is part of the epic phase sequence only).

The JSON state sidecar uses an extended schema for epic workflows:
```json
{
  "$schema": "1.0.0",
  "workflow_id": "<id>",
  "repo_key": "<REPO_KEY>",
  "repo_root": "<REPO_ROOT>",
  "org_file": "<path>",
  "workflow": { "type": "epic", "description": "<desc>", "branch": "main" },
  "mode": { "current": "epic", "original": "epic" },
  "config": {
    "tests_enabled": true,
    "max_parallel_components": 4,
    "max_code_review_iterations": 10,
    "max_security_iterations": 8
  },
  "phase": {
    "current": "architecture",
    "completed": [],
    "remaining": ["component_execution", "integration", "post_merge_review", "e2e_validation", "scrub_gate", "completion_guard"],
    "rate_limit": { "paused_at": null, "resumes_at": null, "cron_job_id": null, "reason": null, "workflow_phase": null }
  },
  "gates": {
    "architecture": { "status": "pending", "iteration": 0 },
    "component_execution": { "status": "pending", "iteration": 0 },
    "integration": { "status": "pending", "iteration": 0 },
    "post_merge_review": { "status": "pending", "iteration": 0, "verdicts": { "functional": null, "security": null, "quality": null } },
    "e2e_validation": { "status": "pending", "iteration": 0 },
    "scrub_gate": { "status": "pending", "iteration": 0 },
    "completion_guard": { "status": "pending", "iteration": 0 }
  },
  "architecture": { "components": [], "dependency_order": [], "interfaces": {} },
  "components": {},
  "integration": { "branch": null, "merge_order": [], "merged": [], "conflicts_resolved": [], "test_results": null, "review_status": "pending", "pr_url": null, "status": "pending" },
  "agent_log": [],
  "updated_at": "<timestamp>"
}
```

#### Step 2: Test optionality

Determine test preference:

- **swarm workflow**: Use `AskUserQuestion` to ask "Enable test writing?" Default: Yes
- **epic workflow**: Tests are always enabled (mandatory — do NOT ask)

Store the result as `tests_enabled` (boolean) for JSON state creation.

3. **Ask about branch**: Suggest `feature/<short-description>` or `fix/<short-description>`, or use current branch.

5. **Create workflow state** (CRITICAL - use Write tool with ABSOLUTE paths):
   - Generate ID: `YYYYMMDD-<random>` (e.g., `20260204-a1b2c3`)
   - Use the home directory path from Step 0a (e.g., `/home/user`)
   - Use `$ACTIVE_DIR` from Step 0d as the parent for the org and state files
   - Read template from plugin: `templates/epic-development.<format>` for epic workflows, `templates/swarm-development.<format>` for swarm workflows (use `.org` or `.md` per format flag)
   - Replace placeholders: `{{WORKFLOW_ID}}`, `{{TITLE}}` (first 50 chars), `{{DESCRIPTION}}`, `{{DATE}}`, `{{TIMESTAMP}}`, `{{BRANCH}}`, `{{BASE_BRANCH}}`, `{{STATE_FILE}}` (Step 5b path), `{{TESTS_ENABLED}}`
   - Write to ABSOLUTE path: `$ACTIVE_DIR/<id>.<format>` — VERIFY by reading back

   **Step 5b: Create JSON state sidecar** (CRITICAL — enables hook enforcement):

   Write `$ACTIVE_DIR/<id>.state.json` — VERIFY by reading back.

   ```json
   {
     "$schema": "1.0.0",
     "workflow_id": "<id>",
     "repo_key": "<REPO_KEY>",
     "repo_root": "<REPO_ROOT>",
     "org_file": "<ACTIVE_DIR>/<id>.<format>",
     "workflow": { "type": "<swarm|epic>", "description": "<desc>", "branch": "<branch>" },
     "config": { "tests_enabled": <bool>, "max_code_review_iterations": <n>, "max_security_iterations": <n> },
     "phase": { "current": "planning", "completed": [], "remaining": ["implementation","code_review","security_review","tests","quality_gate","e2e_validation","scrub_gate","completion_guard"] },
     "gates": {
       "planning": {"status":"pending","iteration":0}, "implementation": {"status":"pending","iteration":0},
       "code_review": {"status":"pending","iteration":0}, "security_review": {"status":"pending","iteration":0},
       "tests": {"status":"pending","iteration":0}, "quality_gate": {"status":"pending","iteration":0},
       "e2e_validation": {"status":"pending","iteration":0},
       "scrub_gate": {"status":"pending","iteration":0},
       "completion_guard": {"status":"pending","iteration":0}
     },
     "agent_log": [], "updated_at": "<ISO timestamp>"
   }
   ```

   If `tests_enabled === false`: set `gates.tests.status = "skipped"`, `reason = "tests_enabled=false"`, remove from `phase.remaining`.

   The `e2e_validation` gate is created `pending`. Its skip-or-run decision is
   made later, at the **E2E Validation phase** (after implementation, when a real
   diff exists) — see that phase below.

   **Step 5c: Bind session to workflow** (enables multi-workflow sessions):

   Glob for `$TMPDIR_PATH/workflow-session-marker-*.json`, read the most recent to get `session_id`. Write `$TMPDIR_PATH/workflow-binding-{session_id}.json` with `{session_id, workflow_path, workflow_id, bound_at}` — verify by reading back. If no marker found, skip (hooks fall back to most recent workflow).

6. **Run Codebase Analysis** (unless context is fresh):
   Check if `<HOME>/.claude-workflows/context/<project-slug>.md` exists and is under 7 days old. If not, spawn `codebase-analyzer` agent.

7. **Confirm with user**: show workflow ID + state location, execution path (swarm/epic), context file status (fresh/generated/skipped), ask "Ready to begin Step 1: Planning?"

### Agent Routing

#### Swarm Workflow Agent Routing

| Phase | Agent | Notes |
|-------|-------|-------|
| Codebase Analysis | workflow:codebase-analyzer | Skip if context is fresh |
| Orchestration | workflow:supervisor | |
| Planning / Decomposition | workflow:architect (opus) | |
| Implementation | workflow:executor ×4 | Parallel |
| Code Review | workflow:reviewer-deep ×3 | All must pass |
| Security | workflow:security-deep | Parallel |
| Quality Review | workflow:reviewer-deep | Parallel |
| Quality Gate | workflow:quality-gate | |
| Completion Guard | workflow:completion-guard (opus) | |
| Testing | workflow:test-writer | Parallel, if enabled |

#### Epic Workflow Routing

Epic workflows use a different phase sequence:

| Phase | Agent | Model |
|-------|-------|-------|
| Architecture | workflow:architect | opus |
| Component execution | (full sub-workflow per component — see epic-orchestration skill) | opus |
| Integration | workflow:epic-integrator | sonnet |
| Integration review | workflow:reviewer-deep + workflow:security-deep | opus |
| Completion guard | workflow:completion-guard | opus |

The epic orchestrator loads `skills/phases/epic-orchestration` for the full execution flow.

### Model Selection

Always specify `model=` when spawning agents. Suffix maps to model: (no suffix) → sonnet, `-deep` → opus.

### Codebase Context Injection

All agents receive a **reference** to the codebase context file — never embed its contents inline.

```
Include in every agent prompt:
---
## Codebase Context
Read the context file at: <HOME>/.claude-workflows/context/<project-slug>.md
Focus on: [list relevant sections for this task, e.g., "Naming Conventions, Testing Patterns"]
---
```

**Why reference, not embed:** Each agent reads only what it needs in its own context window. Supervisor context stays lean across many agent spawns.

### MANDATORY: State File Updates

The state file (`.org` or `.md`) is the source of truth. Update it BEFORE (set in-progress) and AFTER (write output, check off objectives, set COMPLETED_AT) every step. After planning, write the FULL plan (files, steps, strategy, risks). After reviews, record findings and verdicts. On any error, log it. Use the Edit tool for targeted updates, Write for larger section replacements. **NEVER skip state updates.**

Also update the JSON sidecar (`<id>.state.json`) after each phase: set `gates.<phase>.status`, increment `gates.<phase>.iteration`, update `phase.current`, `phase.completed`, `phase.remaining`, and `updated_at`.

### Step Execution Pattern

For each phase: read state → look up agent+model → update state to in-progress → report to user → spawn agent → capture output → update state to complete → report to user → check for user input.

Agent spawn template:
```
Agent(
  subagent_type=<from routing table>,
  model=<from mode>,
  prompt="""
  Workflow ID: {workflow_id}
  ## Codebase Context
  Read: <HOME>/.claude-workflows/context/<project>.md
  Focus on: [relevant sections]
  ## Task
  {phase-specific instructions}
  """
)
```

### Parallel Execution

Use parallel Agent calls where phases are independent. Parallelize: code review + security scan, independent file implementations. Do NOT parallelize: implementation before review, security before code review (may depend on fixes), dependent file changes.

Background pattern:
```python
agent1 = Agent(subagent_type="workflow:reviewer-deep", run_in_background=true, ...)
agent2 = Agent(subagent_type="workflow:security-deep", run_in_background=true, ...)
result1 = TaskOutput(task_id=agent1.id)
result2 = TaskOutput(task_id=agent2.id)
```

### Context Limit Recovery

If agent output signals exhaustion (empty, truncated, or contains "context limit"): assess completed objectives in state file (`[x]` vs `[ ]`), spawn a NEW agent with remaining objectives + 2-3 sentence summary + context file path. Track continuation count in state. Max continuations from mode config `MAX_CONTINUATIONS` (default: 3); if exhausted, break into sub-steps or pause. See `resources/context-resilience.md` for spawn template.

### Review Gates

**Zero tolerance:** ALL gates must PASS. No exceptions, no partial passes, no scope reduction. Iterate until done - do not stop because iteration count is high.
Review agents know the verdict format and rules via their loaded `phases/review` skill.

All workflows use blocking gates: code review → security review → quality gate → e2e validation (FE-facing only) → completion guard. All must pass before proceeding.

#### Swarm Validation

The supervisor agent invokes the fan-out review engine
(`skills/phases/post-merge-review/SKILL.md`), which spawns an N-lens roster in
parallel, adversarially verifies every finding (≥3 skeptics, majority vote),
routes confirmed issues to the executor, and re-runs the full find→verify loop
until a complete dry cycle yields zero confirmed findings. See
`agents/supervisor.md` for full orchestration details.

#### E2E Validation Gate (FE-facing changes)

After the quality gate and before completion, run the **E2E validation gate** —
but only when the change is front-end-facing:

1. Detect FE-facing changes on the actual diff:
   ```bash
   node "$PLUGIN_ROOT/lib/fe-detect-cli.js" --git "$BASE_BRANCH"
   ```
   (true when the diff touches routes / components / templates / styles / assets /
   FE build config).
2. If `fe_facing` is **false**: set `gates.e2e_validation.status = "skipped"`,
   `reason = "no FE-facing changes"`, remove it from `phase.remaining`, advance.
3. If `fe_facing` is **true**: run the E2E flow as a blocking gate — start (or
   reuse) the dev server, then spawn `workflow:e2e-explorer` →
   `workflow:e2e-generator` → `workflow:e2e-reviewer`. They drive the browser via
   the **tool-agnostic driver** (`resources/e2e/browser-driver.md`: Playwright MCP
   → Chrome DevTools MCP → tpmcp-ux_capture → local Playwright with
   `ignoreHTTPSErrors`). The `e2e-reviewer` run-and-fix loop must reach zero
   `[ISSUE-N]` findings; `workflow:e2e-reviewer` passing sets
   `gates.e2e_validation = passed` (via `AGENT_GATE_MAP`).

Because `e2e_validation` is in the phase order and `state.gates`, the
`stop-guard` / `task-completed-gate` hooks block completion until it is `passed`
or `skipped` — an FE-facing workflow cannot finish without it.

#### Scrub Gate (before any public-repo write)

After the E2E gate and before completion, the **scrub gate** runs before any
commit/branch/PR/push crosses into a non-private repo:

1. Resolve the target (push) repo's visibility:
   ```bash
   gh repo view <target_repo> --json visibility,isPrivate
   ```
2. If the target is **PRIVATE**: set `gates.scrub_gate.status = "skipped"`,
   `reason = "target repo is private"`, remove it from `phase.remaining`, advance.
3. If the target is **PUBLIC or INTERNAL**: scan the crossing surface before pushing:
   ```bash
   node "$PLUGIN_ROOT/lib/scrub-cli.js" --git "$BASE_BRANCH" --denylist "$SCRUB_DENYLIST"
   ```
   (branch name + commit messages + diff + PR title/body + files, for internal
   markers — customer/project names, internal hostnames/flags, real IPs, secrets,
   AI-context files; the denylist lives in the **private control repo**). If
   markers are found, **do not push** — genericize/redact and re-run; set
   `gates.scrub_gate = passed` only on a clean scan. Forward-hygiene only — never
   history-rewrite.

Enforced **twice**: the `scrub_gate` state phase (which `stop-guard` /
`task-completed-gate` block on) **and** an unbypassable `PreToolUse` hook
(`hooks/scrub-guard.js`) that blocks any `git push` / `gh pr create` / GitHub-MCP
write to a non-private repo whose surface carries markers — so even a background
agent cannot leak. In **epic** mode the scrub runs before *each* component PR and
the integration PR; in **swarm**, once before the commit/PR.

### Phase Dispatch Pattern

The orchestrator dispatches each phase to the appropriate agent. Agents know HOW to execute their phase via their loaded skills. The orchestrator only provides WHAT (context data).

**For each phase:**
1. Read current phase from state file
2. Look up agent + model from routing table above
3. Spawn agent (no max_turns - let agents run until done):
   ```
   Agent(
     subagent_type=<from routing table>,
     model=<from mode>,
     prompt="""
     Workflow ID: {workflow_id}
     Project: {project_path}
     Changed files: {changed_files_list}
     Mode: {workflow_mode}

     [Phase-specific context below]
     """
   )
   ```
5. Capture output, update state file + JSON sidecar
6. If review FAIL: increment iteration, re-dispatch (see review loop below)
7. Advance to next phase

#### Epic Dispatch

For epic workflows, the dispatch is different from standard workflows:

1. **Architecture phase**: Spawn `workflow:architect` (opus) to decompose the project
2. **Component execution**: Follow the epic orchestration skill (`phases/epic-orchestration`) for worktree-based parallel execution with dependency ordering
3. **Integration**: Spawn `workflow:epic-integrator` to merge all component branches, then run integration review
4. **Completion guard**: Standard completion guard with full verification

The epic orchestrator skill handles rate limit detection, CronCreate scheduling, and cross-session resume.

**Review Loop (code review + security review):**
```
iteration = 0
escalated = false

loop:
    Spawn review agent with: iteration, previous_issues

    if PASS: mark complete, advance to next phase
    else:
        iteration++
        Spawn executor with review issues (executor knows fix protocol via skill)

        if iteration >= mode_config_soft_limit AND NOT escalated:
            escalated = true
            Switch to opus tier for both reviewer and executor
            Log: "Auto-escalating to opus after {iteration} iterations"

        Continue loop (iterate until PASS - no hard cap)
```

The mode config values (MAX_CODE_REVIEW_ITERATIONS, MAX_SECURITY_ITERATIONS) are **soft limits** that trigger auto-escalation to opus, NOT hard stops. The loop continues until PASS.

**Quality Gate → Completion Guard flow:**
1. Spawn quality-gate agent (knows its pipeline via skill)
2. If CHANGES_MADE in output: spawn reviewer-deep for targeted review of changed files
3. Spawn completion-guard agent (independently re-runs tests, verifies each requirement)
4. If REJECTED: fix → re-run quality-gate → re-run completion-guard
5. Iterate until APPROVED (no hard cap on retries)

### Handling User Intervention

If user types anything during the workflow:

1. **Pause current activity**
2. **Acknowledge**: "I see you have input. The workflow is at Step X."
3. **Process their instruction**:
   - If it's guidance: Incorporate into current/next step
   - If it's a correction: Update state, may need to redo step
   - If it's "pause" or "stop": Save state and wait
   - If it's a question: Answer it, then ask if ready to continue
   - If it's `/workflow:mode <mode>`: Switch mode for remaining steps
4. **Log intervention** in state
5. **Confirm** before resuming: "Understood. Should I continue with Step X?"

### Completion

When all gates pass:
1. Update state: fill Completion Summary, set COMPLETED_AT, calculate TOTAL_DURATION
2. Generate summary for user (execution path, files changed, review iterations, warnings)
3. FE-facing changes were already verified by the mandatory `e2e_validation` gate (above). Optionally offer ad-hoc interactive testing via `/workflow:test-live` with a pre-filled URL if one is detectable.
4. Ask about commit (suggest message based on work done)
5. Clean up session temp files from `$TMPDIR_PATH` (workflow-session-marker, workflow-binding, workflow-stop, workflow-deny, workflow-complete files) — use the session_id from Step 5c; skip if none found
6. Archive: update JSON state to `completed`, move org/md + state.json from `$ACTIVE_DIR` to the matching `completed/<repo-key>/` bucket (resolve via `node "$PLUGIN_ROOT/lib/repo-key-cli.js"` — keep the same `<repo-key>`, never the flat `completed/` root)

### Error Handling

If a subagent fails or returns unexpected results:

1. **Don't panic** - Report the issue clearly
2. **Update state** with error details
3. **Ask user** how to proceed:
   - Retry the step?
   - Skip and continue?
   - Pause for manual intervention?

### State File Locations

- Templates: `templates/` in plugin directory (both `.org` and `.md` formats)
- **Active state files**: `<HOME>/.claude-workflows/active/<repo-key>/<id>.org` or `<id>.md` (resolve `<repo-key>` via `$ACTIVE_DIR` from Step 0d)
- Completed: `<HOME>/.claude-workflows/completed/<repo-key>/`
- Codebase context: `<HOME>/.claude-workflows/context/`
- Hook logs: `<HOME>/.claude-workflows/hook.log`

**Note:** `<HOME>` = absolute home path from `echo $HOME`. Never use `~` in tool calls.

### File Format Reference

`.org` (default): Emacs org-mode — collapsible sections, property drawers, TODO states.
`.md`: GitHub-compatible, readable in any editor.

### Agent Reference

See `agents/` directory for full agent definitions.
See `resources/mode-routing.md` for detailed routing guide.
See `resources/subagent-prompts.md` for subagent prompt templates.

---

Begin by parsing the input and asking about branch strategy.
