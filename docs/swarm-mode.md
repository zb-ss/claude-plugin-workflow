# Swarm Mode

Swarm mode enables aggressive parallel execution with a scalable N-lens fan-out review gate. Use it for large features, multi-service implementations, and when quality matters more than cost.

## Key Features

- **Orchestrator-only** - Main agent NEVER writes code, only delegates to supervisor
- **Aggressive parallelism** - Up to 4 executors per batch
- **Fan-out review gate** - Scalable roster of N independent review lenses with adversarial verification and zero-tolerance routing
- **Task decomposition** - Automatic batching of independent tasks

## Pipeline

```
Codebase Analysis
     |
SUPERVISOR (orchestrator-only, never implements)
     |
Planning (architect/opus)
     |
TASK DECOMPOSITION
     |
+-----------------------------------------------------+
| BATCH 1 (parallel - max 4 executors)                |
| executor-1: interfaces/types                        |
| executor-2: service A stub                          |
| executor-3: service B stub                          |
| executor-4: controller stubs                        |
+-----------------------------------------------------+
     | ALL COMPLETE
+-----------------------------------------------------+
| BATCH 2 (parallel - depends on batch 1)             |
| executor-1: service A implementation                |
| executor-2: service B implementation                |
| executor-3: controller implementation               |
| executor-4: middleware/helpers                       |
+-----------------------------------------------------+
     | ALL COMPLETE
+-----------------------------------------------------+
| BATCH 3 (parallel - depends on batch 2)             |
| executor-1: unit tests                              |
| executor-2: integration tests                       |
| executor-3: e2e tests (if applicable)               |
+-----------------------------------------------------+
     | ALL COMPLETE
+-----------------------------------------------------+
| FAN-OUT REVIEW GATE                                 |
|                                                     |
| Round 1…N (loop-until-dry, K consecutive empty):   |
|   lens: functional-completeness (opus)              |
|   lens: security (security-deep)                    |
|   lens: code-quality (reviewer-deep)                |
|   + extended lenses scaled to change profile        |
|                                                     |
| Each lens reports EVERY finding (no self-filter).   |
|                                                     |
| Adversarial verification: ≥3 independent skeptics   |
| try to REFUTE each finding; majority-to-confirm.    |
|                                                     |
| Confirmed finding → executor fix → ENTIRE GATE      |
| RE-RUNS (fixed point). Gate passes only on a full   |
| dry loop with zero confirmed findings.              |
+-----------------------------------------------------+
     | ZERO CONFIRMED FINDINGS (or retry max cycles)
QUALITY GATE
     | PASS
COMPLETION GUARD (opus)
     | APPROVED
COMPLETE
```

## Fan-Out Review Gate

The review gate runs a scalable roster of independent lenses in parallel, then adversarially verifies every finding before routing.

### How it works

1. **Find** — a roster of N lenses spawns in parallel; every lens reports *every* candidate finding (coverage, no self-filtering) with a `confidence` and `severity` per finding.
2. **Loop-until-dry** — rounds keep running until K consecutive rounds surface nothing new. Different lenses and re-runs catch the tail that a single pass drops.
3. **Adversarially verify** — each fresh finding is challenged by ≥3 independent skeptics that try to *refute* it (default: refuted). A finding is confirmed only on a majority of CONFIRMED votes. This eliminates plausible-but-wrong findings before zero-tolerance applies.
4. **Route (zero tolerance)** — any confirmed finding blocks, routes to an executor fix, and the **entire gate re-runs** from step 1. The gate passes only on a full dry loop with zero confirmed findings.

### Core lenses (always included)

| Lens | Focus | Agent |
|------|-------|-------|
| functional-completeness | Requirements coverage, correctness | architect (opus) |
| security | OWASP, auth, injection, secrets | security-deep (opus) |
| code-quality | SOLID, patterns, error-handling | reviewer-deep (opus) |

### Extended lenses (added by change profile)

Additional lenses — performance, concurrency, data-integrity, API-contract, observability, accessibility, resilience — are added when the change profile warrants and quota allows. The roster scales with the change; the verdict bar does not.

### Verdict bar

The gate passes only when a complete find→verify cycle yields zero confirmed findings with K consecutive dry rounds. Scrutiny scales up with change size and criticality; it never scales down.

## Agent Teams (Experimental)

Swarm mode can optionally leverage Claude Code's experimental Agent Teams feature for enhanced agent coordination.

**Enable it:**

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

Or run `/workflow:setup` which will guide you through configuration.

**What it adds:**
- Peer-to-peer messaging between executor agents
- Shared task lists for parallel work coordination
- Native delegate mode for the supervisor
- Built-in plan approval flow

**Without Agent Teams**, swarm mode uses the standard Task tool for parallel execution (fully functional, just less native coordination).

## When to Use

- Large features (10+ files)
- Multi-service implementations
- When quality > speed > cost
- Critical production code
