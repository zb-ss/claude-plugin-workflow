# Autonomous Run Configuration & First-Run Setup

The driver (`skills/auto/SKILL.md`) runs unattended, so its posture and limits
come from **config**, not from asking a human mid-run. Configure once, then the
scheduled `/schedule` routine reads the config on every wake.

## Run config

Stored in the plugin settings file (and/or a config file in the private control
repo — never source constants):

| Key | Meaning | Default |
|---|---|---|
| `control_repo` | private GitHub queue repo (`owner/name`) | env `CLAUDE_WORKFLOW_CONTROL_REPO` |
| `scrub_denylist` | path to the operator marker denylist (lives in the **private** control repo) | env `CLAUDE_WORKFLOW_SCRUB_DENYLIST` |
| `approval_posture` | `autonomous` (park on low confidence) or `human_gate` (pause per task after the architect) | `autonomous` |
| `confidence_threshold` | architect confidence below this → park the task as `blocked` | `0.6` |
| `spend_cap_usd` | per-task spend ceiling → on exceed, pause + `blocked` | unset (no cap) |
| `empty_queue_policy` | `once` (stop when queue empties) or `forever` (idle until a new `queued` issue) | `once` |

## Approval posture (asked once, at setup — not per wake)

When the user first turns on autonomous mode (interactive `/workflow:auto` or
`/workflow:setup`), ask the posture **once** with `AskUserQuestion` and persist
it to `approval_posture`:

- **autonomous** (default) — architect plans auto-approve; tasks below
  `confidence_threshold` move to `blocked` + a clarifying comment rather than
  guessing; `spend_cap_usd` parks runaway tasks. INTERNAL-visibility repos are
  scrubbed like public.
- **human_gate** — after the architect phase, each task pauses for the user to
  approve the plan before implementation.

The scheduled routine never re-asks; it reads `approval_posture` from config.

## First-run scoped permissions (via the `update-config` skill)

Unattended runs need the burst's routine verbs allowed without prompts, while
keeping dangerous verbs gated. On first run, **confirm with the user**, then use
the `update-config` skill to write to `settings.json`:

- **Allow** (`acceptEdits` for file writes + a Bash/MCP allowlist): `git add|commit|status|diff|stash|checkout -b`, build/lint/test runners (`npm|pnpm|yarn`, `composer`, `pytest|tox`, `tsc`), the plugin's own `node lib/*.js` CLIs, read-only `gh`/GitHub-MCP issue ops on the control repo, and the workflow read tools.
- **Never bypass / keep gated** (regardless of posture): `git push --force` / `--force-with-lease`, `git reset --hard`, `rm -rf`, package publishing, and cloud-resource deletion/termination (`aws|ovh|hetzner … terminate|delete`, instance stop). 
- **The scrub gate is never bypassable** — the `scrub-guard` `PreToolUse` hook denies any `git push` / `gh pr create` / GitHub-MCP write to a non-private repo whose surface carries internal markers, *even with a broad allowlist*. Allowlisting `git push *` does **not** disable the scrub gate.

This is forward-safe: the allowlist removes friction for routine work; the
scrub gate + the gated-verb denylist keep the irreversible/leak-prone actions
under control even in fully autonomous mode.

## Guardrails the driver enforces (see `skills/auto/SKILL.md`)

- **Park-on-low-confidence** — `state.architecture.confidence < confidence_threshold` → `transition(... 'blocked')` + comment; stop (don't guess).
- **Spend cap** — `state.spend_usd >= spend_cap_usd` → pause + `blocked` rather than burn the weekly quota.
- **Quota windows** — handled by the Phase-1 `rate-limit.js` pause → one-shot UTC cron → `/workflow:resume`.
