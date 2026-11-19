# Workflow Plugin for Claude Code

Plans, implements and reviews code changes with a team of agents on tiered models: a
strong model for judgement, a cheaper one for the work, and the cheapest for mechanical
steps. You type one command and a task in plain words; the plugin plans it, asks you what
it needs to know, implements it, reviews it with findings checked against the code, fixes
what the review confirms, and signs the work off. Nothing is committed for you by
`/workflow:do`; the autonomous driver is the exception and opens pull requests.

It also ships a usage status line, a browser check for user-facing changes, a scrub gate
that keeps internal names and secrets out of public repositories, and an autonomous
driver that works through a queue of GitHub issues.

## Quick start

1. Install, then restart Claude Code:

   ```
   /plugin marketplace add zb-ss/claude-plugin-workflow
   /plugin install workflow@zb-ss-workflow
   ```

2. Run `/workflow:setup` once. It configures permissions and offers, each only with your
   yes: a short model-tier note in your global `CLAUDE.md`, the judge fallback (below),
   and the session model recommendation. A startup check reminds you in one line if one
   of these is missing, and stays silent once they are set or you decline.

3. Give it a task:

   ```
   /workflow:do add rate limiting to the login endpoint
   ```

What happens:

1. **Plan.** Explorer agents read the code from several angles; a judge writes a plan
   with acceptance criteria and work items, or asks you questions first.
2. **Confirm.** You see the plan and decide whether to build it.
3. **Implement.** One executor per work item; tests are written unless the plan's items
   already include them.
4. **Review.** The change is reviewed for quality and, unless it is low risk, security.
   Only CRITICAL and MAJOR findings block, and only after a verifier has confirmed each one
   by quoting the code. Minor findings come back as notes.
5. **Fix and sign off.** Confirmed findings are fixed in bounded rounds, then a judge
   checks every acceptance criterion and runs the test suite.
6. **Browser check and demo.** A user-facing change is checked in a real browser before
   sign-off, and a demo is recorded afterwards when a demo skill is configured.
7. **Summary.** What changed, what is still open, the sign-off, and how many agents ran.

Plain words change the route: `/workflow:do plan only …`, `/workflow:do review my changes`,
`/workflow:do careful: …` (judges think longer), `/workflow:do quick: …` (cheaper).

## What it costs

Measured on runs against this repository, at list price as Claude Code reports it. These
are examples, not promises: the size of the change and the codebase drive the numbers.

| Run | Agents | Time | Cost |
|-----|--------|------|------|
| `plan`, one round, mid-size task | 4 | ~5 min | ~$2 |
| `review` of a ~1,800-line change, two lenses | 6 | ~6 min | ~$4.30 |
| `implement`, 3 work items, three review rounds and sign-off | 14 | ~9 min | ~$6.70 |

- The `fable` judges are most of the cost: in the review above, the two review lenses
  were $3.75 of $4.30, and in the implement run $5.29 of $6.70.
- On a subscription, runs draw on your plan's usage limits like any other session.
  Depending on your plan and seat tier, Fable usage can bill to usage credits instead of
  drawing on your plan's included limits, so check `/usage` before relying on the judge
  tier.
- `max_agents` caps a run (default 25), and `/workflows` shows each agent's token use
  while it runs.

## Model tiers

Each agent pins its model and effort in its definition. Your main session is the
orchestrator: it talks to you and launches the workflows, and works best on `opus`.

| Tier | Model alias | Agents | Role |
|------|-------------|--------|------|
| Judge | `fable` | architect, reviewer-deep, security-deep, completion-guard | Planning judgement, code and security review, sign-off |
| Worker | `sonnet` | explorer, executor, test-writer, verifier, web-tester | Exploration, coding, tests, checking findings |
| Mechanical | `haiku` | scope, finding-merger | Scoping a review, merging duplicate findings |

**The judge tier needs the `fable` model.** If your account cannot use it:

- The saved workflows (`/workflow:do`, `plan`, `implement`, `review`) retry a judge that
  returns nothing once on `opus`, and their result says which stages ran on the fallback.
  Change it per run with `judge_fallback`, or for `/workflow:do` in `/workflow:setup`;
  `none` turns the retry off.
- Agents you start yourself outside the saved workflows have no such retry. A
  `fallbackModel` entry in your user settings covers them (`/workflow:setup` offers to
  add it):

  ```json
  { "fallbackModel": ["opus"] }
  ```

- To point the `fable` alias at another model instead, set `ANTHROPIC_DEFAULT_FABLE_MODEL`
  in the `env` block of your settings. If your organization's `availableModels` list
  blocks `fable`, Claude Code substitutes a permitted model by its own rules.

## Commands

| Command | What it does |
|---------|--------------|
| `/workflow:do <task>` | **Start here.** Plan, questions, implement, review, fix, sign-off |
| `/workflow:plan` | Plan a task, or return the questions that block a plan |
| `/workflow:implement` | Build a plan, then review, fix and sign off |
| `/workflow:review` | Review uncommitted changes, with verified findings |
| `/workflow:setup` | Permissions, the model-tier note, the judge fallback |
| `/workflow:setup-statusline` | Turn the usage status line on or off |
| `/workflow:verify` | Run build, type, lint, test and security checks on current changes |
| `/workflow:queue` | Manage the autonomous task queue |
| `/workflow:auto` | Run the autonomous driver |

## Saved workflows

`plan`, `implement` and `review` are saved workflows that Claude Code's workflow runtime
runs in the background; `/workflow:do` drives them for you. Called directly, they take
arguments for scope, effort, the judge fallback and an agent cap. The
[workflows reference](docs/workflows.md) lists every argument and result field, and how
the review spends its agents.

## Autonomous driver and queue

`/workflow:queue` manages a queue of tasks kept as issues in a private GitHub repository.
`/workflow:auto` runs on a local schedule as a headless session and works through the
queue. For each issue it runs the plan and implement workflows in the mapped local
checkout (`target_repos` in `preferences.json`). When the plan needs answers, it parks the
issue as blocked with the questions in a comment. For complete work it commits on a
branch per issue, runs the repository's full test suite locally, pushes and opens a pull
request through the scrub gate, then moves the issue to review. It never pushes the
default branch and never force-pushes. You manage the queue from GitHub, including from
your phone.

To set it up, point your coding agent at [SETUP.md](SETUP.md): *"Set up the autopilot
system by following SETUP.md."* It creates the private queue repository, seeds the scrub
denylist with you, wires the configuration, verifies it, and hands you the few steps only
you can do.

## Status line

```
Opus | 5h ██████████ 100% 2h30m | 7d █████░░░░░  52% 3d | ctx ████░░░░░░  42% | $0.87
```

Shows the 5-hour and 7-day usage limits, the context window and the session cost, from
the data Claude Code passes to the status line: no credentials and no network. An
extra-usage spend segment (`+ 29% $11.61/$40.00`) is an opt-in, off by default; turning it
on reads your local Claude credentials and calls an undocumented endpoint that may change.
[Setup and details](docs/status-line.md)

## Scrub gate

Before a push or pull request to a non-private repository, a hook scans the change, the
commit messages and the branch name for secrets, AI-assistant context files, real IP
addresses, and the internal names on your private denylist, and blocks the write if it
finds any. Point `CLAUDE_WORKFLOW_SCRUB_DENYLIST` at your denylist file; a `~/` path
works on every machine that shares your settings. [SETUP.md](SETUP.md) covers the
denylist.

## Documentation

| Guide | Covers |
|-------|--------|
| [Saved workflows](docs/workflows.md) | Arguments, results, review design, effort and fallback |
| [Status line](docs/status-line.md) | Setup, segments, the extra-usage opt-in |
| [Settings and permissions](docs/settings.md) | Permissions, hooks, recommended configuration |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and fixes |

## Requirements

- Claude Code with dynamic workflows (available on paid plans; on Pro, turn them on in
  `/config`)
- Access to the `fable` model for the judge tier, or a fallback as described above
- Node.js and git
- Linux, macOS, Windows or WSL

## License

MIT
