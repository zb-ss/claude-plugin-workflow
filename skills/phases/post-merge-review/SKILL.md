---
description: N-reviewer fan-out review-gate engine. Scales a roster of independent review lenses, adversarially verifies every finding, routes confirmed issues to fixes, and loops until dry under zero tolerance. Used by the code_review, security_review, quality, and post_merge_review gates.
disable-model-invocation: true
---

# Multi-Lens Fan-Out Review Engine

This is the canonical review-gate engine for autonomous workflows. It replaces
single-pass review (which under-reports — one lens misses what another catches)
with a scalable fan-out that is **broad on finding** and **strict on verdict**:

1. **Find** — spawn a roster of *N* independent review lenses in parallel; each
   reports **every** candidate finding (coverage, not self-filtering).
2. **Loop-until-dry** — keep spawning rounds until *K* consecutive rounds surface
   nothing new. Different lenses (and re-runs) catch the tail a single pass drops.
3. **Adversarially verify** — every fresh finding is challenged by ≥3 independent
   skeptics that try to *refute* it; only findings that survive are "confirmed".
4. **Route (zero tolerance)** — any confirmed finding blocks, routes to an
   executor fix, and the **entire gate re-runs** (a fixed point, not a single
   pass). The gate passes only on a fully dry cycle with zero confirmed findings.

Scrutiny scales with the change and with remaining quota; the verdict bar does
not. This engine is mandatory for `post_merge_review` (epic + swarm) and is the
mechanism behind the `code_review`, `security_review`, and `quality` gates.

## Which gate is invoking me?

The roster (the set of lenses) depends on the gate. The loop, verification, and
zero-tolerance routing are identical for all of them.

| Gate | Core lenses (always) | Compared against |
|---|---|---|
| `code_review` | correctness, code-quality, error-handling, test-adequacy | changed files vs. project conventions |
| `security_review` | authz, injection, secrets, ssrf/path-traversal, crypto, deps | changed surface (OWASP-complete) |
| `quality` | build, lint, types, test pipeline (via `workflow:quality-gate`) | the whole build |
| `post_merge_review` | functional-completeness, security, code-quality (+ extended below) | the **original scope** (see Inputs) |

## Inputs available in state

Extract the **original scope** so each lens compares delivered work against what
was promised, and read **remaining quota** so the roster scales sanely:

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/workflow}"
node <<'EOF'
const fs = require('fs');
const state = JSON.parse(fs.readFileSync(process.env.WORKFLOW_STATE_FILE, 'utf8'));
const scope = {
  description: state.workflow && state.workflow.description,
  components: state.architecture && state.architecture.components, // epics
  contracts_path: process.env.PROJECT_ROOT && (process.env.PROJECT_ROOT + '/CONTRACTS.md'),
  per_component_plans: state.components || {},          // epics
  acceptance_criteria: (state.workflow && state.workflow.acceptance_criteria) || [],
};
console.log(JSON.stringify(scope, null, 2));
EOF
```

Read remaining quota the same way the epic orchestrator does — the statusline
usage cache (`getNextResetIso` / the `CLAUDE_STATUSLINE_CACHE` JSON). Use it only
to **size** the roster and verifier counts, never to lower the verdict bar.

## Step 1 — Build the roster (scale N to the change, not the verdict)

Always include the gate's **core lenses** (table above). Add **extended lenses**
when the change profile warrants and quota allows — never drop a core lens:

> performance · concurrency/data-races · data-integrity & migrations ·
> API-contract/integration · observability/logging · config & secrets ·
> dependency/supply-chain · accessibility (FE-facing) · resilience/failure-modes

Sizing heuristic (raise N for any that apply): many files / high LOC changed;
criticality tags (`auth`, `billing`, `payment`, `production`, `critical`);
FE-facing diff (adds accessibility); schema/migration changes (adds
data-integrity); concurrency primitives touched (adds data-races). When
remaining quota is low, shrink the *extended* set and lean on loop-until-dry
across resumed sessions — keep the core lenses and the ≥3-skeptic verification.

## Step 2 — Find: spawn the roster in parallel

Spawn every lens with `run_in_background=true`, opus tier (quality > cost at a
gate), and wait for all. Each lens **reports every candidate finding** in the
`[ISSUE-N]` format from `skills/phases/review/SKILL.md` — with a `confidence`
(high/medium/low) and `severity` (CRITICAL/MAJOR/MINOR) per finding. Lenses do
**not** self-filter and do **not** emit a gate verdict — coverage is their job;
verification and the verdict are this engine's job.

```
# one Agent() per lens — example for the security lens
Agent(
  subagent_type="workflow:security-deep", model="opus", max_turns=15,
  run_in_background=true, description="security lens",
  prompt=f"""# Review lens: SECURITY (finding pass — report everything)
  Scope: {scope}
  Report EVERY candidate finding, including ones you are uncertain about or
  consider low-severity. Do NOT filter for importance or confidence — a separate
  verification step does that. For each, emit an [ISSUE-N] block with confidence
  and severity. Coverage is the goal; a finding that later gets refuted is fine,
  a silently-dropped real bug is not. Do not propose fixes; do not emit a verdict.
  """
)
```

Use `workflow:reviewer-deep` for code/quality lenses, `workflow:security-deep`
for security lenses, `workflow:quality-gate` for the build/lint/test lens. Run
≥2 reviewers on the same lens when the change is large — independent reviewers on
one lens still surface different findings.

## Step 3 — Loop-until-dry (exhaust the finder tail)

```python
K = 2                  # consecutive dry rounds required to consider finding exhausted
seen = {}              # dedup key (file:line:claim, normalized) -> finding
dry = 0
round = 0
while dry < K:
    round += 1
    roster = build_roster(change_profile, remaining_quota())   # Steps 1–2
    raw = spawn_roster_parallel(roster)                        # all findings, all lenses
    fresh = [f for f in flatten(raw) if dedup_key(f) not in seen]
    if not fresh:
        dry += 1                 # this round added nothing new
        continue
    dry = 0
    for f in fresh: seen[dedup_key(f)] = f
    # carry `fresh` into Step 4 (verify) — accumulate confirmed across the cycle
```

Dedup on a normalized key (file + line-ish + claim), not exact text — two lenses
phrasing the same bug differently must collapse to one finding.

## Step 4 — Adversarially verify every fresh finding

For each fresh finding, spawn **V independent skeptics** (V ≥ 3) that try to
**refute** it. Give them distinct lenses where the finding can fail in different
ways: *correctness* (is the claim true?), *reachability & impact* (can it
actually be triggered, and does it matter?), *reproduction* (write/trace the
exact input that exhibits it). Each skeptic **defaults to `refuted` unless it can
prove the finding real and reachable**.

```python
def verify(finding):
    lenses = ["correctness", "reachability_and_impact", "reproduction"]
    votes = spawn_parallel([
        Agent(subagent_type="workflow:reviewer-deep", model="opus", max_turns=8,
              run_in_background=true,
              prompt=f"""Try to REFUTE this finding. Default to refuted=true unless
              you can prove it is real AND reachable in the changed code.
              Finding: {finding}. Lens: {lens}.
              Return exactly one line: REFUTED or CONFIRMED, then one sentence of evidence.""")
        for lens in lenses
    ])
    confirmed = sum(1 for v in votes if v == "CONFIRMED") >= (len(votes)//2 + 1)  # majority
    return confirmed
```

Scale V up (5) for CRITICAL-severity or `auth`/`billing`/`production`-tagged
findings; never below 3. A finding survives only on a **majority** of CONFIRMED
votes. This is what kills plausible-but-wrong findings so the gate's
zero-tolerance doesn't cry wolf.

## Step 5 — Route confirmed findings (zero tolerance, fixed point)

If the cycle produced **zero** confirmed findings across a full dry loop → the
gate **PASSES**. Record evidence (Step 7) and advance.

If **any** finding is confirmed → the gate **BLOCKS**:

1. Emit the confirmed findings as a numbered `[ISSUE-N]` list (the format and
   the RESOLVED/NOT-RESOLVED/REGRESSED re-verification protocol live in
   `skills/phases/review/SKILL.md`).
2. Spawn `workflow:executor` to fix **every** confirmed item — no deferrals, no
   "won't fix" (it may only push back with counter-evidence that a finding is
   technically wrong; route that back through Step 4 as a fresh refutation).
3. After the executor reports its Fix-Report, **re-run the entire gate from
   Step 1** — fixes can regress or introduce new issues, so the whole
   find→verify loop repeats. Reset `seen`/`dry`; keep the all-time confirmed log
   for the audit trail.

The gate is a fixed point: it passes only when a complete find→verify cycle
yields zero confirmed findings, K dry rounds in a row, with no fix needed.

```python
MAX_FIX_CYCLES = 6   # config: max_code_review_iterations / max_security_iterations
for cycle in range(MAX_FIX_CYCLES):
    confirmed = run_find_verify_until_dry()    # Steps 1–4
    if not confirmed:
        gate_pass(); break
    route_to_executor_fix(confirmed)           # Step 5.2
# else: do NOT auto-pass — pause and surface the still-confirmed items to the user
```

If `MAX_FIX_CYCLES` is exhausted with findings still confirmed, **do not
auto-pass**. Pause and ask the user — surfacing known-confirmed gaps beats
silently advancing to `completion_guard`.

## Step 6 — Authoritative gate status (do not trust the scrape)

The supervisor writes the gate result **explicitly** — it is the source of
truth. The `subagent-stop-track.js` hook scrapes verdict words from transcripts
as a best-effort secondary signal only (it frequently yields `unknown`); never
let it decide this gate.

```python
update_state(lambda s: {
  **s,
  "gates": {**s["gates"], GATE: {
     "status": "passed" if passed else "in_progress",
     "iteration": cycle + 1,
     "confirmed_count": len(all_time_confirmed),
     "lenses_run": roster_lens_names,
     "evidence_path": f"{ACTIVE_DIR}/{wid}.review.md",
  }},
})
```

## Step 7 — Evidence

Write the full audit trail — every lens's findings, every verification vote, and
every fix cycle — to `<ACTIVE_DIR>/<id>.review.md` (next to the org file) so the
user can audit the entire chain. Log confirmed-finding evidence into
`state.gates.<gate>.evidence`.

## Quota awareness

Each roster round and verification fan-out is a quota burst. Before each new
round/cycle, run the shared check in `skills/shared/rate-limit-handling.md`. On a
marker, pause the workflow and let the scheduled resume continue the loop —
loop-until-dry is naturally resumable: a resumed session re-enters at the current
fix cycle and re-runs the find→verify loop from a clean `seen` set.

## Why fan-out + adversarial verify (not a single deep reviewer)

A single reviewer trades recall for precision: told "only high-severity," it
investigates thoroughly then *declines to report* what it judges below the bar —
real bugs get silently dropped. Splitting the job fixes both halves: the finding
lenses optimize for **coverage** (report everything), and independent skeptics
optimize for **precision** (refute the noise). Zero-tolerance then applies to the
*survivors* — confirmed, reachable findings — so the gate is both exhaustive and
trustworthy. Scaling N and V to the change (and to quota) buys more of both
without ever lowering the bar.
