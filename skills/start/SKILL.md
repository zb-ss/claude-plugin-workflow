# Workflow Orchestrator

Start an automated development workflow with configurable execution modes and planning styles.

## AGENTIC MODE ACTIVE

This workflow runs in **agentic mode** with expanded permissions:

**ALLOWED without asking:**
- Read/Write/Edit files in the project
- Create feature branches (`git checkout -b`, `git switch -c`)
- Run validation (`php -l`, `npm run lint`, `composer validate`)
- Run builds and tests
- Spawn subagents via Task tool
- File operations (`mkdir`, `cp`, `mv`)

**BLOCKED (user does manually):**
- `git commit` - User reviews and commits
- `git push` - User pushes when ready
- Destructive operations (`rm -rf`, `reset --hard`)

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

5. **Confirm with user**:
   - Show workflow ID and state location
   - Show selected mode and its implications
   - "Ready to begin Step 0: Planning?"

### Agent Routing by Mode

Use the correct agent based on the mode:

| Phase | standard | turbo | eco | thorough |
|-------|----------|-------|-----|----------|
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

### Step Execution Pattern

For each step:

```
1. READ the step from state file (may have been modified by user)
2. UPDATE state: set STARTED_AT, STATUS: in-progress
3. REPORT to user: "Starting Step X: <name> (using <agent>)"
4. SPAWN subagent with mode-appropriate agent:
   Task(
     subagent_type=<agent from routing table>,
     model=<model from mode>,
     prompt=<detailed instructions with context>
   )
5. CAPTURE output from subagent
6. UPDATE state:
   - Write output to appropriate section
   - Check off completed objectives
   - Set COMPLETED_AT
   - Mark as DONE
7. REPORT to user: "Step X complete. <brief summary>"
8. CHECK for user input before proceeding
```

### Review Loops by Mode

#### Standard Mode
- Code review: max 2 iterations, blocking
- Security: max 1 iteration, blocking

#### Turbo Mode
- Code review: 1 iteration, advisory (non-blocking)
- Security: advisory only

#### Eco Mode
- Code review: max 1 iteration, blocking
- Security: skipped

#### Thorough Mode
- Code review: max 3 iterations, blocking (reviewer-deep)
- Security: max 2 iterations, blocking (security-deep)
- Test coverage: 80% minimum, blocking
- Performance: advisory
- Documentation: advisory

```
iteration = 0
max_iterations = <from mode config>

while iteration < max_iterations:
    Run review agent
    if verdict == PASS:
        Mark step complete
        Proceed to next step
        break
    else:
        iteration++
        Update ITERATION in state
        Log in Review Log
        if iteration < max_iterations:
            Report: "Review found issues. Sending back to implementation."
            Re-run implementation with feedback
        else:
            if mode == "turbo":
                Log advisory and continue
            else:
                Report: "Max review iterations reached."
                Ask user: "Should I continue anyway?"
```

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
