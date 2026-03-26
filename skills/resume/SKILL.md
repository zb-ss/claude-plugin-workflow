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

Then find the workflow file. **Never use `~` in tool calls** - always use the absolute path:
```
Glob(pattern="<HOME>/.claude-workflows/active/*")
```
(Replace `<HOME>` with the actual path, e.g., `/home/zashboy`)

- If `$ARGUMENTS` is empty: Find most recent `.org` or `.md` file in the active directory
- If `$ARGUMENTS` provided: Look for matching workflow ID

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

### 7. Workflow-Type-Specific Resume Logic

After determining the workflow type from the state file, branch on `state.workflow.type` for specialized resume behavior.

### Epic Workflow Resume

When resuming an epic workflow (`state.workflow.type === "epic"`), follow this specialized logic:

#### Rate Limit Resume

Check if the workflow was paused due to rate limits:
```
if state.phase.rate_limit.paused_at is set:
    if current_time > state.phase.rate_limit.resumes_at:
        # Rate limit has cleared
        Clear rate_limit fields in state (set all to null)
        Report: "Rate limit cleared. Resuming epic workflow."
        Continue to component/integration resume below
    else:
        # Still rate limited
        remaining = state.phase.rate_limit.resumes_at - now
        Report: "Rate limit active. Resets in {remaining}."

        Offer options:
        1. Wait (schedule CronCreate for exact reset time)
        2. Cancel the pause and try anyway
        3. Exit and come back later
```

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

#### Completion Guard Resume

When `state.phase.current === "completion_guard"`:
- Standard completion guard resume — re-run the completion guard agent
