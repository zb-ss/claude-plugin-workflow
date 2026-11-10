# Saved Workflows

The plugin ships three saved workflows that Claude Code's workflow runtime executes:
`/workflow:plan`, `/workflow:implement` and `/workflow:review`. Most people never call
them directly: `/workflow:do <task>` runs plan, asks you the questions, runs implement
and summarises the result. This page is the reference for calling them yourself.

Watch a running workflow with `/workflows`; you can stop it there at any time.

## Passing input

Each workflow reads an `args` value.

- **From a slash command**, Claude Code passes the text you type after the command as
  one plain string: `/workflow:plan add rate limiting` gives plan the task
  `add rate limiting`. Review reads such text as the intent of the change. Implement
  needs a plan, so it refuses plain text and points you to `/workflow:do`.
- **A string holding a JSON object** is read as the args object, so
  `/workflow:review {"paths": ["src/api"]}` works.
- **When Claude launches a workflow for you**, it passes the args as structured data.

## plan

Explores the codebase from several angles in parallel, then a judge returns either a
complete plan or the questions that block one.

| Arg | Meaning |
|-----|---------|
| `task` | What to build (required) |
| `answers` | `[{question, answer}]` from earlier rounds |
| `findings`, `explore` | Pass back the previous result's `findings` and `explore`: the next round reuses the earlier exploration and explores only what the judge named |
| `angles` | Exploration angles for a first round |
| `judge_effort`, `worker_effort`, `judge_fallback` | See [Effort and fallback](#effort-and-fallback) |

It returns `{status: 'plan', task, plan}` or `{status: 'questions', questions, findings, explore}`.
The plan result keeps the original task so implement can hand executors any exact text it
gives; the judge is also told to copy such text into the work item that needs it.
A workflow cannot ask questions mid-run, so plan runs one round per launch. The plan
keeps hardening beyond the acceptance criteria in work items marked `optional`, and sets
`tests_in_items` when its work items write their own tests.

## implement

Runs one executor per work item (items that share files never run at the same time),
writes tests unless the plan already covers them, reviews the change, fixes confirmed
findings in bounded rounds, and ends with a sign-off.

| Arg | Meaning |
|-----|---------|
| `plan` | The plan result (required) |
| `paths`, `base` | Review these paths against this git ref. Default: the plan's files plus every file reported changed, against `HEAD`, so other uncommitted work is never reviewed |
| `max_fix_rounds` | Fix rounds after the first review (default 2) |
| `verifiers` | Verifiers for CRITICAL and security MAJOR findings (default 3, majority decides) |
| `sign_off` | Run the completion-guard sign-off (default true) |
| `max_agents` | Stop starting agents after this many (default 25); one slot stays reserved for the sign-off |
| `include_optional` | Also build the plan's optional work items (default false) |
| `judge_effort`, `worker_effort`, `judge_fallback` | See [Effort and fallback](#effort-and-fallback) |

The result has `status` (`complete` or `needs_attention`), per-item results, the files
reviewed and their risk, the test report, open, refuted and unverified findings, notes,
per-lens statistics, the sign-off, why the run stopped if it did, and everything it
dropped. It never commits.

## review

Reviews a change and returns findings that verifiers have confirmed against the code.

| Arg | Meaning |
|-----|---------|
| `paths`, `base` | Limit the review. Default: every uncommitted change against `HEAD` |
| `context` | What the change is meant to do |
| `verifiers`, `max_agents` | As for implement |
| `judge_effort`, `worker_effort`, `judge_fallback` | See [Effort and fallback](#effort-and-fallback) |

The result lists the files reviewed and their risk, confirmed findings with the
verifiers' quotes, refuted and unverified findings, notes, and per-lens statistics.

## How the review spends its agents

- **Scope first.** A small agent lists the files in scope and classifies the change's
  risk with `lib/risk-classify-cli.js`. The result lists the files and the risk.
- **Lenses by risk.** A low-risk change gets the quality lens with a short security
  checklist; anything else also gets the security lens.
- **Only CRITICAL and MAJOR findings block.** Each needs a concrete failure scenario.
  MINOR findings come back as notes and start no agents.
- **Duplicates are merged** across lenses before verification. The merge must use every
  finding exactly once, or the findings are verified unmerged; a merged finding keeps
  each original in `merged_from`.
- **Verification quotes the code.** One verifier per finding, three with a majority for
  CRITICAL and security MAJOR findings, at most four findings per verifier. A verdict
  counts only when it quotes the file and line it rests on.
- **Later rounds see only the fixes.** In implement, round 2 onwards reviews the regions
  the fix changed, rechecks the open findings, and is told which findings were already
  refuted. A fix round that changes no files (every finding disputed) sends the open
  findings straight to sign-off instead of reviewing again.
- **Per-lens statistics** (`lens_stats`) record each lens's candidates, blocking
  findings, and confirmed findings only that lens raised.

## Effort and fallback

- `judge_effort` and `worker_effort` override the effort level for one run: judges are
  the `fable` agents (architect, review lenses, completion-guard), workers the `sonnet`
  agents (explorers, executors, test-writer, verifiers). Each takes `low`, `medium`,
  `high`, `xhigh` or `max`; an unknown value stops the run before any agent starts. Left
  out, the agents run at their own levels (judges `high`, workers `medium`, explorer
  `low`), and the `haiku` agents always do. `CLAUDE_CODE_EFFORT_LEVEL`, if set, overrides
  both. The result's `effort` field records what the run used.
- `judge_fallback` is the model a judge is retried on, once, when it returns nothing.
  The default is `opus`; `none` turns the retry off. A workflow cannot see why an agent
  returned nothing, so the retry covers every cause, including a model your account
  cannot use. The result's `judge_fallback.used` lists the stages that ran on the
  fallback.

```text
# A hard change: let the judges think longer
/workflow:do careful: migrate the session store to the new cache layer

# A routine review, cheaper on both tiers
/workflow:review {"paths": ["src/utils"], "judge_effort": "medium", "worker_effort": "low"}
```

## Running headless

For long runs from a headless `claude -p` session, set
`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`. Otherwise `claude -p` stops a workflow that is
still running 10 minutes after its last turn. A stopped run can be relaunched in the same
session with `claude -p --resume <session id>`, and agents that finished return their
saved results.
