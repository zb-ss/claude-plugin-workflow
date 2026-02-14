# Workflow Plugin for Claude Code

Automated development workflow orchestration with tiered agents and execution modes.

**State tracking in Emacs org-mode or Markdown** - edit your plans live while Claude works!

## Highlights

- **📋 Org-mode & Markdown plans** - Human-readable, editable workflow state files
- **🤖 23 tiered agents** - From quick haiku checks to deep opus reviews
- **🐝 Swarm mode** - 4 parallel executors with 3-architect validation
- **🧠 Auto-learning** - Learnings saved to project CLAUDE.md, auto-loaded by CC
- **🔒 Hardened review system** - Zero-issue PASS, structured issue tracking, auto-escalation
- **📊 Status line** - Live API usage limits, context window, and session cost in your status bar
- **🎭 E2E testing** - Automated Playwright test generation via browser exploration

## What's New

**E2E Playwright Testing** - Generate end-to-end test suites automatically. The new `/workflow:test-e2e` command explores your web app via Playwright MCP browser automation, builds an app map, generates test specs with accessibility-first selectors, and validates through review gates. Supports Symfony, Laravel, Vue, React, and Next.js with form/token/cookie auth strategies.

**Review Hardening** - Zero-tolerance review verdicts, structured `[ISSUE-N]` tracking across iterations, mandatory executor fix-by-ID protocol, auto-escalation to opus on exhausted iterations, post-quality-gate regression review, and codebase-aware reviews with framework skill loading. [Details](docs/review-system.md)

**Status Line** - See your 5h/7d usage limits, extra spend cap, context window, and session cost at a glance. Color-coded progress bars adapt from green to red. Enable with `/workflow:setup-statusline enable`. [Details](docs/status-line.md)

## Installation

```
/plugin marketplace add zb-ss/claude-plugin-workflow
/plugin install workflow@zb-ss-claude-plugin-workflow
```

After installation, restart CC and run `/workflow:setup` to configure permissions.

## Quick Start

```bash
# Auto-detect mode (RECOMMENDED) - analyzes task complexity
/workflow:start feature "Add user authentication"
# -> Auto-detects: thorough (security-sensitive)

/workflow:start bugfix "Fix typo in README"
# -> Auto-detects: eco (simple change)

# Explicit mode override
/workflow:start feature "Add payment processing" --mode=standard

# Swarm mode for large features
/workflow:start feature swarm: "Build notification system"

# Markdown state files (default is org)
/workflow:start feature "Add feature" --format=md
```

## Execution Modes

| Mode | Model | Code Review | Security | Best For |
|------|-------|-------------|----------|----------|
| `eco` | haiku | max 2 | max 1 | Simple tasks, budget-conscious |
| `turbo` | haiku | max 2 | max 1 | Speed, prototypes |
| `standard` | sonnet | max 3 | max 2 | Regular development (default) |
| `thorough` | opus | max 3 | max 2 | Security-sensitive, production |
| `swarm` | opus | 3-architect | 3-architect | Large multi-file features |

All modes enforce **mandatory blocking reviews** with auto-escalation to opus if iterations exhaust. [Full mode guide](docs/modes.md)

## Pipeline

```
Codebase Analysis -> Planning -> Implementation
     |
Code Review (structured issue IDs, re-review verification)
     | auto-escalation to opus if needed
Security Review
     |
QUALITY GATE (build, type, lint, test, security)
     | post-QG review if auto-fixes were made
COMPLETION GUARD (requirements + code quality spot-check)
     |
COMPLETE
```

## Review System

Every review issue gets a tracked ID. Executors must fix by ID. Reviewers verify each prior issue on re-review. Zero issues required for PASS - no thresholds or exceptions.

```
ISSUES:
- [ISSUE-1] [CRITICAL] SQL injection - src/auth.php:42 - use parameterized query
- [ISSUE-2] [MINOR] Naming mismatch - src/helper.ts:7 - use camelCase

Re-review:
- [ISSUE-1] ✓ RESOLVED
- [ISSUE-2] ⚠ REGRESSED - fix introduced typo
```

[Full review system documentation](docs/review-system.md)

## Agents

23 tiered agents organized by function:

| Category | Agents | Models |
|----------|--------|--------|
| Orchestration | supervisor | sonnet |
| Analysis | task-analyzer, codebase-analyzer | haiku, sonnet |
| Planning | architect-lite, architect | haiku, opus |
| Implementation | executor-lite, executor | haiku, sonnet |
| Code Review | reviewer-lite, reviewer, reviewer-deep | haiku, sonnet, opus |
| Security | security-lite, security, security-deep | haiku, sonnet, opus |
| Quality Gates | quality-gate, completion-guard | sonnet, opus |
| E2E Testing | e2e-explorer, e2e-generator, e2e-reviewer | haiku, sonnet, opus |
| Other | explorer, test-writer, perf-lite, perf-reviewer, doc-writer | haiku, sonnet |

## Skills

| Command | Description |
|---------|-------------|
| `/workflow:start` | Start a new development workflow |
| `/workflow:status` | Check workflow status |
| `/workflow:resume` | Resume an existing workflow |
| `/workflow:mode` | Switch execution mode mid-workflow |
| `/workflow:test-e2e` | Generate E2E Playwright tests for a web app |
| `/workflow:verify` | Run verification loop |
| `/workflow:learn` | Extract reusable patterns from session |
| `/workflow:skill-create` | Generate skills from git history |
| `/workflow:setup` | Configure permissions |
| `/workflow:setup-statusline` | Enable/disable usage status line |

## Status Line

```
Opus | 5h ██████████ 100% 2h30m | 7d █████░░░░░  52% 3d | + 29% $11.61/$40.00 | ctx ████░░░░░░  42% | $0.87
```

Live display of 5h session limit, 7d weekly limit, extra usage spend, context window, and session cost. Colors adapt based on usage level. [Setup & details](docs/status-line.md)

## E2E Testing

Generate Playwright E2E test suites from a running web application:

```bash
# Test a local app (auto-detects framework)
/workflow:test-e2e http://localhost:8080

# With framework and auth
/workflow:test-e2e http://localhost:8080 --framework=symfony --auth=form

# Deep exploration in thorough mode
/workflow:test-e2e http://localhost:3000 --mode=thorough --depth=5

# Just generate config files
/workflow:test-e2e http://localhost:8080 --config-only
```

**Pipeline:** Setup (install Playwright, detect framework, generate config) → Exploration (BFS crawl via Playwright MCP `browser_snapshot`) → Generation (app map → test specs) → Validation (run tests, review quality) → Quality Gate → Completion Guard

**Frameworks:** Symfony, Laravel, Vue, React, Next.js, generic

**Auth strategies:** `form` (login flow discovery), `token` (header injection), `cookie` (session cookie)

**Selectors:** Enforces accessibility-first priority — `getByRole` > `getByLabel` > `getByPlaceholder` > `getByText` > `getByTestId`. CSS selectors and XPath are blocked.

## Documentation

| Guide | Description |
|-------|-------------|
| [Execution Modes](docs/modes.md) | Detailed mode configs, pipelines, agent routing |
| [Review System](docs/review-system.md) | Structured issue tracking, auto-escalation, verdicts |
| [Swarm Mode](docs/swarm-mode.md) | 3-architect validation, parallel batching, Agent Teams |
| [State Files](docs/state-files.md) | Org/markdown formats, live editing, file locations |
| [Status Line](docs/status-line.md) | Usage limits display, setup, segments |
| [Memory & Learning](docs/memory-and-learning.md) | Auto-learning, skills, CLAUDE.md integration |
| [Parallel Execution](docs/parallel-execution.md) | Git worktrees, cascade method, combined approach |
| [Settings & Permissions](docs/settings.md) | Autonomous execution, hooks, recommended config |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |

## Requirements

- Claude Code with Task tool access
- Git repository
- Node.js (for hooks - included with Claude Code)
- Works on Linux, macOS, Windows, and WSL

## License

MIT
