# Workflow Plugin for Claude Code

Long-running autonomous development workflows with parallel agent execution, zero-tolerance review gates, and repo-scoped state isolation.

**State tracking in Emacs org-mode or Markdown** — edit your plans live while Claude works.

> ### 🤖 Run it fully autonomously
> Point your coding agent at **[`SETUP.md`](SETUP.md)** — *"Set up the autopilot system by following SETUP.md"* — and it provisions the private task queue, scrub gate, and config on its own, then hands you the few manual steps (restart, schedule). Day-to-day you queue and manage work as GitHub issues, even from your phone. → [Autonomous Setup](#autonomous-setup)

## Highlights

- **Org-mode & Markdown plans** — Human-readable, editable workflow state files
- **Swarm mode** — Up to 4 parallel executors per batch, N-lens fan-out review gate with adversarial verification and zero-tolerance routing
- **Epic mode** — Multi-component projects with one git worktree per component, PR per component, rate-limit resilience, dependency-ordered integration
- **Repo-scoped state isolation** — State files live in `~/.claude-workflows/active/<repo-key>/`; workflows from different repos never collide
- **Hardened review system** — Zero-issue PASS, structured `[ISSUE-N]` tracking, fix-by-ID protocol, opus-tier reviewers
- **Quality and security gates** — `quality-gate` + `completion-guard` run independently after every review pass
- **Outcome-quality gates** — Capability preflight (loads the right convention skills + verifies tooling), spec-conformance (every acceptance criterion verified against evidence), risk-scaled review depth, coverage-on-changed-lines + mutation-lite, Context7 version-grounding, and per-repo lessons memory that compounds quality across runs
- **Status line** — Live API usage limits, context window, and session cost in your status bar
- **E2E testing** — Automated Playwright test generation via browser exploration
- **Autonomous autopilot** — A private GitHub-issues queue + a scheduled driver run tasks unattended across many repos, surviving usage-limit windows; manage it all from GitHub (even your phone)
- **Scrub gate** — An unbypassable pre-push check blocks internal/secret information from leaking into public repos
- **Configurable model policy** — role→model is one runtime config knob (presets: `all-opus` / `balanced` / `risk-driven` / `economy`), never hardcoded, plus an optional **Codex cross-model review** lens for an unbiased third pair of eyes from a different model family. See [`resources/model-policy.md`](resources/model-policy.md)

## Installation

```
/plugin marketplace add zb-ss/claude-plugin-workflow
/plugin install workflow@zb-ss-claude-plugin-workflow
```

After installation, restart CC and run `/workflow:setup` to configure permissions.

## Autonomous Setup

To run the plugin **fully autonomously** — a private GitHub-issues queue feeding a scheduled driver that works tasks across your repos unattended — point your coding agent at **[`SETUP.md`](SETUP.md)**:

> "Set up the autopilot system by following SETUP.md."

The agent does everything it safely can on its own — creates the private control repo, the queue labels, the task template, seeds the scrub denylist (asking you for your internal names), and wires the config — then live-verifies it and hands you a short checklist of the steps only you can do (restart Claude Code, the `/schedule` spike). After that you queue and manage work entirely as GitHub issues, even from your phone.

## Quick Start

```bash
# Swarm mode — parallel executors within one worktree
/workflow:start swarm: "Build notification system with email and push channels"

# Epic mode — decompose into components, each in its own worktree
/workflow:start epic "Build a C++ compiler from scratch"

# E2E test generation
/workflow:test-e2e http://localhost:8080 --framework=symfony --auth=form

# Interactive live browser testing (authenticated runs read login from the gitignored ./.creds)
/workflow:test-live http://localhost:8080

# Markdown state files (default is org)
/workflow:start swarm: "Add feature" --format=md
```

## Execution Styles

Two long-running autonomous workflow styles are available:

| Style | Parallelism | Review Gate | Best For |
|-------|-------------|-------------|----------|
| `swarm` | Up to 4 executors/batch, parallel within one worktree | N-lens fan-out review (core lenses: correctness/security/code-quality + extended; adversarial verification; zero-tolerance routing) | Large single-feature implementations |
| `epic` | Up to 4 component worktrees per wave | Full swarm pipeline per component | Multi-component projects, greenfield apps |

Both styles use opus-tier agents for planning, code review, and security review.

## Pipeline

**Swarm:**
```
Codebase Analysis -> Planning (architect/opus)
  -> CAPABILITY PREFLIGHT (detect stack, load convention skills, verify tooling/MCP — park if a hard req is missing)
  -> Implementation Batches (up to 4 parallel executors/batch; grounded in mined conventions + Context7 version docs + per-repo lessons)
  -> Fan-Out Review Gate (risk-scaled depth: N lenses in parallel; loop-until-dry; adversarial verification ≥3 skeptics per finding; zero-tolerance — confirmed finding blocks and re-runs entire gate)
  -> QUALITY GATE (green baseline, build/type/lint/test, coverage on changed lines, run-rarely-run-code, mutation-lite)
  -> SPEC CONFORMANCE (each acceptance criterion verified against evidence — unmet routes back to implementation)
  -> E2E VALIDATION (mandatory for FE-facing changes) -> SCRUB GATE (blocks internal-info leak before any public-repo push)
  -> COMPLETION GUARD (independent test re-run, requirement verification)
  -> COMPLETE (suggests /workflow:test-live if web files changed)
```

**Epic:**
```
Architecture (decompose into components + dependency DAG)
  -> CAPABILITY PREFLIGHT (stack/tooling check before any worktree is created)
  -> Component Execution (parallel worktrees, each runs full swarm pipeline above)
    -> Wave 1: independent components (parallel, max 4 worktrees)
    -> Wave 2: components depending on wave 1
    -> ... (rate limit? pause -> auto-resume at exact reset time)
  -> Integration (merge PRs in dependency order, resolve conflicts, full test suite)
  -> SPEC CONFORMANCE (merged result vs the epic's acceptance criteria)
  -> E2E VALIDATION -> SCRUB GATE
  -> COMPLETION GUARD
  -> COMPLETE
```

## Review System

Every review issue gets a tracked `[ISSUE-N]` ID. Executors must address every issue by ID. Reviewers verify each prior issue on re-review. Zero issues required for PASS — no thresholds or exceptions.

```
ISSUES:
- [ISSUE-1] [CRITICAL] SQL injection - src/auth.php:42 - use parameterized query
- [ISSUE-2] [MINOR] Naming mismatch - src/helper.ts:7 - use camelCase

Re-review:
- [ISSUE-1] RESOLVED
- [ISSUE-2] REGRESSED - fix introduced typo in import
```

[Full review system documentation](docs/review-system.md)

## Agents

| Category | Agents | Models |
|----------|--------|--------|
| Orchestration | supervisor | sonnet |
| Analysis | codebase-analyzer | sonnet |
| Planning | architect | opus |
| Implementation | executor | sonnet |
| Code Review | reviewer-deep | opus |
| Security | security-deep | opus |
| Quality Gates | quality-gate, completion-guard | sonnet, opus |
| E2E Testing | e2e-explorer, e2e-generator, e2e-reviewer | sonnet |
| Browser Testing | web-tester | sonnet |
| Epic Integration | epic-integrator | sonnet |
| Utility | explorer, test-writer | haiku, sonnet |

## Skills

| Command | Description |
|---------|-------------|
| `/workflow:start` | Start a new swarm or epic workflow |
| `/workflow:status` | Check workflow status |
| `/workflow:resume` | Resume an interrupted workflow |
| `/workflow:test-e2e` | Generate E2E Playwright tests for a web app |
| `/workflow:verify` | Run verification loop |
| `/workflow:skill-create` | Generate skills from git history |
| `/workflow:migrate-legacy` | Migrate pre-v2 flat state files to repo-scoped buckets |
| `/workflow:setup` | Configure permissions |
| `/workflow:setup-statusline` | Enable/disable usage status line |
| `/workflow:test-live` | Interactive live E2E testing via Playwright MCP |

## Status Line

```
Opus | 5h ██████████ 100% 2h30m | 7d █████░░░░░  52% 3d | + 29% $11.61/$40.00 | ctx ████░░░░░░  42% | $0.87
```

Live display of 5h session limit, 7d weekly limit, extra usage spend, context window, and session cost. Colors adapt based on usage level. [Setup & details](docs/status-line.md)

## E2E Testing

Generate Playwright E2E test suites from a running web application:

```bash
/workflow:test-e2e http://localhost:8080 --framework=symfony --auth=form
```

6-phase pipeline: Setup → Exploration (BFS via Playwright MCP) → Generation (app map → test specs) → Validation → Quality Gate → Completion Guard. Supports Symfony, Laravel, Vue, React, Next.js with form/token/cookie auth. [Full guide](docs/e2e-testing.md)

## Documentation

| Guide | Description |
|-------|-------------|
| [E2E Testing](docs/e2e-testing.md) | Playwright test generation, selectors, auth strategies, pipeline |
| [Review System](docs/review-system.md) | Structured issue tracking, verdicts, fix-by-ID protocol |
| [Swarm Mode](docs/swarm-mode.md) | N-lens fan-out review gate, parallel batching, Agent Teams |
| [State Files](docs/state-files.md) | Repo-scoped schema, org/markdown formats, live editing |
| [Status Line](docs/status-line.md) | Usage limits display, setup, segments |
| [Parallel Execution](docs/parallel-execution.md) | Git worktrees, cascade method, combined approach |
| [Settings & Permissions](docs/settings.md) | Autonomous execution, hooks, recommended config |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |

## Requirements

- Claude Code with Agent tool access (formerly Task tool — both work, Agent preferred in CC v2.1.63+)
- Git repository
- Node.js (for hooks — included with Claude Code)
- Works on Linux, macOS, Windows, and WSL

## License

MIT
