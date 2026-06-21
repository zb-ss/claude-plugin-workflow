---
description: Shared quota-window pause/resume protocol used by every workflow supervisor (swarm or epic)
disable-model-invocation: true
---

# Quota-Window / Rate-Limit Handling Protocol

This protocol applies to **every workflow** (swarm and epic). When an agent task
or tool invocation hits a usage limit — a transient API rate limit / 429 / 529,
or a subscription **quota window** (the 5-hour or weekly Claude usage limit) —
supervisors MUST pause the workflow rather than burn retries against an exhausted
quota. Pausing to the exact reset instant (read from the statusline cache) and
auto-resuming is what keeps a long-running workflow autonomous across a 5-hour or
weekly cutoff.

The detection markers, state shape, and scheduling helpers live in
`hooks/lib/rate-limit.js`. Treat that module as the source of truth — do not
re-invent the marker list or pause shape inline.

## When to apply

After **every** agent spawn or tool call, the supervisor inspects the result
for any of the following signals:

- Response text contains any of these (case-insensitive): `rate limit`,
  `429`, `too many requests`, `capacity`, `overloaded`, `throttled`,
  `quota exceeded`, `usage limit reached`, `5-hour limit`, `session limit`,
  `daily limit reached`, `try again later`.
- Multiple agents in the same batch fail simultaneously with empty/error output.
- HTTP status code 429 from any external call.

If you are unsure, run:
```bash
node -e "const {detectRateLimit} = require('${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/workflow}/hooks/lib/rate-limit'); console.log(detectRateLimit(process.argv[1] || ''))" "<paste agent output>"
```
A non-empty result means rate-limited; null means proceed.

## What to do (single, unified protocol)

### 1. Read the soonest reset time

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/workflow}"
RESETS_AT=$(node -e "console.log(require('$PLUGIN_ROOT/hooks/lib/rate-limit').getNextResetIso() || '')")
```

`RESETS_AT` is an ISO 8601 timestamp (e.g., `2026-04-28T15:30:00Z`) or empty.
If empty, default to a 1-hour pause: `RESETS_AT=$(date -u -d '+1 hour' --iso-8601=seconds 2>/dev/null || date -u -v+1H +'%Y-%m-%dT%H:%M:%SZ')`.

### 2. Persist the pause to state

Update `state.phase.rate_limit` using the helpers (the helpers preserve
schema correctness even as it evolves):

```bash
node <<EOF
const fs = require('fs');
const { applyRateLimitPause } = require('${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/workflow}/hooks/lib/rate-limit');
const statePath = process.env.WORKFLOW_STATE_FILE;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
applyRateLimitPause(state, {
  reason: process.env.RATE_LIMIT_REASON || 'rate limit reached',
  resumesAt: process.env.RESETS_AT || null,
  workflowPhase: state.phase && state.phase.current,
});
state.updated_at = new Date().toISOString();
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
EOF
```

### 3. Schedule auto-resume via CronCreate

Build the cron expression and the resume prompt with the helpers, then call
`CronCreate` with `recurring=false`:

```
CRON=$(node -e "console.log(require('$PLUGIN_ROOT/hooks/lib/rate-limit').buildCronExpression('$RESETS_AT'))")
PROMPT=$(node -e "console.log(require('$PLUGIN_ROOT/hooks/lib/rate-limit').buildResumePrompt('$WORKFLOW_ID'))")
```

Then invoke the `CronCreate` tool: `cron=$CRON, prompt=$PROMPT, recurring=false`.

**Schedule in UTC.** `buildCronExpression` returns the expression in **UTC** — a
reset is an absolute instant, and a local-time cron drifts across DST/timezone.
Pass `CronCreate`'s UTC / timezone option so it fires the expression in UTC. Only
if your scheduler interprets cron in local time, build it with
`buildCronExpression('$RESETS_AT', { timezone: 'local' })` instead.

Store the returned cron job ID in `state.phase.rate_limit.cron_job_id` (re-run
step 2's snippet with `cronJobId` set).

### 4. Report to the user

Print the pause report verbatim — it includes ETA and the manual resume command:

```bash
node -e "console.log(require('$PLUGIN_ROOT/hooks/lib/rate-limit').buildPauseReport('$WORKFLOW_ID', '$RESETS_AT', '$RATE_LIMIT_REASON'))"
```

Then **return / exit the supervisor turn**. Do not continue spawning agents.
The cron will fire `/workflow:resume <id>` when the limit clears.

### 5. On resume

The shared resume skill (`/workflow:resume`) checks `state.phase.rate_limit`
**regardless of execution style**. If `paused_at` is set and `resumes_at` has
passed, it:

1. Calls `clearRateLimitPause(state)` and writes back the state.
2. Logs `"Usage limit cleared. Resuming workflow."`.
3. Re-enters at the **last completed gate boundary** — `workflow_phase` records
   where the supervisor was, and resume restarts that phase. The finest durable
   checkpoint is per-gate (`state.gates.<gate>.{status,iteration}`), so a gate
   that was mid-flight when the limit hit **re-runs whole** (acceptable — the
   gates are idempotent fixed points; sub-gate checkpointing is a later
   refinement). Control then passes to the swarm or epic resume branch.

If `resumes_at` is still in the future the resume skill offers the user three
choices: wait (re-schedule cron), cancel pause and try anyway, or exit.

## Why one protocol for all workflows?

Before this refactor, only the epic workflow handled rate limits. A swarm
supervisor would hit a limit, silently fail, and lose hours of work waiting for a
human to notice. With the shared protocol, every supervisor pauses cleanly and
self-resumes at the reset instant — autonomy is preserved across 5-hour and
weekly quota windows.

## Don't re-implement

- Don't write your own marker list — call `detectRateLimit(text)`.
- Don't compute reset times manually — call `getNextResetIso()`.
- Don't re-shape `state.phase.rate_limit` — call the apply/clear helpers.
- Don't build cron strings by hand — call `buildCronExpression()`.

If a supervisor needs additional pause behaviour (e.g., partial-batch save,
worktree cleanup), do it **after** step 2 (state persisted) and **before**
step 4 (report).
