# Workflow Orchestrator - Usage Examples

## Execution Styles

The plugin supports two long-running autonomous workflow styles:

- **Swarm** — single git worktree, parallel executor batches (up to 4), N-lens fan-out review gate (core lenses: correctness/security/code-quality + extended lenses scaled to change profile; loop-until-dry; adversarial verification ≥3 skeptics per finding; zero-tolerance routing). Use for large single-feature implementations.
- **Epic** — multi-worktree, one per component, full quality pipeline per component, dependency-ordered integration. Use for multi-component projects or greenfield apps.

## Basic Usage

```bash
# Swarm mode — parallel executors within one worktree
/workflow:start swarm: "Build notification system with email and push channels"

# Epic mode — decompose into components, each gets its own worktree + PR
/workflow:start epic "Build a REST API with auth, products, and orders"

# E2E test generation
/workflow:test-e2e http://localhost:8080 --framework=laravel --auth=form

# Interactive live browser testing
/workflow:test-live http://localhost:8080 --user=admin@test.com --pass=secret
```

## Swarm Workflow Walkthrough

1. **You invoke:** `/workflow:start swarm: "Implement dark mode support"`

2. **Codebase Analysis:**
   - `workflow:codebase-analyzer` explores the repo
   - Saves conventions to `~/.claude-workflows/context/<repo-key>.md`

3. **Planning:**
   - `workflow:architect` (opus) creates a detailed plan
   - Plan saved to `~/.claude-workflows/active/<repo-key>/<id>.org`

4. **Parallel Implementation (batches):**
   - Up to 4 `workflow:executor` agents run simultaneously per batch
   - Each handles an independent slice (types, service A, service B, etc.)
   - Batches are dependency-ordered

5. **Fan-Out Review Gate:**
   - N lenses run in parallel (core: functional-completeness, security, code-quality; extended lenses added by change profile)
   - Each lens reports every candidate finding — no self-filtering, no per-lens verdict
   - Loop-until-dry: rounds repeat until K consecutive rounds surface nothing new
   - Adversarial verification: ≥3 independent skeptics try to refute each finding; majority-to-confirm
   - Zero tolerance: any confirmed finding blocks, routes to executor fix, and the entire gate re-runs; gate passes only on a full dry loop with zero confirmed findings

6. **Quality Gate:**
   - `workflow:quality-gate` runs build, type-check, lint, tests

7. **Completion Guard:**
   - `workflow:completion-guard` re-runs tests and verifies each requirement

8. **Done:** state file updated, summary output, you review and commit manually.

## Epic Workflow Walkthrough

1. **You invoke:** `/workflow:start epic "Build a compiler front-end"`

2. **Architecture Phase:**
   - `workflow:architect` decomposes project into components with a dependency DAG
   - Components: e.g., lexer, parser, AST, type-checker, code-gen

3. **Component Execution (waves, parallel worktrees):**
   - Wave 1: independent components run in parallel (max 4 worktrees)
   - Wave 2: components that depend on wave 1, and so on
   - Each component runs the full swarm pipeline (analysis → plan → impl → fan-out review gate → QG → CG → PR)
   - Rate limit hit? Workflow pauses and auto-resumes at exact reset time

4. **Integration Phase:**
   - `workflow:epic-integrator` merges PRs in dependency order
   - Conflict resolution, full test suite run

5. **Completion Guard:** final requirements verification.

## State Files

State is tracked per-repository in `~/.claude-workflows/active/<repo-key>/`.

```bash
# Check active workflows for this repo
node ~/.claude/plugins/workflow/lib/active-dir-cli.js

# Check status from within a workflow session
/workflow:status

# Resume an interrupted workflow
/workflow:resume
```

## Interrupting a Workflow

- Stop Claude (Ctrl+C) — state is preserved in the org/md file
- `/workflow:resume` to continue from where it left off
- Edit the state file live to add notes or change objectives before the next step

## Monitoring Progress

The statusline shows live API usage, context window, and session cost:

```
Opus | 5h ██████████ 100% 2h30m | 7d █████░░░░░  52% 3d | + 29% $11.61/$40.00 | ctx ████░░░░░░  42% | $0.87
```

Enable with `/workflow:setup-statusline enable`. [Details](../docs/status-line.md)
