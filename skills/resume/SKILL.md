# Resume Workflow

Resume an interrupted or paused workflow from its current state.

## Usage
```
/workflow-resume [workflow_id]
```

If no workflow_id is provided, resumes the most recent active workflow.

## Input
$ARGUMENTS

## Instructions

You are the **supervisor agent** resuming a workflow.

### 1. Find the Workflow

First, get the absolute home path:
```bash
echo $HOME
```

**Resolve the repo-scoped active directory** (workflows are isolated per repo
since v2):
```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/workflow}"
ACTIVE_DIR=$(node "$PLUGIN_ROOT/lib/active-dir-cli.js")
echo "$ACTIVE_DIR"
```
Store as `$ACTIVE_DIR`. This is the **only** place this repo's workflows live —
resume is strictly scoped to the current repo so a workflow started elsewhere
cannot be picked up here.

Then find the workflow file. **Never use `~` in tool calls** — always use the
absolute path. Search ONLY the repo-scoped bucket:
```
Glob(pattern="$ACTIVE_DIR/*")
```

- If `$ARGUMENTS` is empty: pick the most recent `.org`/`.md` file in `$ACTIVE_DIR`.
- If `$ARGUMENTS` provided: match the workflow ID within `$ACTIVE_DIR`.

**Do NOT resume unscoped legacy files** from the flat
`$HOME/.claude-workflows/active/` root, and do NOT resume another repo's bucket.
Legacy flat files (no `repo_key`) predate repo-scoping and belong to no repo —
if the requested workflow exists only there, tell the user to run
`/workflow:migrate-legacy` to assign it to a repo first, then resume.

### 2. Read and Parse the Org File

Read the workflow org file and determine:
- Which step is currently in progress (has STARTED_AT but no COMPLETED_AT)
- Which step is next (first TODO step after completed ones)
- Any pending review iterations
- The original task description

### 2.5. Bind Session to Workflow

After finding the workflow, bind this session to it so hooks only affect this workflow:

First, get the OS temp directory:
```bash
node -e "console.log(require('os').tmpdir())"
```
Store this as `$TMPDIR_PATH`.

1. Glob for `$TMPDIR_PATH/workflow-session-marker-*.json` and read the most recent file to get the `session_id`
2. Write `$TMPDIR_PATH/workflow-binding-{session_id}.json` with:
   ```json
   {
     "session_id": "<session_id>",
     "workflow_path": "<path to .state.json>",
     "workflow_id": "<workflow_id>",
     "bound_at": "<ISO timestamp>"
   }
   ```
3. Verify by reading the binding file back

If no session marker is found, skip this step (backward compatible).

### 3. Report Status to User

Before resuming, output:
```
Resuming workflow: <ID>
Type: <workflow_type>
Task: <description>
Current step: <step_name>
Progress: <X of Y steps completed>
```

### 4. Check for User Modifications

Ask the user:
> "I found the workflow at step X. Before continuing:
> - Have you modified the plan or any step in the org file?
> - Do you want to add any instructions before I continue?
> - Or should I proceed from where we left off?"

### 5. Continue Execution

Once user confirms:
- Read any modifications from the org file
- Continue from the current step
- Follow the same workflow logic as the main `/workflow` command
- Update the org file after each step

### 6. Handle Partial Steps

If a step was started but not completed:
- Ask user if they want to restart that step or skip it
- "Step 2 (Code Review) was started but not completed. Should I:
   a) Restart it from the beginning
   b) Skip it and move to the next step
   c) Mark it as complete (if you finished it manually)"

### 7. Quota-Window / Rate-Limit Resume (all workflows)

**Always check `state.phase.rate_limit` first**, regardless of execution style.
Pauses are common to every workflow (swarm and epic) and cover both transient API
rate limits and subscription **quota windows** (the 5-hour / weekly Claude usage
limit). The shared protocol lives in `skills/shared/rate-limit-handling.md`.

```
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/workflow}"

# Compute the current state of the rate-limit pause:
node <<EOF
const fs = require('fs');
const { isRateLimited, clearRateLimitPause } = require('$PLUGIN_ROOT/hooks/lib/rate-limit');
const statePath = process.env.WORKFLOW_STATE_FILE;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (!state.phase || !state.phase.rate_limit || !state.phase.rate_limit.paused_at) {
  console.log('NO_PAUSE');
  process.exit(0);
}
if (isRateLimited(state)) {
  console.log('STILL_LIMITED ' + state.phase.rate_limit.resumes_at);
} else {
  clearRateLimitPause(state);
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  console.log('CLEARED');
}
EOF
```

- `NO_PAUSE` → proceed straight to step 8 (execution-style branch).
- `CLEARED` → log "Usage limit cleared. Resuming workflow." and re-enter at the
  **last completed gate boundary**: `state.phase.rate_limit.workflow_phase`
  records where the supervisor was, so resume restarts that phase. A gate that was
  mid-flight when the limit hit re-runs whole (per-gate `{status,iteration}` is
  the finest durable checkpoint). Then proceed to the swarm/epic branch.
- `STILL_LIMITED <iso>` → report ETA and offer the user three options:
  1. **Wait** — re-schedule CronCreate for the exact reset time and exit.
  2. **Cancel pause** — call `clearRateLimitPause` and try anyway (warn that
     work may fail again immediately).
  3. **Exit** — leave state intact and let the existing cron fire.

### 8. Workflow-Type-Specific Resume Logic

After the rate-limit check, branch on `state.workflow.type`.

### Epic Workflow Resume

When resuming an epic workflow (`state.workflow.type === "epic"`), follow this specialized logic:

#### Component-Level Resume

When `state.phase.current === "component_execution"`:

1. Show component status table:
```
┌─────────────────────────────────────────────────────┐
│ EPIC COMPONENT STATUS                               │
├──────────────┬────────────┬──────────────────────────┤
│ Component    │ Status     │ PR                       │
├──────────────┼────────────┼──────────────────────────┤
│ lexer        │ completed  │ #1                       │
│ scanner      │ completed  │ #2                       │
│ parser       │ in_progress│ -                        │
│ type_checker │ pending    │ -                        │
│ codegen      │ pending    │ -                        │
└──────────────┴────────────┴──────────────────────────┘
```

2. Identify next actionable components:
   - Find components where ALL dependencies have status "completed"
   - Filter to those with status "pending" or "failed" (retry failed ones)
   - These are the next wave to execute

3. For components with status "in_progress":
   - Check if a worktree exists for them: `git worktree list | grep epic/{id}`
   - Check if a PR already exists: `gh pr list --head epic/{id}`
   - If PR exists: mark as completed, update pr_url
   - If worktree exists but no PR: the agent was interrupted — re-run the component
   - If neither: re-run from scratch

4. Continue the component execution loop from the epic-orchestration skill

#### Integration-Level Resume

When `state.phase.current === "integration"`:

1. Check integration status:
   - If `integration.status === "pending"`: start integration from scratch
   - If `integration.merged` has entries: some merges already done — continue from next unmerged component
   - If `integration.test_results` exists but failed: re-run fixes + tests
   - If `integration.review_status !== "passed"`: re-run integration review

2. Check if integration branch exists:
```bash
git branch --list "epic/*/integration"
```

3. Resume from the appropriate point in the integration phase

#### Post-Merge Review Resume

When `state.phase.current === "post_merge_review"`:
- Read `state.gates.post_merge_review.iteration` to know which fix cycle we're on
- Re-enter the fan-out review engine (`skills/phases/post-merge-review/SKILL.md`)
  from a clean `seen`/`dry` state — loop-until-dry is naturally resumable; a
  resumed session re-runs the find→verify loop from scratch against the current
  codebase state
- If a previous fix-executor was mid-flight when the workflow paused (e.g.,
  rate limit), check git status for uncommitted changes — commit them with
  `chore(epic): post-merge fixes (resumed)` before re-entering the engine
- If `iteration >= MAX_FIX_CYCLES` already, surface the still-confirmed
  findings and ask the user how to proceed (do not auto-pass)

#### Completion Guard Resume

When `state.phase.current === "completion_guard"`:
- Standard completion guard resume — re-run the completion guard agent
