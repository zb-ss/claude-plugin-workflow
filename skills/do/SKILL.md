---
name: do
description: Take a task in plain words from plan to reviewed change. Runs the plan workflow, asks you its questions, then runs implement, which reviews, fixes and signs off the work.
user_invocable: true
usage: /workflow:do <task in plain words>
arguments:
  - name: task
    required: true
    description: What to change, in plain words. Optional phrases change the route (see Options).
---

# /workflow:do

You are the main session. Drive the saved workflows for the task the user typed;
do not plan, code or review it yourself. This skill keeps no state of its own:
everything a later step needs comes from the previous workflow's result.

Workflows run in the background. After each launch, wait for its completion
notification instead of polling, then read its result.

## Options

Read these from the user's words. Ask only if the intent is unclear.

| The user says | Route |
|---|---|
| "plan only", "just plan", "don't implement" | Steps 1-2, then stop after showing the plan |
| "review", "review my changes", "review only" | Step 5 only |
| "hard", "tricky", "careful", "security-sensitive" | Pass `judge_effort: "xhigh"` to every workflow |
| "quick", "small", "routine" | Pass `judge_effort: "medium"` and `worker_effort: "low"` |
| "include optional", "with the hardening" | Pass `include_optional: true` to implement |

Strip the option phrases from the task text before passing it on.

**Judge fallback.** The judge agents pin the `fable` model alias, and the workflows
retry a judge that returns nothing once on `opus`. If
`${CLAUDE_WORKFLOW_STATE_DIR:-~/.claude-workflows}/preferences.json` exists and sets
`judge_fallback`, pass that value as `judge_fallback` to every workflow you run.
Otherwise pass nothing and the default applies.

## Steps

1. **Plan.** Run `Workflow({ name: "workflow:plan", args: { task, ...efforts } })`.
2. **Questions.** If the result has `status: "questions"`, put its questions to the
   user (AskUserQuestion, offering each question's `options` when it has them).
   Run plan again with `{ task, answers: [{ question, answer }], findings: result.findings,
   explore: result.explore, round: <previous round + 1>, ...efforts }`. Repeat until
   it returns `status: "plan"`. After three rounds of questions, stop and ask the
   user whether to narrow the task.
3. **Confirm.** Show the plan's summary, its acceptance criteria and its work items
   in a few lines, marking optional items. Ask whether to implement it. If the user
   wants changes, rerun plan with their notes added to the answers.
4. **Implement.** Run `Workflow({ name: "workflow:implement", args: { plan: <the plan
   result>, ...efforts, include_optional } })`. Leave `max_agents` at its default unless
   the user set a limit.
5. **Review only.** For the review route, run
   `Workflow({ name: "workflow:review", args: { context: <the user's words>, ...efforts } })`.
   It covers every uncommitted change; pass `paths` if the user named files or folders.

## Report

Summarise the result in a few lines:

- `status`, and `stopped` with its reason if the run stopped early
- what changed: `changed_files`, or for review the scoped files and their risk
- review: open findings, findings nobody could verify, and how many notes came back
- sign-off: approved or not, and its issues; say plainly if it did not run
- cost-relevant facts: `agents_used`, the `effort` levels used, and per-lens counts
  from `lens_stats`
- any judge stage listed in `judge_fallback.used`: say it ran on the fallback model

Do not commit. Leave the changes for the user to review.

## When a judge step returns nothing

A workflow script cannot see why an agent failed: a failed agent just returns no
result. The workflows already retry a judge once on the fallback model, so a judge
that still returns nothing is a real failure. The signs: plan stops with "the judge
returned no result", a lens is listed as missing, or the sign-off reports
`completion-guard returned no result`. Read the failed agent's transcript in the
run's transcript directory (the launch result names it) and relay its error to the
user. Only when `judge_fallback.model` in the result is `none` and the error says
the model is unavailable, add one sentence: the judges use the `fable` alias, and
running `/workflow:setup` turns the opus fallback back on.
