---
description: Zero-tolerance multi-architect post-merge review. Runs three opus architects in parallel against the original scope, requires per-requirement PASS/FAIL, and loops until 100% green.
disable-model-invocation: true
---

# Post-Merge Multi-Architect Review

This phase runs after **all** component branches have been merged and the
integration test suite is green. It is the final quality gate before
`completion_guard` and is **mandatory** for `thorough` mode (epics, swarm-style
features, anything explicitly opted in). Standard / turbo / eco modes skip this
phase to keep token cost predictable.

The pattern is the same parallel 3-architect validation that swarm mode runs at
its `validation` phase — extracted here so the epic workflow (and any other
mode that wants production-grade scrutiny) can reuse it.

## When to invoke

The supervisor invokes this skill after a successful integration:

- Epic / thorough: after `integration` phase passes its tests, **before**
  `completion_guard`. Insert into `state.phase.remaining` between those two
  phases on workflow create (see start/SKILL.md).
- Feature / thorough: optional, after `quality_gate` passes. Recommended for
  any change touching auth, billing, or anything tagged `production:` or
  `critical:`.
- Swarm: this skill *is* the validation phase. Swarm mode already runs it.

## Inputs available in state

Before spawning architects, the supervisor extracts the **original scope** so
each architect can compare delivered work against what was promised:

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

The output is `<scope>` below — pass it (verbatim) into every architect prompt.

## Spawning the three architects

Spawn **all three in parallel** with `run_in_background=true` and wait for
all to complete. Use opus tier — quality > cost at this gate.

```
Agent(
  subagent_type="workflow:architect",
  model="opus",
  max_turns=18,
  run_in_background=true,
  description="Functional completeness review",
  prompt=f"""
  # Validation Focus: FUNCTIONAL COMPLETENESS

  You are reviewing the integrated codebase against the **original scope**. Your
  job is to confirm — line by line — that every promised piece of functionality
  has been delivered. Anything less than 100% delivery is a FAIL.

  ## Original Scope
  ```json
  {scope}
  ```

  ## Per-component plans
  Each component in `per_component_plans` lists files, interfaces produced/
  consumed, and acceptance criteria. Read each plan and verify the
  corresponding code on `main` (or the integration branch).

  ## Required output

  Return a markdown checklist with **one line per requirement**, where each
  line is exactly one of:

  - [PASS] <requirement> — <evidence: file:line, test name, or PR>
  - [FAIL] <requirement> — <what's missing or wrong>

  Group lines by component / acceptance criterion. End with a single line:
  `VERDICT: PASS` or `VERDICT: FAIL`.

  Zero-tolerance: ANY [FAIL] line forces VERDICT: FAIL — even cosmetic gaps
  like missing telemetry, undocumented edge cases, or partial UI states.

  Do NOT propose fixes. Just report findings.
  """
)
Agent(
  subagent_type="workflow:security-deep",
  model="opus",
  max_turns=15,
  run_in_background=true,
  description="Security review",
  prompt=f"""
  # Validation Focus: SECURITY

  Review the integrated codebase for security issues, with priority on
  anything introduced or touched by this workflow.

  ## Scope context
  ```json
  {scope}
  ```

  ## Coverage checklist (each must be checked, not just the headline ones)

  - OWASP Top 10 (A01–A10, current revision)
  - AuthN / AuthZ on every new endpoint or surface
  - Input validation at every boundary (HTTP, queue, file, env)
  - Output escaping in templates
  - Secrets handling (env, vault, config files, logs)
  - Crypto choices (algorithms, key sizes, randomness sources)
  - SSRF / open-redirect / path-traversal in any user-influenced path
  - Multi-tenant isolation (if applicable)
  - Audit logging on state-changing operations
  - Dependency CVEs introduced by package additions

  ## Required output

  Same checklist format as the functional architect:
  `[PASS]` / `[FAIL]` lines + final `VERDICT:`. Zero-tolerance.

  No fix proposals. Just findings.
  """
)
Agent(
  subagent_type="workflow:reviewer-deep",
  model="opus",
  max_turns=18,
  run_in_background=true,
  description="Code-quality review",
  prompt=f"""
  # Validation Focus: CODE QUALITY

  ## Scope context
  ```json
  {scope}
  ```

  ## Coverage checklist

  - SOLID adherence in changed/added classes
  - DRY: identify duplicated logic ≥ 5 lines across two or more files
  - Naming conventions match the project's (per CLAUDE.md / framework norms)
  - Cyclomatic complexity < 10 per function in changed code
  - Error handling: no swallowed exceptions, no `@`-suppression in PHP, no
    bare `except:` in Python
  - Test coverage for changed lines (read the coverage report if available)
  - Public API surface is documented (or self-documenting via names + types)
  - No dead code, no commented-out blocks, no `TODO` without an issue link
  - No hardcoded configurable values (model IDs, URLs, prices, retry counts —
    see CLAUDE.md "No Hardcoded Configurable Values")

  ## Required output

  `[PASS]` / `[FAIL]` lines + final `VERDICT:`. Zero-tolerance.
  """
)
```

## Aggregation

Wait for all three. Build the failure list:

```python
results = [a.output(block=True) for a in [arch_func, arch_sec, arch_qual]]
failures = []
for r in results:
    failures.extend(line for line in r.splitlines() if line.startswith('[FAIL]'))
verdict_pass = all(r.strip().endswith('VERDICT: PASS') for r in results)
```

If `verdict_pass`: mark the gate `passed`, log all `[PASS]` evidence to
`state.gates.post_merge_review.evidence`, advance to `completion_guard`.

If NOT pass: enter the **fix-and-retry loop** below.

## Fix-and-retry loop (zero-tolerance)

```python
MAX_REVIEW_ITERATIONS = 5   # configurable per mode

for iteration in range(MAX_REVIEW_ITERATIONS):
    if verdict_pass:
        break

    # 1. Spawn an executor with the aggregated failure list. Tell it to fix
    #    EVERY [FAIL] item — partial fixes are not acceptable.
    Agent(
      subagent_type="workflow:executor",
      model="sonnet",
      max_turns=20,
      run_in_background=False,   # we need its output to feed the next loop
      prompt=f"""
      # Post-merge review fixes

      The integrated codebase failed multi-architect review. Fix every item
      below. After fixing, run the project's lint + test commands to make
      sure nothing regressed.

      Do NOT defer items, do NOT mark items as "won't fix" — argue back to
      the supervisor only if a finding is technically wrong (and quote the
      counter-evidence).

      ## Findings
      {chr(10).join(failures)}

      ## After fixing
      Report the commits / files touched per finding so the architects can
      verify on the next pass.
      """
    )

    # 2. Re-run all three architects in parallel (same prompts as above).
    # 3. Re-aggregate.
```

If after `MAX_REVIEW_ITERATIONS` the verdict is still FAIL, **do not auto-pass**
the gate. Pause and ask the user for guidance — surfacing the still-failing
items is far better than silently moving to `completion_guard` with known gaps.

## Rate-limit awareness

Each parallel architect spawn is a quota burst. Before spawning the next
iteration of architects, run the shared rate-limit check from
`skills/shared/rate-limit-handling.md` — if any architect output triggered a
marker, pause the workflow and let the cron resume the loop.

## State updates

After this skill exits, the state should look like:

```json
"phase": {
  "current": "completion_guard",      // advanced when verdict==PASS
  "completed": [..., "post_merge_review"],
  "remaining": ["completion_guard"]
},
"gates": {
  "post_merge_review": {
    "status": "passed",
    "iteration": 2,
    "verdicts": {
      "functional": "PASS",
      "security": "PASS",
      "quality": "PASS"
    },
    "evidence_path": "<state-root>/active/<repo-key>/<id>.review.md"
  }
}
```

Write the full architect outputs (all three, all iterations) to
`<id>.review.md` next to the org file so the user can audit the entire chain
of reviews after the workflow completes.

## Why this is mandatory in thorough

Single-pass review misses cross-cutting concerns: a change can be
functionally complete (architect 1 happy), securely written (architect 2
happy), and still fail code quality (architect 3 unhappy) — and vice versa.
Three orthogonal lenses catch what one cannot. Zero-tolerance forces the
team to deliver the originally promised scope, not "most of it."

For modes where the cost is too high (turbo, eco), use the standard
single-architect `completion_guard` instead.
