# Workflow Orchestrator

Start an automated development workflow with configurable execution modes and planning styles.

## AGENTIC MODE ACTIVE

This workflow runs in **fully autonomous agentic mode**. Do NOT ask for permission on non-destructive operations.

> **REQUIRED:** The project MUST have `Bash(*)` in its permissions allow list.
> Without this, bash commands will prompt for permission and break autonomous execution.
> Run `/workflow:setup` or copy settings: `cp ~/.claude/plugins/workflow/resources/recommended-settings.json .claude/settings.local.json`

### CRITICAL: Never Use `~` in Tool Calls

The Write, Read, Glob, and Edit tools do NOT expand `~`. You MUST run `echo $HOME` first and use the absolute path in ALL tool calls.

- ❌ `Write(file_path="~/.claude/workflows/...")` → **WILL FAIL**
- ❌ `Glob(pattern="~/.claude/workflows/*")` → **WILL FAIL**
- ❌ `Read(file_path="~/.claude/workflows/...")` → **WILL FAIL**
- ✅ `Write(file_path="/home/zashboy/.claude/workflows/...")` → WORKS

**Wherever this document references `~/.claude/...` paths, you MUST substitute the actual absolute home path.**

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
/workflow:start <type> <description> [--mode=<mode>] [--style=<style>] [--format=<format>]
```

## Available Workflow Types
- `feature` - Full feature development (plan → implement → review → security → test)
- `bugfix` - Bug investigation and fix pipeline
- `refactor` - Code refactoring with safety checks
- `epic` - Multi-component project orchestration (worktree isolation, PR per component, dependency-ordered integration)

## Execution Modes

| Mode | Description | Primary Model | Review Depth |
|------|-------------|---------------|--------------|
| `standard` | Balanced approach (default) | sonnet | 1 code + 1 security |
| `turbo` | Maximum speed | haiku | Advisory only |
| `eco` | Token-efficient | haiku | 1 code review |
| `thorough` | Maximum quality | opus (reviews) | Multi-gate chain |
| `swarm` | Maximum parallelism | opus (validation) | 3-architect competitive |

## Planning Styles

| Style | State Storage | Use Case |
|-------|---------------|----------|
| `full` | State file (default) | Complex features, audit trail, user-editable |
| `light` | JSON file | Quick fixes, simple tasks, minimal overhead |

## State File Formats

| Format | Extension | Use Case |
|--------|-----------|----------|
| `org` | `.org` (default) | Emacs org-mode, structured sections, collapsible |
| `md` | `.md` | Markdown, GitHub-friendly, easier to read |

**Note:** Both formats support the same features. Choose based on your editor preference.

## Examples
```
/workflow:start feature Add user authentication with JWT tokens
/workflow:start bugfix Fix race condition in payment --mode=thorough
/workflow:start refactor Extract validation logic --mode=eco --style=light
/workflow:start feature swarm: Build complete notification system with email, SMS, push
/workflow:start feature Implement user management --mode=swarm
/workflow:start feature Add API endpoint --format=md
/workflow:start epic Build a complete REST API with auth, CRUD, and real-time notifications
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

For long-running modes (swarm, thorough) or when the user's session already has significant context, launch the entire workflow as a subagent to get a fresh context window.

**When to launch as subagent:**
- `--fresh` or `--isolated` flag is present: always
- swarm or thorough mode: by default (these are most likely to hit limits)
- eco or turbo mode: run inline (short workflows, unlikely to hit limits)

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
active/.gitkeep, completed/.gitkeep, context/.gitkeep, memory/.gitkeep → under $HOME_PATH/.claude/workflows/
$HOME_PATH/.claude/plans/.gitkeep
```
If creation fails, STOP and tell user to run `/workflow:setup`.

**Step 0c:** Run `node -e "console.log(require('os').tmpdir())"` → store as `$TMPDIR_PATH`.

#### Step 1: Parse input

1. **Parse input**:
   - First word = workflow type (feature, bugfix, refactor, epic)
   - Look for `--mode=<mode>` flag (if present, skip mode auto-detection)
   - Look for `--style=<style>` flag (default: `full`)
   - Look for `--format=<format>` flag (default: `org`, options: `org`, `md`)
   - Rest = description
   - If type is missing or unknown: spawn `workflow:task-analyzer` to auto-detect both type AND mode (see Step 2)

#### Step 2: Auto-detect type and mode

   **Step 2a: Check for explicit keyword prefixes**
   ```
   thorough:, careful:, production: → thorough mode
   quick:, fast:, prototype: → turbo mode
   eco:, simple:, minor: → eco mode
   epic: → epic type (with thorough mode, mandatory)
   ```

   **Step 2b: If no prefix (or type not specified), analyze task**

   Spawn `workflow:task-analyzer` (haiku) with task description. Returns `recommended_type` (feature/bugfix/refactor/epic), `recommended_mode`, `confidence`, and `reasoning`.

   The task-analyzer detects epic type when the description implies multi-component scope (e.g., "build from scratch", "full application with X, Y, Z", 3+ distinct modules).

   **Step 2c: Present recommendation to user** — show type (if auto-detected), mode, confidence, reasoning, and offer `[Enter] Accept | [--type=X] [--mode=X] Override`.

   **Step 2d: Apply selected mode** — use recommendation if accepted, user override if specified. Log decision in workflow state.

#### Epic Type Special Handling

When type is `epic`:
- **Mode**: Always `thorough` (mandatory — cannot override with `--mode`)
- **Tests**: Always enabled (mandatory — skip test optionality question)
- **Branch**: Managed automatically (epic/{component_id} per component — skip branch question)
- **Template**: Use `templates/epic-development.<format>` instead of `templates/feature-development.<format>`
- **Initial phase**: `architecture` (not `planning`)
- **Phase order**: architecture → component_execution → integration → completion_guard

The JSON state sidecar uses an extended schema for epic workflows:
```json
{
  "$schema": "1.0.0",
  "workflow_id": "<id>",
  "org_file": "<path>",
  "workflow": { "type": "epic", "description": "<desc>", "branch": "main" },
  "mode": { "current": "thorough", "original": "thorough" },
  "config": {
    "tests_enabled": true,
    "max_parallel_components": 4,
    "max_code_review_iterations": 10,
    "max_security_iterations": 8
  },
  "phase": {
    "current": "architecture",
    "completed": [],
    "remaining": ["component_execution", "integration", "completion_guard"],
    "rate_limit": { "paused_at": null, "resumes_at": null, "cron_job_id": null, "reason": null }
  },
  "gates": {
    "architecture": { "status": "pending", "iteration": 0 },
    "component_execution": { "status": "pending", "iteration": 0 },
    "integration": { "status": "pending", "iteration": 0 },
    "completion_guard": { "status": "pending", "iteration": 0 }
  },
  "architecture": { "components": [], "dependency_order": [], "interfaces": {} },
  "components": {},
  "integration": { "branch": null, "merge_order": [], "merged": [], "conflicts_resolved": [], "test_results": null, "review_status": "pending", "pr_url": null, "status": "pending" },
  "agent_log": [],
  "updated_at": "<timestamp>"
}
```

#### Step 2.5: Test optionality

After mode is selected, determine test preference:

- **eco/turbo/standard mode**: Use `AskUserQuestion` to ask "Enable test writing?" Default: No
- **thorough mode**: Tests are mandatory. Inform the user: "Thorough mode requires tests — test writing enabled." Do NOT ask.
- **swarm mode**: Use `AskUserQuestion` to ask "Enable test writing?" Default: Yes

Store the result as `tests_enabled` (boolean) for JSON state creation.

3. **Load mode configuration**: Read `modes/<mode>.org` from the workflow plugin directory. Extract agent routing and settings.

4. **Ask about branch**: Suggest `feature/<short-description>` or `fix/<short-description>`, or use current branch.

5. **Create workflow state** (CRITICAL - use Write tool with ABSOLUTE paths):
   - Generate ID: `YYYYMMDD-<random>` (e.g., `20260204-a1b2c3`)
   - Use the home directory path from Step 0a (e.g., `/home/user`)

   **If style=full**:
   - Read template from plugin: `templates/<type>-development.<format>` (use `.org` or `.md` per format flag)
   - Replace placeholders: `{{WORKFLOW_ID}}`, `{{TITLE}}` (first 50 chars), `{{DESCRIPTION}}`, `{{DATE}}`, `{{TIMESTAMP}}`, `{{BRANCH}}`, `{{BASE_BRANCH}}`, `{{MODE}}`, `{{STATE_FILE}}` (Step 5b path), `{{TESTS_ENABLED}}`
   - Write to ABSOLUTE path: `<HOME>/.claude/workflows/active/<id>.<format>` — VERIFY by reading back

   **Step 5b: Create JSON state sidecar** (CRITICAL — enables hook enforcement):

   Write `<HOME>/.claude/workflows/active/<id>.state.json` — VERIFY by reading back.

   ```json
   {
     "$schema": "1.0.0",
     "workflow_id": "<id>",
     "org_file": "<HOME>/.claude/workflows/active/<id>.<format>",
     "workflow": { "type": "<feature|bugfix|refactor>", "description": "<desc>", "branch": "<branch>" },
     "mode": { "current": "<mode>", "original": "<mode>" },
     "config": { "tests_enabled": <bool>, "max_code_review_iterations": <n>, "max_security_iterations": <n> },
     "phase": { "current": "planning", "completed": [], "remaining": ["implementation","code_review","security_review","tests","quality_gate","completion_guard"] },
     "gates": {
       "planning": {"status":"pending","iteration":0}, "implementation": {"status":"pending","iteration":0},
       "code_review": {"status":"pending","iteration":0}, "security_review": {"status":"pending","iteration":0},
       "tests": {"status":"pending","iteration":0}, "quality_gate": {"status":"pending","iteration":0},
       "completion_guard": {"status":"pending","iteration":0}
     },
     "agent_log": [], "updated_at": "<ISO timestamp>"
   }
   ```

   If `tests_enabled === false`: set `gates.tests.status = "skipped"`, `reason = "tests_enabled=false"`, remove from `phase.remaining`.

   **Step 5c: Bind session to workflow** (enables multi-workflow sessions):

   Glob for `$TMPDIR_PATH/workflow-session-marker-*.json`, read the most recent to get `session_id`. Write `$TMPDIR_PATH/workflow-binding-{session_id}.json` with `{session_id, workflow_path, workflow_id, bound_at}` — verify by reading back. If no marker found, skip (hooks fall back to most recent workflow).

   **If style=light**: Write `$HOME_PATH/.claude/workflows/state.json`, use TodoWrite for step tracking.

6. **Run Codebase Analysis** (unless eco mode or context is fresh):
   Check if `<HOME>/.claude/workflows/context/<project-slug>.md` exists and is under 7 days old. If not, spawn `codebase-analyzer` agent. In eco mode, skip and use existing context if available.

7. **Load Project Memory** (lightweight, always run):
   Read `<HOME>/.claude/workflows/memory/<project-slug>.md` if it exists. Key learnings (~1-2k tokens): past decisions, codebase patterns, resolved issues, project conventions.

8. **Confirm with user**: show workflow ID + state location, mode, context file status (fresh/generated/skipped), ask "Ready to begin Step 1: Planning?"

### Agent Routing by Mode

Use the correct agent based on the mode:

| Phase | standard | turbo | eco | thorough | swarm |
|-------|----------|-------|-----|----------|-------|
| **Mode Detection** | workflow:task-analyzer | workflow:task-analyzer | workflow:task-analyzer | workflow:task-analyzer | workflow:task-analyzer |
| **Codebase Analysis** | workflow:codebase-analyzer | workflow:codebase-analyzer | skip | workflow:codebase-analyzer | workflow:codebase-analyzer |
| **Orchestration** | - | - | - | - | workflow:supervisor |
| Planning | Plan | workflow:architect-lite | workflow:architect-lite | workflow:architect | workflow:architect (opus) |
| **Decomposition** | - | - | - | - | workflow:supervisor |
| Implementation | workflow:executor | workflow:executor-lite | workflow:executor-lite | workflow:executor | workflow:executor ×4 (parallel) |
| Code Review | workflow:reviewer | workflow:reviewer-lite | workflow:reviewer-lite | workflow:reviewer-deep | workflow:reviewer-deep ×3 |
| Security | workflow:security | workflow:security-lite | workflow:security-lite | workflow:security-deep | workflow:security-deep (parallel) |
| Quality Review | - | - | - | - | workflow:reviewer-deep (parallel) |
| **Quality Gate** | workflow:quality-gate | workflow:quality-gate | workflow:quality-gate | workflow:quality-gate | workflow:quality-gate |
| **Completion Guard** | workflow:completion-guard | workflow:completion-guard | workflow:completion-guard | workflow:completion-guard (opus) | workflow:completion-guard (opus) |
| Testing | workflow:test-writer | - | - | workflow:test-writer | workflow:test-writer (parallel) |
| Performance | - | - | - | workflow:perf-reviewer | workflow:perf-reviewer |
| Documentation | - | - | - | workflow:doc-writer | workflow:doc-writer |

#### Epic Workflow Routing

Epic workflows use a different phase sequence:

| Phase | Agent | Model |
|-------|-------|-------|
| Architecture | workflow:architect | opus |
| Component execution | (full sub-workflow per component — see epic-orchestration skill) | thorough mode |
| Integration | workflow:epic-integrator | sonnet |
| Integration review | workflow:reviewer-deep + workflow:security-deep | opus |
| Completion guard | workflow:completion-guard | opus |

The epic orchestrator loads `skills/phases/epic-orchestration` for the full execution flow.

### Model Selection

Always specify `model=` when spawning agents. Suffix maps to model: `-lite` → haiku, (standard) → sonnet, `-deep` → opus.

### Codebase Context Injection

All agents receive a **reference** to the codebase context file — never embed its contents inline.

```
Include in every agent prompt:
---
## Codebase Context
Read the context file at: <HOME>/.claude/workflows/context/<project-slug>.md
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
  Read: <HOME>/.claude/workflows/context/<project>.md
  Focus on: [relevant sections]
  ## Task
  {phase-specific instructions}
  """
)
```

### Parallel Execution

Use parallel Agent calls where phases are independent. Parallelize: code review + security scan (turbo/standard), perf + doc advisory checks (thorough), independent file implementations. Do NOT parallelize: implementation before review, security before code review in thorough mode (may depend on fixes), dependent file changes.

Background pattern:
```python
agent1 = Agent(subagent_type="workflow:reviewer", run_in_background=true, ...)
agent2 = Agent(subagent_type="workflow:security", run_in_background=true, ...)
result1 = TaskOutput(task_id=agent1.id)
result2 = TaskOutput(task_id=agent2.id)
```

### Context Limit Recovery

If agent output signals exhaustion (empty, truncated, or contains "context limit"): assess completed objectives in state file (`[x]` vs `[ ]`), spawn a NEW agent with remaining objectives + 2-3 sentence summary + context file path. Track continuation count in state. Max continuations from mode config `MAX_CONTINUATIONS` (default: 3); if exhausted, break into sub-steps or pause. See `resources/context-resilience.md` for spawn template.

### Review Gates by Mode

| Mode | Code Review | Security | Quality Gate | Completion |
|------|------------|----------|-------------|------------|
| eco | blocking, iterate until PASS | blocking, iterate until PASS | mandatory (build+lint) | mandatory |
| turbo | blocking, iterate until PASS | blocking, iterate until PASS | mandatory (abbreviated) | mandatory |
| standard | blocking, iterate until PASS | blocking, iterate until PASS | mandatory (full) | mandatory |
| thorough | blocking, iterate until PASS (opus) | blocking, iterate until PASS (opus) | mandatory (full) | mandatory (opus) |
| swarm | 3-architect parallel (all must pass) | included in architects | mandatory | mandatory (opus) |

**Zero tolerance:** ALL gates must PASS. No exceptions, no partial passes, no scope reduction. Iterate until done - do not stop because iteration count is high.
Review agents know the verdict format and rules via their loaded `phases/review` skill.

#### Swarm Mode Validation

In swarm mode, the supervisor agent orchestrates 3-architect parallel validation:
1. Architect 1: Functional completeness (opus)
2. Architect 2: Security (security-deep/opus)
3. Architect 3: Code quality (reviewer-deep/opus)

All three must PASS. Max 3 retry cycles. See `agents/supervisor.md` for full orchestration details.

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
2. If CHANGES_MADE in output: spawn reviewer-lite for targeted review of changed files
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

### Light Style (JSON State)

When `--style=light` is used:

1. Use `<HOME>/.claude/workflows/state.json` instead of org files
2. Use TodoWrite tool for step tracking
3. Skip org file creation
4. State structure:

```json
{
  "active_workflow": {
    "id": "20240115-abc123",
    "type": "bugfix",
    "description": "Fix login validation",
    "mode": "eco",
    "style": "light",
    "current_step": "implementation",
    "started_at": "2024-01-15T14:30:00Z",
    "steps": {
      "planning": { "status": "completed", "agent": "architect-lite" },
      "implementation": { "status": "in_progress", "agent": "executor-lite" }
    }
  }
}
```

### Completion

When all gates pass:
1. Update state: fill Completion Summary, set COMPLETED_AT, calculate TOTAL_DURATION
2. Generate summary for user (mode, files changed, review iterations, warnings)
3. Save learnings to `<HOME>/.claude/workflows/memory/<project-slug>.md` (completion-guard agent handles this via its skill)
4. **Offer live testing** if the completion guard detected web-facing file changes — surface the `/workflow:test-live` suggestion with pre-filled URL if detectable
5. Ask about commit (suggest message based on work done)
6. Clean up session temp files from `$TMPDIR_PATH` (workflow-session-marker, workflow-binding, workflow-stop, workflow-deny, workflow-complete files) — use the session_id from Step 5c; skip if none found
7. Archive: update JSON state to `completed`, move org/md + state.json from `active/` to `completed/`

### Error Handling

If a subagent fails or returns unexpected results:

1. **Don't panic** - Report the issue clearly
2. **Update state** with error details
3. **Ask user** how to proceed:
   - Retry the step?
   - Skip and continue?
   - Pause for manual intervention?

### State File Locations

- Mode configs: `modes/` in plugin directory
- Templates: `templates/` in plugin directory (both `.org` and `.md` formats)
- **Active state files**: `<HOME>/.claude/workflows/active/<id>.org` or `<id>.md`
- JSON state (light style): `<HOME>/.claude/workflows/state.json`
- Completed: `<HOME>/.claude/workflows/completed/`
- Codebase context: `<HOME>/.claude/workflows/context/`
- **Project memory**: `<HOME>/.claude/workflows/memory/`
- Learned skills: `<HOME>/.claude/skills/learned/`
- Hook logs: `<HOME>/.claude/workflows/hook.log`

**Note:** `<HOME>` = absolute home path from `echo $HOME`. Never use `~` in tool calls.

### File Format Reference

`.org` (default): Emacs org-mode — collapsible sections, property drawers, TODO states.
`.md`: GitHub-compatible, readable in any editor.

### Agent Reference

See `agents/` directory for full agent definitions.
See `resources/mode-routing.md` for detailed routing guide.
See `resources/subagent-prompts.md` for subagent prompt templates.

---

Begin by parsing the input, determining mode and style, and asking about branch strategy.
