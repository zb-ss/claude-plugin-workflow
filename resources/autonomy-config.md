# Driver configuration

The driver (`skills/auto/SKILL.md`) runs unattended, so its settings come from
the environment and from `preferences.json`, not from questions during a run.

## 1. Environment

| Variable | Meaning |
|---|---|
| `CLAUDE_WORKFLOW_CONTROL_REPO` | Private repository (`owner/name`) that holds the issue queue. `--repo` overrides it. |
| `CLAUDE_WORKFLOW_SCRUB_DENYLIST` | Path to the operator's list of markers the scrub gate refuses in public repositories. Keep the list in the private control repository. |
| `CLAUDE_WORKFLOW_CLAUDE_BIN` | Full path of the `claude` binary the wake launcher starts. Default `claude` from the scheduler's PATH. |
| `CLAUDE_WORKFLOW_STATE_DIR` | State directory. Default `~/.claude-workflows`. Holds `preferences.json` and the driver's files under `driver/`. |

## 2. preferences.json

Located in the state directory.

```json
{
  "target_repos": { "owner/repo": "~/projects/repo" },
  "demo_skill": "workflow:record-demo",
  "driver_max_agents": 4,
  "driver_max_attempts": 3,
  "driver_claude_args": ["--model", "opus"],
  "judge_fallback": "opus"
}
```

| Key | Meaning |
|---|---|
| `target_repos` | Maps a Target Repo (`owner/repo`) to a local checkout. An issue whose Target Repo is not mapped is parked as blocked with a comment. |
| `demo_skill` | Name of the skill that records the proof video. Unset means the bundled recorder (`workflow:record-demo`); `"none"` turns the stage off; any other skill name is used as given. |
| `driver_max_agents` | Passed to implement as `max_agents`. Unset means the workflow default. |
| `driver_max_attempts` | Launches per stage before the issue is parked. Default 3. |
| `driver_pass_lock_minutes` | How long a manual `/workflow:auto` pass blocks scheduled wakes if it is not released. Default 240. |
| `driver_claude_args` | Extra arguments for the wake's `claude -p`, for example a model or a permission mode. |
| `judge_fallback` | Model the workflows retry a judge on when it returns nothing. |

## 3. Unattended plan handling

- Plan questions park the issue as blocked, with the questions in a comment. A
  person answers in a comment and relabels the issue `queued`; the next wake reruns
  plan with the replies and the saved findings.
- A returned plan is implemented straight away; there is no approval stop.
- The attempt is counted when a plan or implement stage starts, before any work,
  so a stage that fails before its workflow launches still reaches the retry limit.
- The checkout is switched back to the task branch only when it is clean;
  otherwise the issue is parked as `dirty_tree` and nothing is stashed or
  committed. A close-out park for unnamed files leaves them in place, and the
  comment says what to do; a reply alone does not resolve it.
- Cost is bounded by `driver_max_agents` and the retry limit
  (`driver_max_attempts`).

## 4. Permissions for unattended runs

Allow:

- file edits in the target repositories
- the build, lint and test commands of those repositories
- `git add`, `git commit`, `git switch`, `git fetch`
- `git push` without force
- `gh pr create`
- `gh issue` operations on the control repository
- `node` for the plugin CLIs

Keep denied:

- `git push --force` and `--force-with-lease`
- `git reset --hard`
- `rm -rf`
- package publishing
- deleting cloud resources

## 5. The scrub gate

The scrub gate is never bypassable. Allowing `git push` does not disable it: every
push and pull request creation is still scanned, and a denial parks the issue
instead of retrying with reworded content.
