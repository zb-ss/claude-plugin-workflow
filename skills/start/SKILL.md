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
/workflow:start <type> <description> [--mode=<mode>] [--style=<style>] [--format=<format>]
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
| `swarm` | Maximum parallelism | opus (validation) | 3-architect competitive |

### Swarm Mode Details

Swarm mode enables:
- **Orchestrator-only execution** - Main agent never writes code, only delegates
- **Aggressive task decomposition** - Break work into parallel batches
- **4 parallel executors** per batch for implementation
- **3-architect validation** - Functional, Security, Quality (all must pass)
- **Supervisor agent** coordinates all work

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
Task(
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

The subagent runs the FULL workflow (planning, implementation, review). The parent session only launches it and relays results. This means:
- Fresh context window for the orchestrator
- Each executor subagent spawned by the orchestrator also gets fresh context
- User's session stays lean — just monitoring output

If the user wants interactive control (pausing between steps), skip the subagent launch and run inline.

### Initialization

**IMPORTANT:** Follow these steps in order. Do NOT skip the directory initialization.

#### Step 0: Pre-flight Directory Check (CRITICAL)

**BEFORE doing anything else**, ensure workflow directories exist.

**Step 0a: Get the absolute home directory path**

Run this bash command first:
```bash
echo $HOME
```
This returns something like `/home/zashboy` or `/Users/alice`. Store this value - you need it for ALL Write tool calls below.

**Step 0b: Create directories**

⚠️ **CRITICAL: The Write tool DOES NOT expand `~`** ⚠️

You MUST replace `$HOME_PATH` below with the ACTUAL path from Step 0a.

- ❌ WRONG: `Write(file_path="~/.claude/workflows/active/.gitkeep")` → WILL FAIL
- ✅ RIGHT: `Write(file_path="/home/zashboy/.claude/workflows/active/.gitkeep")` → WORKS

Create these directories (substitute your actual home path):
```
Write(file_path="$HOME_PATH/.claude/workflows/active/.gitkeep", content="")
Write(file_path="$HOME_PATH/.claude/workflows/completed/.gitkeep", content="")
Write(file_path="$HOME_PATH/.claude/workflows/context/.gitkeep", content="")
Write(file_path="$HOME_PATH/.claude/workflows/memory/.gitkeep", content="")
Write(file_path="$HOME_PATH/.claude/plans/.gitkeep", content="")
```

If directories cannot be created, **STOP** and inform the user to run `/workflow:setup`.

#### Step 1: Parse input

1. **Parse input**:
   - First word = workflow type
   - Look for `--mode=<mode>` flag (if present, skip auto-detection)
   - Look for `--style=<style>` flag (default: `full`)
   - Look for `--format=<format>` flag (default: `org`, options: `org`, `md`)
   - Rest = description
   - If type unknown, list available types and ask

#### Step 2: Auto-detect mode (if no `--mode` flag)

   **Step 2a: Check for explicit keyword prefixes**
   ```
   thorough:, careful:, production: → thorough mode
   quick:, fast:, prototype: → turbo mode
   eco:, simple:, minor: → eco mode
   ```

   **Step 2b: If no prefix, analyze task complexity**

   Spawn task-analyzer (haiku - fast and cheap):
   ```
   Task(
     subagent_type="workflow:task-analyzer",
     model="haiku",
     prompt="""
     Analyze this task for complexity and recommend a workflow mode.

     Task type: {workflow_type}
     Description: {description}

     Return:
     - recommended_mode: thorough|standard|turbo|eco
     - confidence: high|medium|low
     - reasoning: [list of factors]
     """
   )
   ```

   **Step 2c: Present recommendation to user**
   ```
   ┌─────────────────────────────────────────────────┐
   │ AUTO-DETECTED MODE: thorough                    │
   │                                                 │
   │ Reasoning:                                      │
   │ • Task involves authentication (+2)             │
   │ • Security-sensitive keywords detected (+2)    │
   │ • Multiple files likely affected (+1)          │
   │                                                 │
   │ Confidence: HIGH                               │
   │                                                 │
   │ [Enter] Accept  |  [--mode=X] Override         │
   └─────────────────────────────────────────────────┘
   ```

   **Step 2d: Apply selected mode**
   - If user accepts (or no response within context), use recommended mode
   - If user specifies `--mode=X`, use their choice
   - Log the mode selection decision in workflow state

3. **Load mode configuration**:
   - Read `modes/<mode>.org` from the workflow plugin directory
   - Extract agent routing and settings
   - Apply to workflow execution

4. **Ask about branch**:
   - "Should I create a new branch for this work?"
   - Suggest: `feature/<short-description>` or `fix/<short-description>`
   - Or use current branch

5. **Create workflow state** (CRITICAL - use Write tool with ABSOLUTE paths):
   - Generate ID: `YYYYMMDD-<random>` (e.g., `20260204-a1b2c3`)
   - Use the home directory path from Step 0a (e.g., `/home/user`)

   **If style=full**:
   - Determine file extension from format: `.org` or `.md`
   - Read template from plugin: `templates/<type>-development.<format>`
   - Replace placeholders in template:
     - `{{WORKFLOW_ID}}` → generated ID
     - `{{TITLE}}` → description (first 50 chars)
     - `{{DESCRIPTION}}` → full description
     - `{{DATE}}` → current date (YYYY-MM-DD)
     - `{{TIMESTAMP}}` → current ISO timestamp
     - `{{BRANCH}}` → branch name
     - `{{BASE_BRANCH}}` → base branch (main/master)
     - `{{MODE}}` → selected mode
   - **Use Write tool with ABSOLUTE path**: `/home/user/.claude/workflows/active/<id>.<format>`
   - Example: `Write(file_path="/home/zashboy/.claude/workflows/active/20260204-abc123.org", content=<template>)`
   - **VERIFY** the file was created by reading it back

   **If style=light**:
   - **Use Write tool with ABSOLUTE path**: `/home/user/.claude/workflows/state.json`
   - Use TodoWrite for step tracking

   **IMPORTANT:** Never use `~` in Write tool paths. Always use the absolute path from Step 0a.

6. **Run Codebase Analysis** (unless eco mode or context is fresh):
   - **Use Read tool** to check if context file exists: `<HOME>/.claude/workflows/context/<project-slug>.md`
   - Prefer Read or Glob tools for cross-platform reliability
   - If file doesn't exist or is older than 7 days, run `codebase-analyzer` agent
   - Store context file for all subsequent agents to reference
   - In eco mode, skip analysis to save tokens (use existing context if available)

7. **Load Project Memory** (lightweight, always run):
   - **Use Read tool** to check for memory file: `<HOME>/.claude/workflows/memory/<project-slug>.md`
   - Prefer Read tool for cross-platform reliability
   - If exists, read key learnings to inform this workflow:
     - Key decisions from past workflows
     - Patterns discovered in this codebase
     - Issues previously resolved (avoid repeating)
     - Project-specific conventions
   - Memory is lightweight (~1-2k tokens) and improves workflow quality

8. **Confirm with user**:
   - Show workflow ID and state location
   - Show selected mode and its implications
   - Show context file status (fresh/generated/skipped)
   - "Ready to begin Step 1: Planning?"

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

All agents receive a **reference** to the codebase context file — never embed its contents inline.

```
Include in every agent prompt:
---
## Codebase Context
Read the context file at: <HOME>/.claude/workflows/context/<project-slug>.md
Focus on: [list relevant sections for this task, e.g., "Naming Conventions, Testing Patterns"]
---
```

**Why reference, not embed:** Embedding the full context (~5K+ tokens) into every agent spawn wastes the supervisor's context budget and duplicates information. Each agent reads the file themselves using their own context window, and only loads the sections they need.

This ensures:
- Agents follow established naming conventions
- Architectural patterns are maintained
- Code style is consistent
- Testing patterns match existing tests
- Supervisor context stays lean across many agent spawns

### MANDATORY: State File Updates

**CRITICAL:** The state file (`.org` or `.md`) is the source of truth. You MUST update it:

1. **BEFORE each step** - Mark status as `in-progress`, set `STARTED_AT`
2. **AFTER each step** - Write outputs, check off objectives, set `COMPLETED_AT`
3. **After planning** - Write the FULL plan to the Plan section
4. **After implementation** - List all changed files
5. **After reviews** - Record findings and verdicts
6. **On any error** - Log the error in the state file

**State Update Pattern:**
```
# Read current state
Read(file_path="<HOME>/.claude/workflows/active/<id>.org")

# Update the relevant section using Edit tool
Edit(file_path="<HOME>/.claude/workflows/active/<id>.org",
     old_string="**Status:** pending",
     new_string="**Status:** in-progress")

# Or for larger updates, use Write to replace sections
```

**NEVER skip state updates.** The user may be following along in their editor.

### Step Execution Pattern

For each step:

```
1. READ the step from state file (may have been modified by user)
2. LOAD codebase context from <HOME>/.claude/workflows/context/<project>.md
3. **UPDATE STATE FILE:** set STARTED_AT, STATUS: in-progress
4. REPORT to user: "Starting Step X: <name> (using <agent>)"
5. SPAWN subagent with mode-appropriate agent:
   Task(
     subagent_type=<agent from routing table>,
     model=<model from mode>,
     max_turns=<from mode config MAX_TURNS_* property>,
     prompt="""
       ## Codebase Context
       Read the context file at: <HOME>/.claude/workflows/context/<project>.md
       Focus on: [relevant sections for this task]

       ## Task
       {detailed instructions}

       ## Context Efficiency
       - Use Read with offset/limit for files >200 lines
       - Write each file to disk immediately after changes
       - Update state file after each objective
     """
   )
6. CAPTURE output from subagent
7. **UPDATE STATE FILE IMMEDIATELY:**
   - Write output to appropriate section
   - Check off completed objectives (change [ ] to [x])
   - Set COMPLETED_AT timestamp
   - Mark step as DONE
8. REPORT to user: "Step X complete. <brief summary>"
9. CHECK for user input before proceeding
```

**After Planning Phase - REQUIRED:**
Write the COMPLETE plan to the state file's Plan section. Include:
- All files to modify/create
- Implementation steps
- Testing strategy
- Risks identified

### Parallel Execution

**IMPORTANT:** Use parallel Task tool calls where phases are independent to maximize efficiency.

#### Parallel Opportunities

1. **Turbo/Standard Reviews** - Code review + Security scan (no dependencies):
   ```
   # Send BOTH in a single message with multiple Task calls:
   Task(subagent_type="workflow:reviewer-lite", prompt=..., run_in_background=true)
   Task(subagent_type="workflow:security-lite", prompt=..., run_in_background=true)
   # Then collect results from both
   ```

2. **Thorough Mode Advisory Checks** - Performance + Documentation (after gates pass):
   ```
   # These are advisory, run in parallel:
   Task(subagent_type="workflow:perf-reviewer", prompt=..., run_in_background=true)
   Task(subagent_type="workflow:doc-writer", prompt=..., run_in_background=true)
   ```

3. **Multi-file Implementation** - When plan has independent file changes:
   ```
   # If files are independent (e.g., new service + new test):
   Task(subagent_type="workflow:executor-lite", prompt="Implement service...", run_in_background=true)
   Task(subagent_type="workflow:executor-lite", prompt="Implement tests...", run_in_background=true)
   ```

#### When NOT to Parallelize

- Code review must complete before security review **in thorough mode** (security may depend on fixes)
- Implementation must complete before any review
- Test writing should follow implementation
- Dependent file changes (imports, shared state)

### Context Limit Recovery

If an agent's output signals context exhaustion (contains "context limit", "conversation too long", is empty, or is severely truncated):

1. **Assess** — Read the state file. Check which objectives were completed (`[x]` vs `[ ]`). Verify file artifacts on disk.
2. **Continue** — Spawn a **NEW** agent (never `resume`) with only the remaining objectives, a 2-3 sentence summary of completed work, and the context file path reference.
3. **Track** — Mark continuation count in the state file.
4. **Limit** — Max continuations per step from mode config `MAX_CONTINUATIONS` (default: 3). If exhausted, break into smaller sub-steps or pause for user intervention.

See `resources/context-resilience.md` for the full continuation protocol and spawn template.

#### Background Agent Pattern

```python
# Launch parallel agents
agent1 = Task(subagent_type="workflow:reviewer", run_in_background=true, ...)
agent2 = Task(subagent_type="workflow:security", run_in_background=true, ...)

# Collect results (use TaskOutput or read output files)
result1 = TaskOutput(task_id=agent1.id)
result2 = TaskOutput(task_id=agent2.id)

# Process combined results
```

### Review Loops by Mode - MANDATORY QUALITY GATES

**CRITICAL:** Reviews are NOT optional. ALL gates must PASS before completion.

#### Standard Mode
- Code review: max 3 iterations, **BLOCKING**
- Security: max 2 iterations, **BLOCKING**
- Quality Gate: **MANDATORY** before completion
- Completion Guard: **MANDATORY** architect sign-off

#### Turbo Mode
- Code review: max 2 iterations, **BLOCKING**
- Security: max 1 iteration, **BLOCKING**
- Quality Gate: **MANDATORY** (abbreviated)
- Completion Guard: **MANDATORY** (quick check)

#### Eco Mode
- Code review: max 2 iterations, **BLOCKING**
- Security: max 1 iteration, **BLOCKING**
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

#### Swarm Mode - 3-Architect Competitive Validation

**Orchestrator-only execution:** The supervisor agent coordinates all work. You NEVER write code directly.

**Implementation Phase:**
1. Supervisor decomposes task into parallel batches
2. Max 4 parallel executors per batch
3. Batch 1: interfaces/types
4. Batch 2: implementations (depends on batch 1)
5. Batch 3: tests (depends on batch 2)

**3-Architect Validation (all must pass):**
```
┌─────────────────────────────────────────────────────────┐
│              3-ARCHITECT VALIDATION                     │
├─────────────────────────────────────────────────────────┤
│  ARCHITECT 1       ARCHITECT 2       ARCHITECT 3       │
│  Functional        Security          Code Quality      │
│  Completeness      (security-deep)   (reviewer-deep)   │
│  (architect)       OWASP, auth       SOLID, patterns   │
│       │                │                  │            │
│       └────────────────┴──────────────────┘            │
│                        │                               │
│                    AGGREGATOR                          │
│              ALL PASS → Continue                       │
│              ANY FAIL → Fix → Retry                    │
└─────────────────────────────────────────────────────────┘
```

- Architect 1: Functional completeness review (opus)
- Architect 2: Security review (security-deep/opus)
- Architect 3: Code quality review (reviewer-deep/opus)
- ALL three run in **parallel**
- ALL three must **PASS**
- Max 3 retry cycles if failures

**Quality Gates:**
- Quality Gate: **MANDATORY** after 3-architect approval
- Completion Guard: **MANDATORY** with opus

### Zero Tolerance Policy

**NEVER:**
- Skip review gates
- Accept "advisory" results as passes
- Allow partial completion
- Reduce scope to pass tests
- Delete failing tests
- Comment out problematic code

### Quality Gate Pipeline

After implementation and code review, ALWAYS run:

```
Implementation Complete → Code Review PASS
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
│      POST-QUALITY-GATE REVIEW         │
│  (if quality gate made code changes)  │
│                                       │
│  Targeted reviewer-lite on changed    │
│  files only. Max 2 iterations.        │
└───────────────────────────────────────┘
        ↓ PASS (or no changes made)
┌───────────────────────────────────────┐
│        COMPLETION GUARD               │
│  (completion-guard agent - MANDATORY) │
│                                       │
│  ✓ Requirements verified              │
│  ✓ No incomplete code                 │
│  ✓ Code quality spot-check            │
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
escalated = false
previous_issues = []

while iteration < max_iterations:
    # Include previous issues for re-review verification
    Run review agent with:
      - previous_issues_list = previous_issues (if iteration > 0)
      - iteration_number = iteration + 1

    if verdict == PASS:
        Mark step complete
        break
    else:
        previous_issues = extract_issues_from_review(verdict)
        iteration++
        Update ITERATION in state
        Log in Review Log

        if iteration < max_iterations:
            Report: "Review found issues. Sending back to executor for fixes."
            # Spawn executor with structured fix protocol
            Task(
              subagent_type="workflow:executor",
              prompt="""
              ## Review Issues to Fix (MANDATORY - fix ALL)

              {numbered_issues_from_review}

              ## Fix Protocol
              1. Address EVERY issue by ID - no exceptions
              2. For each issue:
                 a. Read the file at the specified line
                 b. Understand the root cause
                 c. Apply the fix
                 d. Self-verify: re-read the code to confirm the fix is correct
              3. Report fixes in this format:
                 - [ISSUE-1] FIXED: <what was changed and why>
                 - [ISSUE-2] FIXED: <what was changed and why>
              4. If you believe an issue is a false positive:
                 - [ISSUE-N] DISPUTE: <detailed justification>
                 - The reviewer will evaluate your dispute on re-review
              5. CRITICAL: Do NOT skip any issue. Every issue ID must appear in your output.
              """
            )
        elif NOT escalated:
            # AUTO-ESCALATE: Switch to opus for both reviewer and executor
            escalated = true
            max_iterations += 2  # Grant 2 more iterations at opus tier
            Report: "Escalating to opus tier for review + fixes"
            Log: "AUTO-ESCALATION: Switching to opus model for reviewer-deep + executor"
            # Next iteration uses workflow:reviewer-deep + opus executor
            Task(
              subagent_type="workflow:executor",
              model="opus",
              prompt="... (same structured fix protocol as above with opus-level analysis)"
            )
        else:
            # Already escalated and still failing after extra iterations
            Report: "BLOCKING after opus escalation. Max review iterations reached."
            Report: "Issues that could not be resolved:"
            List remaining issues with IDs
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

### Post-Quality-Gate Review (if fixes were made)

If the quality gate made code changes (CHANGES_MADE: true in its output):

```python
# Check if quality gate made changes
if quality_gate_result.changes_made:
    Task(
      subagent_type="workflow:reviewer-lite",
      model="haiku",
      max_turns=8,
      prompt="""
      POST-FIX REVIEW: Quality gate made code changes.
      Review ONLY these files for regressions: {quality_gate_changed_files}

      Focus: Did the quality gate fixes introduce bugs, break patterns,
      or deviate from project conventions?

      ## Codebase Context
      Read the context file at: <HOME>/.claude/workflows/context/<project>.md
      Focus on: Code style, naming conventions

      VERDICT: PASS or FAIL with structured issues.
      """
    )

    # If FAIL: Send back to executor to fix, then re-run quality gate
    # Max 2 iterations for post-fix review loop
    post_fix_iteration = 0
    while post_fix_result.verdict == "FAIL" and post_fix_iteration < 2:
        Task(subagent_type="workflow:executor-lite", prompt="Fix post-QG review issues: {issues}")
        Task(subagent_type="workflow:quality-gate", prompt="Re-verify after post-fix corrections")
        post_fix_iteration++
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

3. **Save learnings to memory** (automatic):
   - Extract patterns discovered during this workflow
   - Save to `~/.claude/workflows/memory/<project-slug>.md`
   - Include:
     - Key decisions made and their reasoning
     - Issues resolved and solutions
     - New conventions discovered
     - Workflow outcome (success/partial/issues)
   - This enables continuous learning across sessions

4. **Ask about commit**:
   - "Workflow complete! Should I commit these changes?"
   - Suggest commit message based on work done

5. **Archive state**:
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

**Org format (default):**
- Extension: `.org`
- Features: Collapsible sections, property drawers, TODO states
- Best for: Emacs users, structured note-taking

**Markdown format:**
- Extension: `.md`
- Features: GitHub-compatible, easy to read in any editor
- Best for: GitHub users, general text editors

### Agent Reference

See `agents/` directory for full agent definitions.
See `resources/mode-routing.md` for detailed routing guide.
See `resources/subagent-prompts.md` for subagent prompt templates.

---

Begin by parsing the input, determining mode and style, and asking about branch strategy.
