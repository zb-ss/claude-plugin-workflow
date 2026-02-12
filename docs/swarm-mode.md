# Swarm Mode

Swarm mode enables aggressive parallel execution with competitive 3-architect validation. Use it for large features, multi-service implementations, and when quality matters more than cost.

## Key Features

- **Orchestrator-only** - Main agent NEVER writes code, only delegates to supervisor
- **Aggressive parallelism** - Up to 4 executors per batch
- **3-architect validation** - Functional, Security, Quality (all must pass)
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
| 3-ARCHITECT VALIDATION (parallel)                   |
|                                                     |
| architect-1: Functional completeness (opus)         |
| architect-2: Security review (security-deep)        |
| architect-3: Code quality (reviewer-deep)           |
|                                                     |
| ALL THREE MUST PASS                                 |
+-----------------------------------------------------+
     | ALL PASS (or retry max 3)
QUALITY GATE
     | PASS
COMPLETION GUARD (opus)
     | APPROVED
COMPLETE
```

## 3-Architect Validation

Three independent architect agents review the implementation in parallel:

| Architect | Focus | Agent |
|-----------|-------|-------|
| Architect 1 | Functional completeness | architect (opus) |
| Architect 2 | Security (OWASP, auth) | security-deep (opus) |
| Architect 3 | Code quality (SOLID, patterns) | reviewer-deep (opus) |

All three must PASS. If any fails, issues are sent back for fixing with max 3 retry cycles.

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
