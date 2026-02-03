# Workflow Orchestrator

Start an automated development workflow with configurable execution modes and planning styles.

## AGENTIC MODE ACTIVE

This workflow runs in **fully autonomous agentic mode**. Do NOT ask for permission on non-destructive operations.

> **Note:** For optimal autonomous execution, ensure the project has recommended permissions configured.
> See `resources/recommended-settings.json` or run:
> `cp ~/.claude/plugins/workflow/resources/recommended-settings.json .claude/settings.local.json`

### Permission Model

**DO WITHOUT ASKING (autonomous):**
- Read any file in the project
- Write/Edit files in the project
- Create directories
- Create feature branches (`git checkout -b`, `git switch -c`)
- Run validation commands (`php -l`, `npm run lint`, `tsc --noEmit`)
- Run build commands (`npm run build`, `composer install`)
- Run test suites (`npm test`, `phpunit`, `pytest`)
- Spawn subagents via Task tool
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
/workflow:start <type> <description> [--mode=<mode>] [--style=<style>]
```

## Available Workflow Types
- `feature` - Full feature development (plan → implement → review → security → test)
- `bugfix` - Bug investigation and fix pipeline
- `refactor` - Code refactoring with safety checks

## Execution Modes

| Mode | Description | Primary Model | Review Depth |
|------|-------------|---------------|--------------|
| `standard` | Balanced approach (default) | sonnet | 1 code + 1 security |
| `turbo` | Maximum speed | haiku | Advisory only |
| `eco` | Token-efficient | haiku | 1 code review |
| `thorough` | Maximum quality | opus (reviews) | Multi-gate chain |

## Planning Styles

| Style | State Storage | Use Case |
|-------|---------------|----------|
| `full` | Org file (default) | Complex features, audit trail |
| `light` | JSON file | Quick fixes, simple tasks |

## Examples
```
/workflow:start feature Add user authentication with JWT tokens
/workflow:start bugfix Fix race condition in payment --mode=thorough
/workflow:start refactor Extract validation logic --mode=eco --style=light
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

### Initialization

1. **Parse input**:
   - First word = workflow type
   - Look for `--mode=<mode>` flag (default: `standard`)
   - Look for `--style=<style>` flag (default: `full`)
   - Rest = description
   - If type unknown, list available types and ask

2. **Load mode configuration**:
   - Read `modes/<mode>.org` from the workflow plugin directory
   - Extract agent routing and settings
   - Apply to workflow execution

3. **Ask about branch**:
   - "Should I create a new branch for this work?"
   - Suggest: `feature/<short-description>` or `fix/<short-description>`
   - Or use current branch

4. **Create workflow state**:
   - Generate ID: `YYYYMMDD-<random>`
   - **If style=full**:
     - Find plugin templates in `templates/` directory
     - Copy template `<type>-development.org` to `~/.claude/workflows/active/<id>.org`
     - Add `#+MODE: <mode>` header
   - **If style=light**:
     - Create/update `~/.claude/workflows/state.json`
     - Use TodoWrite for step tracking

5. **Run Codebase Analysis** (unless eco mode or context is fresh):
   - Check if context file exists: `~/.claude/workflows/context/<project-slug>.md`
   - If missing or older than 7 days, run `codebase-analyzer` agent
   - Store context file for all subsequent agents to reference
   - In eco mode, skip analysis to save tokens (use existing context if available)

6. **Confirm with user**:
   - Show workflow ID and state location
   - Show selected mode and its implications
   - Show context file status (fresh/generated/skipped)
   - "Ready to begin Step 1: Planning?"

### Agent Routing by Mode

Use the correct agent based on the mode:

| Phase | standard | turbo | eco | thorough |
|-------|----------|-------|-----|----------|
| **Codebase Analysis** | codebase-analyzer | codebase-analyzer | skip | codebase-analyzer |
| Planning | Plan | architect-lite | architect-lite | architect |
| Implementation | focused-build | executor-lite | executor-lite | executor |
| Code Review | reviewer | reviewer-lite | reviewer-lite | reviewer-deep |
| Security | security | security-lite | security-lite | security-deep |
| Testing | test-writer | - | - | test-writer |
| Performance | - | - | - | perf-reviewer |
| Documentation | - | - | - | doc-writer |

### Model Selection

When spawning agents, specify the model:

```
Task(
  subagent_type="<agent>",
  model="<haiku|sonnet|opus>",  # Based on mode
  prompt=<instructions>
)
```

| Agent Suffix | Model |
|--------------|-------|
| `-lite` | haiku |
| (standard) | sonnet |
| `-deep` | opus |

### Codebase Context Injection

All agents receive the codebase context to ensure consistency:

```
Context file: ~/.claude/workflows/context/<project-slug>.md

Include in every agent prompt:
---
## Codebase Context
{contents of context file}
---
```

This ensures:
- Agents follow established naming conventions
- Architectural patterns are maintained
- Code style is consistent
- Testing patterns match existing tests

### Step Execution Pattern

For each step:

```
1. READ the step from state file (may have been modified by user)
2. LOAD codebase context from ~/.claude/workflows/context/<project>.md
3. UPDATE state: set STARTED_AT, STATUS: in-progress
4. REPORT to user: "Starting Step X: <name> (using <agent>)"
5. SPAWN subagent with mode-appropriate agent:
   Task(
     subagent_type=<agent from routing table>,
     model=<model from mode>,
     prompt="""
       ## Codebase Context
       {context_file_contents}

       ## Task
       {detailed instructions}
     """
   )
6. CAPTURE output from subagent
7. UPDATE state:
   - Write output to appropriate section
   - Check off completed objectives
   - Set COMPLETED_AT
   - Mark as DONE
8. REPORT to user: "Step X complete. <brief summary>"
9. CHECK for user input before proceeding
```

### Parallel Execution

**IMPORTANT:** Use parallel Task tool calls where phases are independent to maximize efficiency.

#### Parallel Opportunities

1. **Turbo/Standard Reviews** - Code review + Security scan (no dependencies):
   ```
   # Send BOTH in a single message with multiple Task calls:
   Task(subagent_type="reviewer-lite", prompt=..., run_in_background=true)
   Task(subagent_type="security-lite", prompt=..., run_in_background=true)
   # Then collect results from both
   ```

2. **Thorough Mode Advisory Checks** - Performance + Documentation (after gates pass):
   ```
   # These are advisory, run in parallel:
   Task(subagent_type="perf-reviewer", prompt=..., run_in_background=true)
   Task(subagent_type="doc-writer", prompt=..., run_in_background=true)
   ```

3. **Multi-file Implementation** - When plan has independent file changes:
   ```
   # If files are independent (e.g., new service + new test):
   Task(subagent_type="executor-lite", prompt="Implement service...", run_in_background=true)
   Task(subagent_type="executor-lite", prompt="Implement tests...", run_in_background=true)
   ```

#### When NOT to Parallelize

- Code review must complete before security review **in thorough mode** (security may depend on fixes)
- Implementation must complete before any review
- Test writing should follow implementation
- Dependent file changes (imports, shared state)

#### Background Agent Pattern

```python
# Launch parallel agents
agent1 = Task(subagent_type="reviewer", run_in_background=true, ...)
agent2 = Task(subagent_type="security", run_in_background=true, ...)

# Collect results (use TaskOutput or read output files)
result1 = TaskOutput(task_id=agent1.id)
result2 = TaskOutput(task_id=agent2.id)

# Process combined results
```

### Review Loops by Mode - MANDATORY QUALITY GATES

**CRITICAL:** Reviews are NOT optional. ALL gates must PASS before completion.

#### Standard Mode
- Code review: max 2 iterations, **BLOCKING**
- Security: max 1 iteration, **BLOCKING**
- Quality Gate: **MANDATORY** before completion
- Completion Guard: **MANDATORY** architect sign-off

#### Turbo Mode
- Code review: 1 iteration, **BLOCKING** (not advisory)
- Security: 1 iteration, **BLOCKING** (not advisory)
- Quality Gate: **MANDATORY** (abbreviated)
- Completion Guard: **MANDATORY** (quick check)

#### Eco Mode
- Code review: max 1 iteration, **BLOCKING**
- Security: 1 iteration, **BLOCKING**
- Quality Gate: **MANDATORY** (build + lint only)
- Completion Guard: **MANDATORY**

#### Thorough Mode
- Code review: max 3 iterations, **BLOCKING** (reviewer-deep)
- Security: max 2 iterations, **BLOCKING** (security-deep)
- Test coverage: 80% minimum, **BLOCKING**
- Quality Gate: **FULL** (all checks)
- Completion Guard: **FULL** verification with opus
- Performance: advisory (after all gates pass)
- Documentation: advisory (after all gates pass)

### Zero Tolerance Policy

**NEVER:**
- Skip review gates
- Accept "advisory" results as passes
- Allow partial completion
- Reduce scope to pass tests
- Delete failing tests
- Comment out problematic code

### Quality Gate Pipeline

After implementation, ALWAYS run:

```
Implementation Complete
        ↓
┌───────────────────────────────────────┐
│          QUALITY GATE                 │
│  (quality-gate agent - MANDATORY)     │
│                                       │
│  Build → Type → Lint → Test → Security│
│           ↓ FAIL                      │
│      Auto-fix loop (max 3)            │
└───────────────────────────────────────┘
        ↓ ALL PASS
┌───────────────────────────────────────┐
│        COMPLETION GUARD               │
│  (completion-guard agent - MANDATORY) │
│                                       │
│  ✓ Requirements verified              │
│  ✓ No incomplete code                 │
│  ✓ Build passes                       │
│  ✓ Tests pass                         │
│  ✓ TODO list complete (0 pending)     │
│  ✓ Quality gates passed               │
└───────────────────────────────────────┘
        ↓ APPROVED
    Workflow Complete

If REJECTED → Fix issues → Re-run guards (max 3)
```

### Review Loop Implementation

```
iteration = 0
max_iterations = <from mode config>

while iteration < max_iterations:
    Run review agent
    if verdict == PASS:
        Mark step complete
        break
    else:
        iteration++
        Update ITERATION in state
        Log in Review Log
        if iteration < max_iterations:
            Report: "Review found issues. Sending back to implementation."
            # Spawn executor to fix issues
            Task(
              subagent_type="workflow:executor",
              prompt="FIX: {review_issues}"
            )
        else:
            # MAX ITERATIONS REACHED - DO NOT SKIP
            Report: "Max review iterations reached. BLOCKING."
            Report: "Issues that could not be resolved:"
            List remaining issues
            Ask user: "Manual intervention required. Fix these issues and run /workflow:resume"
            PAUSE workflow - DO NOT CONTINUE
```

### Mandatory Quality Gate Invocation

After implementation phase, ALWAYS spawn quality-gate:

```
Task(
  subagent_type="workflow:quality-gate",
  model="sonnet",
  prompt="""
  QUALITY GATE CHECK

  Project: {project_path}
  Changed files: {changed_files}
  Mode: {workflow_mode}

  Run ALL applicable checks:
  - Build verification
  - Type checking
  - Lint checking
  - Test suite
  - Security scan

  Auto-fix issues up to 3 iterations.
  Report final verdict: PASS or FAIL with details.
  """
)
```

### Mandatory Completion Guard Invocation

After quality gate passes, ALWAYS spawn completion-guard:

```
Task(
  subagent_type="workflow:completion-guard",
  model="opus",  # Always opus for final verification
  prompt="""
  COMPLETION GUARD - FINAL VERIFICATION

  Original Task: {original_task_description}
  Workflow ID: {workflow_id}
  Mode: {workflow_mode}

  Verify:
  1. ALL requirements from original task are implemented
  2. NO incomplete code markers (TODO, FIXME, etc.)
  3. Build passes
  4. Tests pass
  5. TODO list has 0 pending/in_progress items
  6. Quality gate has passed

  Return APPROVED or REJECTED with specific issues.
  """
)
```

If completion-guard returns REJECTED:
1. Send issues to executor for fixes
2. Re-run quality-gate
3. Re-run completion-guard
4. Repeat max 3 times
5. If still failing, PAUSE for manual intervention

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

1. Use `~/.claude/workflows/state.json` instead of org files
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

When all steps done:

1. **Update state**:
   - Fill Completion Summary section
   - Set COMPLETED_AT timestamp
   - Calculate TOTAL_DURATION

2. **Generate summary** for user:
   - Mode used
   - Files changed
   - Tests added (if thorough mode)
   - Review iterations taken
   - Any warnings or notes

3. **Ask about commit**:
   - "Workflow complete! Should I commit these changes?"
   - Suggest commit message based on work done

4. **Archive state**:
   - Move org file to `~/.claude/workflows/completed/`
   - Or update JSON state with completed status

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
- Templates: `templates/` in plugin directory
- Active org files: `~/.claude/workflows/active/`
- JSON state: `~/.claude/workflows/state.json`
- Completed: `~/.claude/workflows/completed/`
- Hook logs: `~/.claude/workflows/hook.log`

### Agent Reference

See `agents/` directory for full agent definitions.
See `resources/mode-routing.md` for detailed routing guide.
See `resources/subagent-prompts.md` for subagent prompt templates.

---

Begin by parsing the input, determining mode and style, and asking about branch strategy.
