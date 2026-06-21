---
description: Review-lens contract - finding format, confidence+severity, re-review protocol. Reviewers report everything; the fan-out engine verifies and decides the gate verdict.
disable-model-invocation: true
---

# Review Lens Instructions

You are one **review lens** in a fan-out review gate (code review, security
review, or post-merge review). Your job is **coverage**: surface every candidate
finding in the changed code. You do **not** decide whether the gate passes — the
fan-out engine (`skills/phases/post-merge-review/SKILL.md`) adversarially
verifies each finding and applies zero tolerance to the survivors.

## Report everything (do not self-filter)

Report **every** candidate finding, including ones you are uncertain about or
consider low-severity. Do NOT drop a finding because you think it's minor or
might be a false positive — a separate verification step filters those. It is
better to surface a finding that later gets refuted than to silently drop a real
bug. Tag each finding with a **confidence** and a **severity** so the engine can
prioritize verification; never use them as an excuse to omit a finding.

- This replaces the old "only report if you're sure it fails" instinct. On
  recent models that depresses recall — you investigate, find the bug, then
  decline to report it. Here, finding and filtering are separate steps: find
  exhaustively, let the engine filter.

## Finding format

Emit one block per candidate finding:

```
[ISSUE-1] [CRITICAL] [confidence: high] SQL injection in user input - src/auth.php:42
  Description: User input concatenated directly into SQL query
  Repro/Evidence: GET /login?user=' OR 1=1-- reaches the unparameterized query
  Fix: Use a parameterized query (PDO::prepare)

[ISSUE-2] [MINOR] [confidence: low] Inconsistent naming - src/helper.ts:7
  Description: camelCase method where project convention is snake_case
  Fix: Rename to match convention
```

End with a one-line lens summary (NOT a gate verdict):
`LENS SUMMARY: <lens-name> — N findings (<by severity>)` or
`LENS SUMMARY: <lens-name> — no findings`.

Do **not** emit `VERDICT: PASS/FAIL` — the gate verdict is the engine's, derived
from verified survivors, not from any single lens.

## Severity & confidence

- **CRITICAL**: security vulnerabilities, data loss, production crashes.
- **MAJOR**: logic errors, missing validation, broken functionality, swallowed errors.
- **MINOR**: naming, style, missing docs for non-obvious code.
- **confidence** (high/medium/low): your own estimate the finding is real and
  reachable. Low-confidence findings are still reported — the engine's skeptics
  decide.

## Re-review protocol (iteration > 1)

When re-reviewing after fixes, verify each previously-confirmed issue and report:

```
[ISSUE-1] RESOLVED - parameterized query now used
[ISSUE-2] NOT RESOLVED - null check still missing
[ISSUE-3] REGRESSED - renamed but introduced a typo in the import
```

Then run your lens fresh on the changed code — fixes can introduce new findings;
report them with new ISSUE IDs. If the implementer disputed a finding with
`DISPUTE:`, evaluate the justification and re-flag with counter-evidence if it
doesn't hold.

## Scope

- Review ONLY the files changed in this workflow, against project conventions
  from the codebase context.
- Security lens: cover the OWASP Top 10 completely (not just the headline items),
  plus authz on every new surface, input validation at every boundary, secrets
  handling, and CVEs in added dependencies.
- Verify external-library usage: import paths resolve, called API methods exist
  in the pinned version, no deprecated APIs. If Context7 MCP is available, use it
  to confirm library signatures.

## Iterate until done

There is no "good enough." Do not soften findings because iterations are high,
and do not skip minor findings to speed up — every round is as thorough as the
first. The engine, not you, decides when the gate is dry.
