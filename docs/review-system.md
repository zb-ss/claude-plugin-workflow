# Review System

The review system enforces zero-issue-tolerance across all gates through a multi-lens fan-out engine. The canonical implementation is `skills/phases/post-merge-review/SKILL.md`; the per-lens finding contract is `skills/phases/review/SKILL.md`.

Surviving workflow modes are **swarm** and **epic** only.

## Engine Overview

The engine separates finding from filtering, then applies adversarial verification before zero tolerance:

1. **Find** — spawn a roster of N independent review lenses in parallel; each reports every candidate finding (coverage, not self-filtering).
2. **Loop-until-dry** — keep spawning rounds until K consecutive rounds surface nothing new, catching the tail that a single pass drops.
3. **Adversarially verify** — every fresh finding is challenged by ≥3 independent skeptics that try to refute it; only findings that survive on a majority of CONFIRMED votes are "confirmed".
4. **Route (zero tolerance, fixed point)** — any confirmed finding blocks, routes to an executor fix, and the entire gate re-runs from Step 1. The gate passes only on a fully dry cycle with zero confirmed findings.

This design is used by `code_review`, `security_review`, `quality`, and `post_merge_review` gates. The loop, verification logic, and routing rules are identical for all of them; only the lens roster differs.

## Fan-Out Roster

### Core lenses (always present per gate)

| Gate | Core lenses |
|------|-------------|
| `code_review` | correctness, code-quality, error-handling, test-adequacy |
| `security_review` | authz, injection, secrets, ssrf/path-traversal, crypto, deps |
| `quality` | build, lint, types, test pipeline (via `workflow:quality-gate`) |
| `post_merge_review` | functional-completeness, security, code-quality (+ extended below) |

Core lenses are never dropped, regardless of quota.

### Extended lenses (added when change profile warrants and quota allows)

> performance · concurrency/data-races · data-integrity & migrations · API-contract/integration · observability/logging · config & secrets · dependency/supply-chain · accessibility (FE-facing) · resilience/failure-modes

### Sizing heuristic — N scales with the change, not the verdict bar

Raise N (add extended lenses, run ≥2 reviewers on the same lens) for any of:

- Many files changed or high LOC diff
- Criticality tags present: `auth`, `billing`, `payment`, `production`, `critical`
- FE-facing diff (adds the accessibility lens)
- Schema or migration changes (adds data-integrity lens)
- Concurrency primitives touched (adds data-races lens)

When remaining quota is low, shrink the extended set and lean on loop-until-dry across resumed sessions. Keep all core lenses and the ≥3-skeptic verification unconditionally.

## Why Fan-Out (Not a Single Deep Reviewer)

A single reviewer trades recall for precision: told "only high-severity," it investigates then declines to report what it judges below the bar — real bugs get silently dropped. Splitting the job fixes both halves:

- **Finding lenses** optimize for **coverage** — report everything, including low-confidence and low-severity candidates.
- **Adversarial skeptics** optimize for **precision** — refute the noise.
- **Zero tolerance** then applies only to the survivors: confirmed, reachable findings.

Scaling N and V to the change buys more coverage and more precision without ever lowering the verdict bar.

## Lenses Report Everything (No Self-Filtering)

Each lens emits every candidate finding in `[ISSUE-N]` format with a `confidence` and `severity` tag. Lenses do **not** self-filter and do **not** emit a gate verdict. Coverage is their job; verification and the verdict belong to the engine.

```
[ISSUE-1] [CRITICAL] [confidence: high] SQL injection in user input - src/auth.php:42
  Description: User input concatenated directly into SQL query
  Repro/Evidence: GET /login?user=' OR 1=1-- reaches the unparameterized query
  Fix: Use a parameterized query (PDO::prepare)

[ISSUE-2] [MINOR] [confidence: low] Inconsistent naming - src/helper.ts:7
  Description: camelCase method where project convention is snake_case
  Fix: Rename to match convention
```

Lens output ends with a one-line summary (`LENS SUMMARY: <name> — N findings` or `no findings`). It does **not** include `VERDICT: PASS/FAIL`.

### Severity and confidence

- **CRITICAL**: security vulnerabilities, data loss, production crashes.
- **MAJOR**: logic errors, missing validation, broken functionality, swallowed errors.
- **MINOR**: naming, style, missing docs for non-obvious code.
- **confidence** (high/medium/low): the lens's own estimate the finding is real and reachable. Low-confidence findings are still reported — the skeptics decide.

## Loop-Until-Dry

```python
K = 2                  # consecutive dry rounds to consider finding exhausted
seen = {}              # normalized key (file:line:claim) -> finding
dry = 0

while dry < K:
    roster = build_roster(change_profile, remaining_quota())
    raw = spawn_roster_parallel(roster)
    fresh = [f for f in flatten(raw) if dedup_key(f) not in seen]
    if not fresh:
        dry += 1
        continue
    dry = 0
    for f in fresh:
        seen[dedup_key(f)] = f
    # carry `fresh` into adversarial verification
```

Dedup on a normalized key (file + approximate line + claim), not exact text — two lenses phrasing the same bug differently must collapse to one finding.

## Adversarial Verification

For every fresh finding, spawn V independent skeptics that try to **refute** it. They default to `REFUTED` unless they can prove the finding real and reachable.

Distinct lenses are used so a finding can fail in different ways:

- **correctness** — is the claim true?
- **reachability & impact** — can it actually be triggered and does it matter?
- **reproduction** — write or trace the exact input that exhibits it.

```python
def verify(finding):
    lenses = ["correctness", "reachability_and_impact", "reproduction"]
    votes = spawn_parallel([skeptic(finding, lens) for lens in lenses])
    # majority of CONFIRMED required to survive
    return sum(1 for v in votes if v == "CONFIRMED") >= (len(votes) // 2 + 1)
```

**V scales with severity:**

- V ≥ 3 for all findings (minimum)
- V = 5 for CRITICAL-severity or findings tagged `auth` / `billing` / `production`

A finding is confirmed only on a majority of CONFIRMED votes. This is what prevents zero-tolerance from crying wolf on plausible-but-wrong findings.

## Zero-Tolerance Routing (Fixed Point)

If the cycle produces **zero** confirmed findings across a full dry loop, the gate **passes**. Evidence is recorded and the workflow advances.

If **any** finding is confirmed, the gate **blocks**:

1. Emit all confirmed findings as a numbered `[ISSUE-N]` list.
2. Spawn `workflow:executor` to fix **every** confirmed item — no deferrals. The executor may push back only with counter-evidence that a finding is technically wrong; route that back through adversarial verification as a fresh refutation.
3. After the executor reports its Fix-Report, **re-run the entire gate from Step 1** — fixes can regress or introduce new issues. Reset `seen`/`dry`; keep the all-time confirmed log for the audit trail.

```python
MAX_FIX_CYCLES = 6   # config: max_code_review_iterations / max_security_iterations

for cycle in range(MAX_FIX_CYCLES):
    confirmed = run_find_verify_until_dry()
    if not confirmed:
        gate_pass()
        break
    route_to_executor_fix(confirmed)
# exhausted without passing: pause and ask the user — never auto-pass
```

If `MAX_FIX_CYCLES` is exhausted with findings still confirmed, the supervisor **pauses and asks the user** — surfacing known-confirmed gaps beats silently advancing.

### Re-review protocol (iteration > 1)

When lenses run after a fix cycle, they verify previously confirmed issues first:

```
[ISSUE-1] RESOLVED - parameterized query now used
[ISSUE-2] NOT RESOLVED - null check still missing
[ISSUE-3] REGRESSED - renamed but introduced a typo in the import
```

Then run fresh on the changed code — fixes can introduce new findings; report with new ISSUE IDs.

## Authoritative Gate Status

The supervisor writes gate results **explicitly** — this is the source of truth.

```python
update_state(lambda s: {**s, "gates": {**s["gates"], GATE: {
    "status": "passed" if passed else "in_progress",
    "iteration": cycle + 1,
    "confirmed_count": len(all_time_confirmed),
    "lenses_run": roster_lens_names,
    "evidence_path": f"{ACTIVE_DIR}/{wid}.review.md",
}}})
```

The `subagent-stop-track.js` hook scrapes verdict words from transcripts as a best-effort secondary signal only — it frequently yields `unknown`. It does not decide the gate.

## Quota Awareness and Resumability

Each roster round and verification fan-out is a quota burst. Before each new round or cycle, run the shared check in `skills/shared/rate-limit-handling.md`. On a rate-limit marker, pause the workflow and let the scheduled resume continue. Loop-until-dry is naturally resumable: a resumed session re-enters at the current fix cycle and re-runs the find→verify loop from a clean `seen` set. Remaining quota sizes the roster and verifier counts only — it never lowers the verdict bar.

## Evidence

The full audit trail — every lens's findings, every verification vote, every fix cycle — is written to `<ACTIVE_DIR>/<id>.review.md` so the user can audit the entire chain. Confirmed-finding evidence is also logged into `state.gates.<gate>.evidence`.

## Quality Gate Pipeline

```
Implementation Complete
        |
   CODE REVIEW (fan-out, zero tolerance)
        |
   QUALITY GATE (MANDATORY)
   Build -> Type -> Lint -> Test -> Security
        | FAIL: executor fix loop (max MAX_FIX_CYCLES)
        | PASS
   POST-QUALITY-GATE REVIEW
   (fan-out on quality-gate-changed files only, if any)
        | PASS (or no changes made)
   POST-MERGE REVIEW (epic/swarm)
   (fan-out against original scope: functional-completeness + extended lenses)
        | PASS
   COMPLETION GUARD (MANDATORY)
   Requirements + code quality spot-check
        | APPROVED
   COMPLETE
```
