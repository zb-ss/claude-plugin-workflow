# Model & Review Policy

Which model each workflow role uses is **configuration, not hardcoded** — models
change constantly. The supervisor resolves every agent's model through
`lib/model-policy.js` and passes it explicitly when spawning, so the policy is the
source of truth (agent frontmatter is just a fallback default). It also controls
the optional **Codex cross-model review** lens.

## Roles → models

Built-in tiers (the shipped **`all-opus`** default — reasoning *and* coding on opus,
only mechanical/utility cheaper):

| Role | Default | Role | Default |
|---|---|---|---|
| `architect` | opus | `executor` (coding) | **opus** |
| `reviewer` | opus | `codebase_analyzer` | sonnet |
| `security` | opus | `quality_gate` | sonnet |
| `spec_conformance` | opus | `supervisor` | sonnet |
| `completion_guard` | opus | `e2e`, `epic_integrator`, `test_writer`, `web_tester` | sonnet |
| | | `explorer` | haiku |

## Presets

Set `preset` in the policy file or `CLAUDE_WORKFLOW_MODEL_POLICY=<preset>`:

| Preset | Coding | Reviews | Use when |
|---|---|---|---|
| **`all-opus`** (default) | opus | opus | Best first-pass quality, least rework; ~5× cost on every task |
| `balanced` | sonnet | opus | Cheapest sane: sonnet codes, opus reviews + the zero-tolerance gate |
| `risk-driven` | sonnet → **opus on high risk** | opus | Spends opus coding only where the risk classifier flags auth/payments/migrations/complex |
| `economy` | sonnet | sonnet | Lean/throwaway work |

`risk-driven` uses the existing `lib/risk-classify-cli.js` tier — the supervisor
passes `--risk <tier>` to `model-policy.js executor`, escalating the coder to opus
only for high-risk components.

## Configuration

Runtime-editable `model-policy.json` (default `~/.claude-workflows/model-policy.json`;
override path with `CLAUDE_WORKFLOW_MODEL_POLICY_FILE`):

```json
{
  "preset": "risk-driven",
  "overrides": { "executor": "opus" },
  "codex_review": { "enabled": true, "scope": "branch", "mode": "auto" }
}
```

Precedence (highest first): `CLAUDE_WORKFLOW_MODEL_<ROLE>` env var → file `overrides` →
preset → built-in default. Quick experiment without editing the file:
`CLAUDE_WORKFLOW_MODEL_EXECUTOR=sonnet`.

Inspect the resolved policy: `node lib/model-policy.js --show`.

## Codex cross-model review (third pair of eyes)

When `codex_review.enabled` is true, the review gate adds a **Codex** (GPT-5-codex
family) lens — a different model family means less-correlated blind spots than
another opus lens. Codex findings are folded into the same zero-tolerance
`[ISSUE-N]` pool (tagged `[codex]`), so the executor must fix them and the gate
re-runs until clean.

How it runs (the supervisor, via `lib/codex-review.js`):
1. `locateCompanion()` finds the installed `codex-companion.mjs` (version-agnostic).
2. `node <companion> review --base <BASE_BRANCH> --scope branch --background` → job id.
3. Poll `status <id> --json`, then `result <id> --json` → structured findings.
4. `parseReview()` → `toIssueLines()` merges them into the gate's findings.

`/codex:review` itself is `disable-model-invocation: true` (user-triggered), so the
supervisor calls the companion **script directly** rather than the slash command.

**Prerequisite:** Codex must be installed and authenticated once —
`npm install -g @openai/codex` then `codex login` (or `/codex:setup`). The
**capability-preflight** gate checks this when `codex_review.enabled`: if Codex is
unavailable it warns (attended) or parks the task `blocked` (autonomous) rather than
silently skipping the lens. For the unattended autopilot, ensure `codex login` has
persisted a token on the box.

`scope`: `branch` (committed diff vs base — matches the other gates) or
`working-tree`. Keep `mode: auto` for the in-gate lens.
