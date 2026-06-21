---
name: auto
description: Autonomous driver — outer loop that wakes on a schedule, resumes or advances the in-flight task for a repo, then pulls and launches the next queued task. Reconstructs all state from disk and the GitHub issue on every wake; never relies on session memory.
user_invocable: true
usage: /workflow:auto [--once | --forever] [--repo <control-repo>]
arguments:
  - name: once
    required: false
    description: Exit after processing at most one queued item (default). Safe for manual test runs.
  - name: forever
    required: false
    description: Keep the driver alive in this session, sleeping between wakes. Only useful for interactive debugging — prefer the /schedule cloud routine for production.
  - name: repo
    required: false
    description: Override the control repo slug used to resolve the GitHub issue queue (default from CLAUDE_WORKFLOW_CONTROL_REPO env or the plugin settings file).
---

# Autonomous Driver

The driver is the **outer loop** of the autonomous system. A recurring `/schedule`
cloud routine fires `/workflow:auto` on a cadence (see "Schedule Setup" below).
On each wake the driver rebuilds everything from **disk and the GitHub issue** —
never from session memory — executes one decision, and exits. A quota-killed
session leaves state intact on disk; the next scheduled wake picks up exactly
where work stopped.

## AGENTIC MODE ACTIVE

This skill runs **fully autonomously**. Do NOT ask for permission on
non-destructive operations. The same permission model as `skills/start/SKILL.md`
applies: read/write project files, create branches, run validation commands,
spawn subagents — but do not commit, do not push, do not `rm -rf`.

**Run configuration** (approval posture, `confidence_threshold`, `spend_cap_usd`,
`empty_queue_policy`, `control_repo`, `scrub_denylist`) and the first-run scoped-
permissions setup are documented in `resources/autonomy-config.md`. Posture is
asked **once** at setup and persisted; the scheduled routine never re-asks. The
scrub gate (`hooks/scrub-guard.js`) is never bypassable, even under a broad
allowlist.

### CRITICAL: Never Use `~` in Tool Calls

Write, Read, Glob, and Edit do NOT expand `~`. Always run `echo $HOME` first and
use the absolute path in every tool call.

---

## Overview of the Driver Loop

```
wake
 │
 ├─ Step 0: Pre-flight (resolve paths, plugin root, control repo)
 │
 ├─ Step 1: Check in-flight task
 │    ├─ burst still running?   → no-op, exit
 │    ├─ rate-limited, not yet cleared? → no-op, exit
 │    ├─ rate-limit cleared?    → resume burst, then fall through to Step 2
 │    └─ finished / no task?    → advance issue to review/done, fall through
 │
 └─ Step 2: Pull next task
      ├─ queued item exists?    → transition to in-progress, comment, kick burst
      └─ queue empty?
           ├─ --once (default)  → exit cleanly
           └─ --forever         → no-op, exit (next wake picks it up)
```

Every decision is derived from the on-disk `.state.json` and the GitHub issue.
Session context is irrelevant and deliberately ignored.

---

## Step 0: Pre-flight

**Step 0a.** Resolve home and plugin root (never use `~` in tool calls):

```bash
HOME_PATH=$(echo $HOME)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME_PATH/.claude/plugins/workflow}"
```

**Step 0b.** Resolve the control repo. The queue adapter reads issues from a
designated GitHub repository that acts as the task control plane:

```bash
# Prefer env override, then plugin settings file, then --repo flag argument
CONTROL_REPO="${CLAUDE_WORKFLOW_CONTROL_REPO:-$(node -e "
  try {
    const s = require('$PLUGIN_ROOT/settings.json');
    console.log(s.control_repo || '');
  } catch { console.log(''); }
")}"
# --repo <slug> from $ARGUMENTS overrides everything
```

If `CONTROL_REPO` is still empty, print an error and exit:
`"[auto] CONTROL_REPO is not set. Pass --repo <owner/repo> or set CLAUDE_WORKFLOW_CONTROL_REPO."`.

**Step 0c.** Resolve the active directory for the target repo:

```bash
ACTIVE_DIR=$(node "$PLUGIN_ROOT/lib/active-dir-cli.js")
REPO_KEY=$(node "$PLUGIN_ROOT/lib/repo-key-cli.js")
```

Both helpers read `CLAUDE_WORKFLOW_STATE_DIR` / `CLAUDE_WORKFLOW_REPO_KEY` env
overrides and auto-create the directory. Do NOT derive the repo-key manually — a
bash hash without `realpath` normalization diverges from the Node resolver and
produces a second key for the same repo (the symlink/cross-machine mismatch). The
Node resolver is the single source of truth.

---

## Step 1: Check the In-Flight Task

### 1a. Discover the active state file

Glob for `$ACTIVE_DIR/*.state.json`. If multiple files exist, take the one with
the most-recent `updated_at`. If none exist, skip to Step 2.

Read the state:

```bash
node -e "
const fs = require('fs');
const files = require('fs').readdirSync('$ACTIVE_DIR')
  .filter(f => f.endsWith('.state.json'))
  .map(f => ({ f, s: JSON.parse(fs.readFileSync('$ACTIVE_DIR/' + f, 'utf8')) }))
  .sort((a, b) => new Date(b.s.updated_at) - new Date(a.s.updated_at));
if (files.length) console.log(JSON.stringify({ path: '$ACTIVE_DIR/' + files[0].f, state: files[0].s }));
"
```

Store as `$STATE_PATH` and `$STATE_JSON`.

### 1b. Burst-still-running guard

Check whether a live burst session is actively writing to the state. Heuristic:
if `state.updated_at` is within the last 90 seconds, assume a burst is in
progress. Do not interrupt it.

```bash
node -e "
const s = $STATE_JSON;
const age = Date.now() - new Date(s.updated_at).getTime();
console.log(age < 90000 ? 'RUNNING' : 'IDLE');
"
```

If `RUNNING`: print `"[auto] Burst in progress (updated ${age}s ago). Skipping wake."` and **exit**.

### 1c. Rate-limit check

Use `isRateLimited` from `hooks/lib/rate-limit.js`:

```bash
node <<'EOF'
const fs = require('fs');
const { isRateLimited, clearRateLimitPause } = require('$PLUGIN_ROOT/hooks/lib/rate-limit');
const statePath = '$STATE_PATH';
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const rl = state.phase && state.phase.rate_limit;
if (!rl || !rl.paused_at) { console.log('NO_PAUSE'); process.exit(0); }
if (isRateLimited(state)) {
  console.log('STILL_LIMITED ' + (rl.resumes_at || 'unknown'));
} else {
  clearRateLimitPause(state);
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  console.log('CLEARED ' + (rl.workflow_phase || ''));
}
EOF
```

Decision table:

| Result | Action |
|--------|--------|
| `NO_PAUSE` | Continue to 1d |
| `STILL_LIMITED <iso>` | Print `"[auto] Rate limit active until <iso>. One-shot resume cron handles it."` and **exit** (the cron scheduled by the rate-limit protocol fires `/workflow:resume` at the exact reset instant — the driver does not duplicate it) |
| `CLEARED <phase>` | Log `"[auto] Rate limit cleared. Resuming at phase <phase>."` then run `/workflow:resume $STATE_PATH` re-entering at `state.phase.rate_limit.workflow_phase`. Use `getNextPhase(state)` and `getPendingGates(state)` (from `hooks/lib/state.js`) to find the first gate that is neither `passed` nor `skipped` and re-run it whole. A mid-flight gate re-runs from its beginning — gates are idempotent; sub-gate checkpointing is not attempted. After resume completes, fall through to 1d. |

### 1d. Finished check

Check whether all mandatory gates have passed using `allMandatoryGatesPassed`
from `hooks/lib/state.js`:

```bash
node -e "
const { allMandatoryGatesPassed } = require('$PLUGIN_ROOT/hooks/lib/state');
const state = $STATE_JSON;
console.log(allMandatoryGatesPassed(state) ? 'DONE' : 'IN_PROGRESS');
"
```

If `IN_PROGRESS`: the task is neither finished nor rate-limited, but the burst
was idle long enough to be considered stale. This is the case where a previous
burst was quota-killed mid-gate before the pause handler ran. Re-enter the burst:
call `/workflow:resume $STATE_PATH`. After resume, the driver's job for this wake
is complete — exit.

If `DONE`: advance the issue.

### 1e. Advance a completed task

The task finished in a prior burst. Close out its GitHub issue:

```bash
# Resolve issue number from state (stamped at task-start time by Step 2c below)
ISSUE_NUMBER=$(node -e "const s = $STATE_JSON; console.log(s.queue_issue_number || '');")
```

If `ISSUE_NUMBER` is set:

1. Call `lib/queue-cli.js transition $ISSUE_NUMBER in-progress done` to move the
   issue from `in-progress` to `done`.
2. Call `lib/queue-cli.js comment $ISSUE_NUMBER "Workflow $WORKFLOW_ID completed. All mandatory gates passed."`.
3. If the issue tracker uses a `review` label stage before `done`, use
   `transition $ISSUE_NUMBER in-progress review` first, then move it to `done`
   once any human review step is complete (policy is set in the queue settings).

Then archive the state file: move `$STATE_PATH` and its companion `.org`/`.md`
file from `$ACTIVE_DIR/` to the completed bucket:

```bash
COMPLETED_DIR="${CLAUDE_WORKFLOW_STATE_DIR:-$HOME_PATH/.claude-workflows}/completed/$REPO_KEY"
mkdir -p "$COMPLETED_DIR"
mv "$STATE_PATH" "$COMPLETED_DIR/"
# move companion org/md if present (same basename, different extension)
BASE="${STATE_PATH%.state.json}"
for EXT in .org .md; do
  [ -f "$BASE$EXT" ] && mv "$BASE$EXT" "$COMPLETED_DIR/"
done
```

Fall through to Step 2.

---

## Step 2: Pull the Next Task

### 2a. Query the queue

Call the queue adapter to list `queued` issues, sorted by priority:

```bash
node "$PLUGIN_ROOT/lib/queue-cli.js" listQueued --repo "$CONTROL_REPO" --limit 1
```

`listQueued` returns a JSON array of issue objects, each with at minimum:
`{ number, title, labels, body, priority }`. An empty array means the queue is
empty.

The queue adapter interface (implemented in `lib/queue-cli.js`; owned by its own
skill and not modified here):

| Command | Description |
|---------|-------------|
| `listQueued` | Returns `queued` issues sorted by priority descending |
| `readTask <number>` | Returns full issue body parsed as a task spec |
| `transition <number> <from> <to>` | Moves issue label state |
| `comment <number> <text>` | Posts a comment on the issue |
| `closeDone <number>` | Closes the issue with state `done` |

### 2b. Empty queue policy

If `listQueued` returns an empty array:

- `--once` (default): print `"[auto] Queue empty. Nothing to do."` and **exit**.
- `--forever`: print `"[auto] Queue empty. Will check again on next wake."` and **exit**. The scheduled routine fires again on its cadence; the driver does not spin-sleep.

### 2c. Pick and start the next task

Take `issues[0]` (highest priority). Then:

1. **Transition** the issue from `queued` to `in-progress`:
   ```bash
   node "$PLUGIN_ROOT/lib/queue-cli.js" transition "$ISSUE_NUMBER" queued in-progress --repo "$CONTROL_REPO"
   ```

2. **Comment** a start line on the issue:
   ```bash
   node "$PLUGIN_ROOT/lib/queue-cli.js" comment "$ISSUE_NUMBER" \
     "Workflow driver started burst at $(date -u --iso-8601=seconds). Target: $TARGET_REPO." \
     --repo "$CONTROL_REPO"
   ```

3. **Read the full task spec**:
   ```bash
   TASK_SPEC=$(node "$PLUGIN_ROOT/lib/queue-cli.js" readTask "$ISSUE_NUMBER" --repo "$CONTROL_REPO")
   ```
   The task spec includes at minimum: `target_repo` (the repo to run the workflow
   against), `description` (the task description to pass to `/workflow:start`),
   and optionally `format`, `branch`, `tests_enabled`.

4. **Kick the burst** by invoking `/workflow:start` against `target_repo`:

   ```
   Agent(
     subagent_type="general-purpose",
     model="sonnet",
     run_in_background=false,
     prompt="""
     You are running a workflow burst for task #$ISSUE_NUMBER.
     Follow the instructions in: $PLUGIN_ROOT/skills/start/SKILL.md

     Target repo: $TARGET_REPO
     Task: $TASK_DESCRIPTION
     $EXTRA_FLAGS

     Additional context: stamp queue_issue_number=$ISSUE_NUMBER into the state
     JSON at Step 5b so the driver can close the issue after completion.
     """
   )
   ```

   The burst runs to completion (or until quota-killed / rate-limited). On
   quota-kill the burst's stop-guard hook records the pause state to disk; the
   next driver wake finds the stale idle state at Step 1b and resumes.

5. After the burst agent returns, the driver's work for this wake is done.
   **Exit** — do not loop. The scheduled routine fires the next wake.

---

## Schedule Setup

The driver is designed to be invoked by a recurring **`/schedule` cloud routine**
— a Claude scheduling primitive that survives session quota resets and fires
`/workflow:auto` on a user-defined cadence.

### Registering the routine

After running `/workflow:setup` and confirming the queue is configured, register
the recurring routine once:

```
/schedule create
  name: workflow-auto-driver
  prompt: /workflow:auto --once
  cron: "*/30 * * * *"   # every 30 minutes; adjust to taste
  timezone: UTC
  recurring: true
```

Tune the cadence to your task throughput. A 30-minute cadence means at most a
30-minute lag before a newly queued task is picked up. A 5-minute cadence is
fine for active sprints; a 60-minute cadence suits low-volume queues.

### SPIKE CAVEAT — verify before relying on this

Before treating `/schedule` as production infrastructure, confirm three things
on your subscription tier:

1. **A routine CAN fire a plugin slash command** (`/workflow:auto`) — not all
   scheduling implementations pass the invocation through the plugin command
   router. Test with a no-op: `/schedule create prompt: "/workflow:auto --once"
   cron: "* * * * *" recurring: false` and verify a wake actually runs.

2. **Routines survive quota resets** — the whole point is that the outer loop
   outlives any individual session. If your tier kills scheduled routines on
   quota exhaust, the automation guarantee breaks.

3. **Re-fires correctly after a reset** — a quota window that fires mid-routine
   should produce a clean resume on the next scheduled wake, not a stuck job.

**Fallback path:** if `/schedule` is unavailable or unverified, use the same
`CronCreate` prompt path that the rate-limit protocol already uses for one-shot
resumes (`buildCronExpression` + `CronCreate`). Set `recurring: true` and embed
the `/workflow:auto --once` prompt. This is lower-fidelity (it schedules from
the current session and loses the outer routine if the session dies before the
cron fires), but it covers the common case of a long quiet period between tasks.

---

## Guardrails the Driver Respects

These guardrails are enforced by hooks and the driver's own decision logic. The
full implementations live elsewhere; the driver only acts on their outputs.

### Park-on-low-confidence

The architect agent (`workflow:architect`) stamps `state.architect.confidence`
(a float 0–1) after the planning phase. If confidence falls below the configured
threshold (default `0.70`, overridable in plugin settings), the driver must NOT
proceed. Instead:

1. Transition the issue to `blocked` via `lib/queue-cli.js transition $ISSUE_NUMBER in-progress blocked`.
2. Comment on the issue: `"Workflow paused: architect confidence $CONF below threshold $THRESHOLD. Manual review required before resuming."`.
3. **Do not guess.** Do not lower the threshold automatically. Wait for a human
   to review the plan, adjust the task description, and move the issue back to
   `queued`.

The driver checks this after Step 2c's burst returns (the burst itself may have
already parked and transitioned the issue). Re-check the issue state before
acting to avoid a double-transition.

### Per-task spend cap

Each task carries an optional `max_spend_usd` field in its task spec. The burst
supervisor tracks cumulative spend in `state.spend_usd` (updated after each
agent spawn). If `state.spend_usd >= max_spend_usd` before the task completes:

1. The burst supervisor pauses the workflow (records state, exits cleanly).
2. The driver, on the next wake, finds the task idle but not finished and not
   rate-limited. It detects the spend cap via `state.spend_usd >= state.spend_cap`:

   ```bash
   node -e "
   const s = $STATE_JSON;
   const cap = s.spend_cap || Infinity;
   const spent = s.spend_usd || 0;
   console.log(spent >= cap ? 'CAP_HIT ' + spent + ' / ' + cap : 'UNDER_CAP');
   "
   ```

3. If `CAP_HIT`: transition the issue to `blocked`, comment the spend figures,
   and exit. Do not resume the burst. Do not burn additional quota.

Spend tracking is the burst supervisor's responsibility; the driver only reads
`state.spend_usd` and acts on it. If the field is absent, assume no cap is in
force and proceed normally.

---

## Durable Resume is the Whole Game

The driver's core property: **every decision survives a quota kill** because
every decision is derived from disk state, not session memory.

How it works end to end:

1. A burst runs phases and checkpoints each gate to
   `state.gates.<gate>.{status, iteration}` before moving on (Phase 1 of the
   state design; the start skill writes these).
2. If the session is quota-killed mid-gate, the gate's `status` remains whatever
   it was before the phase started (`pending` or `in_progress`). The burst's
   stop-guard hook writes `state.phase.rate_limit` to record where work stopped.
3. The next `/schedule` wake fires `/workflow:auto`, reaches Step 1c, finds
   `CLEARED` or `STILL_LIMITED`, and either exits (cron will fire resume) or
   calls `/workflow:resume` which re-enters the workflow at `workflow_phase`.
4. Resume re-runs the first non-passed/non-skipped gate **whole** using
   `getNextPhase(state)` and `getPendingGates(state)`. Sub-gate partial progress
   is not checkpointed — gates are idempotent fixed points; re-running a full
   gate is always safe.
5. If the session is killed before the stop-guard hook runs (hard process kill),
   the stale-idle heuristic at Step 1b (age > 90 seconds) catches it on the next
   wake and calls `/workflow:resume` directly.

No human intervention is needed for any of steps 1–5. The driver loop plus the
existing rate-limit protocol handle the full autonomy requirement across 5-hour
and weekly quota windows.

---

## Error Handling

| Condition | Action |
|-----------|--------|
| `lib/queue-cli.js` not found | Print error with `PLUGIN_ROOT` path, exit. Do not attempt a workaround. |
| `transition` call fails (network, auth) | Log the error, do NOT change local state, exit. The next wake retries. |
| `readTask` returns unparseable body | Transition issue to `blocked`, comment the parse error, exit. |
| Burst agent returns error output | Check for rate-limit markers via `detectRateLimit`; if found, apply rate-limit pause protocol. Otherwise log and transition issue to `blocked`. |
| `ACTIVE_DIR` does not exist | `active-dir-cli.js` auto-creates it. If creation fails, the user needs to run `/workflow:setup`. |
| Multiple `.state.json` files in `$ACTIVE_DIR` | Take most-recent by `updated_at`. This is normal during a slow archive after a completed burst. |

---

## Usage Examples

```bash
# Standard single-wake run (default, safe for manual test)
/workflow:auto --once

# Override control repo for a one-off run
/workflow:auto --once --repo myorg/task-queue

# Keep alive in this session (debug mode only)
/workflow:auto --forever
```

The recommended production path is the `/schedule` routine firing `--once` on a
cadence. The driver is stateless between wakes by design.
