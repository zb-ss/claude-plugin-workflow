---
name: auto
description: Autonomous driver: one wake takes the in-flight or next queued issue through the plan and implement workflows and, when the work is complete, a tested pull request. State lives on disk; a later wake continues where this one stopped.
user_invocable: true
usage: /workflow:auto [--repo <control-repo>]
arguments:
  - name: repo
    required: false
    description: Control repository (owner/name) that holds the issue queue. Overrides CLAUDE_WORKFLOW_CONTROL_REPO.
---

# /workflow:auto

One wake makes one pass and exits. It rebuilds everything from disk and the
issue queue, runs the saved plan and implement workflows for one issue, and
leaves enough state on disk for a later wake to continue.

## Rules

- You are the main session. Launch the saved workflows with the Workflow tool
  yourself; never start an Agent to do it. Workflows run in the background: wait
  for the completion notification, do not poll.
- Call plugin CLIs exactly as `node "${CLAUDE_PLUGIN_ROOT}/lib/driver-cli.js" ...`
  and `node "${CLAUDE_PLUGIN_ROOT}/lib/queue-cli.js" ...`, written out in every
  command. The path is substituted in this file only. It is not a shell variable,
  so never write `$PLUGIN_ROOT` or a fallback path.
- Tools do not expand `~`: run `echo $HOME` first and use absolute paths.
- Never commit to or push the default branch. Never force-push (`--force`,
  `--force-with-lease`, a `+refspec`). Never reword content to get past the scrub
  gate.
- Never print, log, commit or quote the contents of `.creds` or other secret
  files.
- The control repository is private: never mention it, its issue numbers or its
  URLs in a commit message, branch name, pull request title or body of a target
  repository.
- Every comment on the issue goes through `driver-cli.js comment` or `park` with
  `--body-file`. Write the text with the Write tool into the task's `data_dir`
  first. These commands mark the comment as the driver's.

## Step 0: Preflight

Resolve the control repository: `--repo`, else `CLAUDE_WORKFLOW_CONTROL_REPO`. If
neither is set, print
`[auto] Control repo is not set. Pass --repo <owner/repo> or set CLAUDE_WORKFLOW_CONTROL_REPO.`
and stop.

Run `node "${CLAUDE_PLUGIN_ROOT}/lib/driver-cli.js" install-wake`. It keeps the
installed launcher current.

## Step 1: Decide

```
node "${CLAUDE_PLUGIN_ROOT}/lib/driver-cli.js" next --repo <control> --session "${CLAUDE_SESSION_ID}"
```

The JSON has `action`, `settings` (target_repos, demo_skill, max_agents,
max_attempts, judge_fallback) and, for a task, `task` and `data_dir`. Act on
`action`:

- **busy**: another wake is running. Print one line and stop.
- **idle**: print `[auto] Queue empty.` and stop.
- **park** (reason `retry_limit`): run
  `node "${CLAUDE_PLUGIN_ROOT}/lib/driver-cli.js" park <n> retry_limit --repo <control> --body-file <file>`
  with a comment saying which stage reached the retry limit. Stop.
- **start**: a new queued issue.
  1. `node "${CLAUDE_PLUGIN_ROOT}/lib/queue-cli.js" transition <n> queued in-progress`
  2. `node "${CLAUDE_PLUGIN_ROOT}/lib/driver-cli.js" start <n>`
  3. On `ok` false: `park <n> <reason> --body-file <file>` with a comment that says
     why. For `unmapped_repo` the comment says: add
     `"target_repos": { "<owner/repo>": "~/path/to/checkout" }` to
     preferences.json in the state directory, then relabel the issue `queued`.
     Stop.
  4. On `ok` true: run Setup, post a short start comment and continue with the
     Plan stage.
- **requeued**: a person answered and relabelled the issue.
  `queue-cli.js transition <n> queued in-progress`, then
  `driver-cli.js requeue <n>`, which returns the task and `replies` (the comments
  since the driver's last comment). Run Setup when `task.base_branch` is null.
  Continue with the stage the task is in:
  plan (use the replies as answers), implement (append the replies to the plan
  result's `task` string under the line `Notes added after an earlier run:`
  before launching), close_out (retry it).
- **continue**: run Setup when `task.base_branch` is null, then go to the stage in
  `task.stage`.
- **resume_run**: a workflow run was launched and its result never recorded.
  When `same_session` is true, launch the same workflow again with the same args
  and `resumeFromRunId: "<task.run.run_id>"` so finished agents return their saved
  results (if the tool asks for a script path instead of a name, use the one the
  first launch result reported). When false, the earlier session is gone: launch
  the stage again from the saved inputs. Record the new run as described below and
  count the attempt first, as at the start of the Plan and Implement stages.

Every `driver-cli.js` command takes `--repo <control>`.

## Setup

Runs for a task whose `base_branch` is null: a new task, or one whose setup was
interrupted or parked as `dirty_tree`.

1. `git -C <repo_path> status --porcelain` must be empty; otherwise park with
   reason `dirty_tree` and a comment stating only that the checkout has
   uncommitted changes. Stop.
2. Find the default branch with
   `git -C <repo_path> symbolic-ref --short refs/remotes/origin/HEAD` (strip
   `origin/`) and run `git -C <repo_path> fetch origin`.
3. If `git -C <repo_path> rev-parse --verify <task.branch>` succeeds, run
   `git -C <repo_path> switch <task.branch>`; otherwise
   `git -C <repo_path> switch -c <task.branch> origin/<default>`.
4. `driver-cli.js patch <n> '{"base_branch":"<default>"}'`.

## Leaving the checkout

Before any park after Setup, leave the repository clean so the next issue for it
can start. Stage the files the implement result names (as in Close-out), commit
them as `wip: <short summary>`, and run
`git -C <repo_path> stash push --include-untracked -m "<task.branch>"` when the
tree is still dirty. Then `git -C <repo_path> switch <base_branch>`. The Implement
and Close-out stages restore the work as described under "Returning to the task
branch".

## Returning to the task branch

Implement and Close-out both start here, so a retry after a park finds its work:

1. When `git -C <repo_path> rev-parse --abbrev-ref HEAD` already prints the task
   branch, go to step 2. Otherwise `git -C <repo_path> status --porcelain` must be
   empty before switching: the changes in it are not the driver's. If it is not
   empty, park with reason `dirty_tree` and a comment stating only that the
   checkout has uncommitted changes and must be cleaned before the issue is
   relabelled `queued`. Do not run "Leaving the checkout": the changes are neither
   committed nor stashed. Stop. When it is empty, run
   `git -C <repo_path> switch <task.branch>` and confirm `rev-parse --abbrev-ref
   HEAD` prints the task branch and not the default branch.
2. Find the stash entry named after the task branch with
   `git -C <repo_path> stash list --format='%gd %gs'` (the message ends with the
   branch name). When one exists, restore exactly that entry with
   `git -C <repo_path> stash pop <stash reference>` (for example `stash@{1}`),
   never a bare `stash pop`, which takes the newest entry of any task.

## Plan stage

First run `driver-cli.js patch <n> '{"attempt":"plan"}'`, so a launch that fails
before it returns still counts toward the retry limit.

The task text is the issue's Description, then the `Acceptance criteria:` and
`Constraints:` lists from `queue-cli.js read <n>`. Launch:

```
Workflow({ name: "workflow:plan", args: { task, repo: <task.repo_path>, round: <task.plan_round>, answers: <task.answers>, findings, explore, judge_fallback } })
```

`findings` and `explore` come from `<data_dir>/plan-result.json` when it exists
from an earlier round. Pass `judge_fallback` only when settings has one.

Right after launching, record the run:
`driver-cli.js patch <n> '{"run":{"workflow":"plan","run_id":"<run id from the launch result>","session_id":"${CLAUDE_SESSION_ID}"}}'`.

When it completes, save the result as `<data_dir>/plan-result.json`: copy the
result file the launch result names with `cp` when there is one, otherwise write
it with the Write tool.

- **status questions**: write a comment that numbers each question with its `why`
  and its options and asks the reader to answer in a comment and relabel the
  issue `queued`. Run `park <n> questions --body-file <file>` and stop the wake.
  On the later `requeued` action, build `answers` by appending one
  `{question, answer}` per question from the replies. When the replies do not map
  to single questions, use one entry whose question is the numbered list and whose
  answer is the full reply text. `patch` the answers and the incremented
  `plan_round`, then launch plan with the saved findings and explore.
- **status plan**: `patch <n> '{"stage":"implement","run":null}'` and go straight
  on to the Implement stage. There is no approval stop.
- **the workflow fails or returns nothing**: leave the state as it is and stop.
  The next wake retries until the retry limit.

## Implement stage

First run `driver-cli.js patch <n> '{"attempt":"implement"}'`. Follow "Returning to
the task branch". Compute the review base with
`git -C <repo_path> merge-base <task.branch> origin/<base_branch>`, so work already
committed on the branch (a `wip:` commit from an earlier park) stays inside the
reviewed diff. Launch:

```
Workflow({ name: "workflow:implement", args: { plan: <the saved plan result>, repo: <repo_path>, base: <merge-base commit>, max_agents, demo_skill, judge_fallback } })
```

Pass `max_agents`, `demo_skill` and `judge_fallback` only when settings has them.
Record the run with workflow `implement` as above. Save the result as
`<data_dir>/implement-result.json`.

- **status complete**: `patch <n> '{"stage":"close_out","run":null}'` and continue
  with Close-out.
- **status needs_attention**: `park <n> needs_attention --body-file <file>` with a
  comment giving `stopped`, the open and unverified findings, the sign-off issues,
  the browser check result and what was dropped. Leave the checkout as described
  above before parking. Stop.

## Close-out stage

First run `driver-cli.js patch <n> '{"attempt":"close_out"}'`.

1. Follow "Returning to the task branch" (the checkout may be on the base branch
   after an earlier park).
2. Stage only the files the implement result names (`changed_files`,
   `tests.test_files`, every fix round's `files_changed`) with
   `git -C <repo_path> add -- <files>`. If `git -C <repo_path> status --porcelain`
   then still shows other modified or untracked files, do not stash or switch:
   leave them where they are on the task branch and park with reason
   `needs_attention`. The comment lists the files and says exactly what to do in
   the checkout `<repo_path>`: commit them to the task branch, delete them, or
   ignore them (for example with `.git/info/exclude`), and that a reply alone does
   not resolve it; then relabel the issue `queued`. A requeued Close-out runs this
   check again and passes once the files are dealt with.
3. Commit with a conventional commit message built from the plan summary. When
   nothing is staged because the work is already committed, amend the top
   `wip:` commit's message instead (`git -C <repo_path> commit --amend -m '<message>'`);
   if HEAD is not a `wip:` commit, continue without a new commit. Record the
   commit either way: `git -C <repo_path> rev-parse HEAD`.
4. Run the full suite on that exact commit. List every job the repository's CI
   runs for a pull request (read `.github/workflows/*.yml` or the repository's
   other CI configuration, and its rule files such as CLAUDE.md, AGENTS.md or
   CONTRIBUTING for the commands) and run each job's commands locally in
   `<repo_path>`. Use a background shell for long commands. Record pass and fail
   counts per job. Afterwards HEAD must still be the recorded commit and the tree
   clean.
5. If any job fails or cannot run locally (missing service, secret, runner or
   platform), do not push: `park <n> suite_failed --body-file <file>` with each
   job's result and the reason. The commit stays local; switch the checkout back
   to the base branch. Stop.
6. `queue-cli.js transition <n> in-progress scrub-pending`. Push with the
   directory in the command so the scrub gate scans the right repository:
   `cd "<repo_path>" && git push -u origin <task.branch>`
7. Write the pull request body into `<data_dir>/pr-body.md`: the summary, what
   changed, a table with every CI job and its pass/fail counts, the review
   outcome, the browser check result and the proof video result. Then open the
   pull request the same way:
   `cd "<repo_path>" && gh pr create --base <base_branch> --head <task.branch> --title '<title>' --body-file <data_dir>/pr-body.md`
   The title is a literal single-quoted argument with no single quote inside.
8. If the scrub gate denies the push or the pull request:
   `park <n> scrub_failed --from scrub-pending --to scrub-failed --body-file <file>`
   with the gate's reason, switch the checkout back to the base branch and stop.
   Do not retry with reworded content.
9. On success: `queue-cli.js transition <n> scrub-pending review`, a comment with
   the pull request link, `driver-cli.js finish <n> --pr <url>`, then
   `git -C <repo_path> switch <base_branch>`.

A person reviews and merges the pull request and moves the issue to done.

## What a later wake finds

- The task file in the driver's state directory: stage, branch, plan round,
  answers, attempt counts and the pointer to the last launched run.
- The saved results in the task's `data_dir`: `plan-result.json` and
  `implement-result.json`.
- The session pointer. The launcher resumes the session that left a run
  unfinished, which is what lets finished agents return their saved results.

## Scheduling

Local machine only. `driver-cli.js install-wake` prints the launcher path.
Schedule `node "<state dir>/driver/wake.js"` with cron, a systemd timer or Task
Scheduler. The launcher:

- sets `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`, because `claude -p` otherwise
  stops a running workflow 10 minutes after its last turn;
- holds a lock so wakes never overlap;
- passes each mapped repository as an additional directory.

- skips a wake while a manual pass holds the pass lock.

A manual `/workflow:auto` in a session does one pass the same way. `next` takes a
pass lock for it (it expires after `driver_pass_lock_minutes`, default 240), so a
scheduled wake does not start a second run in the same checkout. `idle`, `park`
and `finish` release it. On any other stop, run
`node "${CLAUDE_PLUGIN_ROOT}/lib/driver-cli.js" release`.

## Errors

| Situation | Action |
|---|---|
| A `queue-cli.js` call fails | Change nothing, release the pass lock and stop; the next wake retries. |
| A workflow launch fails | Release the pass lock and stop; the attempt was already counted, so the retry limit bounds repeats. |
| A person changed the label while the task was active | Park the local task with a comment. |

Configuration and permissions for unattended runs are in
`resources/autonomy-config.md`.
