# Context Limit Resilience

Canonical reference for preventing and recovering from context window exhaustion in workflow subagents.

## max_turns Defaults

Each agent gets a `max_turns` budget based on the execution mode. These values represent the maximum number of agentic turns (API round-trips) before the Task tool stops the agent.

| Agent | eco | turbo | standard | thorough | swarm |
|---|---|---|---|---|---|
| executor-lite | 15 | 15 | — | — | — |
| executor | — | — | 25 | 30 | 25 |
| reviewer-lite | 8 | 8 | — | — | — |
| reviewer | — | — | 12 | — | — |
| reviewer-deep | — | — | — | 15 | 15 |
| security-lite | 8 | 8 | — | — | — |
| security | — | — | 10 | — | — |
| security-deep | — | — | — | 12 | 12 |
| codebase-analyzer | 15 | 15 | 20 | 25 | 20 |
| architect-lite | 10 | 8 | — | — | — |
| architect | — | — | 15 | 20 | 20 |
| quality-gate | 15 | 12 | 20 | 25 | 20 |
| completion-guard | 10 | 8 | 12 | 15 | 12 |
| test-writer | — | — | 20 | 25 | 20 |
| perf-lite | 8 | 8 | — | — | — |
| perf-reviewer | — | — | 10 | — | — |
| doc-writer | 8 | 8 | 8 | 8 | 8 |
| explorer | 10 | 10 | 10 | 10 | 10 |

**Override:** Add +50% for known-complex tasks (many files, large codebase, multiple dependencies).

**Mode config properties:** Each mode's `.org` file stores these as `MAX_TURNS_*` properties. Read them at runtime and pass to the `max_turns` parameter of the Task tool.

---

## Prompt Patterns

### Rule 1 — Reference, Don't Embed

Instead of inlining the full codebase context into every agent prompt, provide the file path and let the agent read it:

```
WRONG (embeds ~5K tokens into every spawn):
## Codebase Context
{contents of context file}

RIGHT (agent reads it with their own context budget):
## Codebase Context
Read the context file at: <HOME>/.claude/workflows/context/<project-slug>.md
Focus on sections relevant to your task: [list relevant sections]
```

This keeps the supervisor prompt lean and lets each agent manage their own context budget.

### Rule 2 — Targeted Reads

Use `Read(file_path, offset=X, limit=Y)` for files >200 lines. Never read entire large files when only a section is needed.

```
WRONG:
Read(file_path="/path/to/large-file.php")  # 800 lines, only need lines 50-80

RIGHT:
Read(file_path="/path/to/large-file.php", offset=50, limit=30)
```

### Rule 3 — Write Early

Persist work to disk after each file modification. Don't accumulate multiple file changes in memory before writing. This ensures work survives if the agent hits its context limit.

### Rule 4 — Minimize Re-reads

After reading a file, take notes on what you found. Reference your notes instead of re-reading the file. Each re-read consumes context tokens unnecessarily.

---

## Continuation Protocol

When an agent's output signals context exhaustion, the supervisor follows this recovery protocol:

### 1. Detect

Agent output contains one or more of:
- "context limit" or "context window"
- "conversation too long"
- Empty or severely truncated output (< 50 chars when substantial output expected)
- Agent returned no file modifications when modifications were expected

### 2. Assess

Before spawning a continuation:
1. Read the state file — check which objectives have `[x]` vs `[ ]`
2. Verify file artifacts on disk — did the agent write any files before stopping?
3. Determine remaining work — list uncompleted objectives

### 3. Continue

Spawn a **NEW** agent (never `resume` — that would inherit the exhausted context):

```python
Task(
    subagent_type="workflow:executor",
    model=task.model,
    max_turns=remaining_budget,  # Original max_turns minus turns used
    prompt=f"""
    ## Continuation Task
    A previous agent ran out of context. Pick up where it left off.

    ## Completed Work
    {2-3 sentence summary of what was accomplished}

    ## Remaining Objectives
    {only the uncompleted objectives from the state file}

    ## Codebase Context
    Read the context file at: <HOME>/.claude/workflows/context/<project>.md
    Focus on: [relevant sections only]

    ## Files Already Modified (do not redo)
    {list of files the previous agent successfully wrote}

    ## Context Efficiency
    - Use Read with offset/limit for files >200 lines
    - Write each file immediately after changes
    - Update state file after each objective
    """
)
```

### 4. Track

Mark the continuation in the state file:

```
** Step N: Implementation [CONTINUED]
   :PROPERTIES:
   :CONTINUATION: 1 of 3
   :PREVIOUS_AGENT: <agent-id>
   :REMAINING_OBJECTIVES: 3
   :END:
```

### 5. Limit

- Maximum **3 continuations** per step (configurable via `MAX_CONTINUATIONS` mode property)
- If 3 continuations are exhausted, break the step into smaller sub-steps or pause for user intervention
- Each continuation should accomplish at least 1 objective; if not, the task may be too complex for a single agent

---

## Fresh Context Launch

For long-running modes (swarm, thorough), the entire workflow can be launched as a subagent to get a fresh context window. This prevents the orchestrator from inheriting a partially-consumed context from the user's chat session.

```python
# Parent session launches workflow in fresh context
Task(
    subagent_type="general-purpose",
    model="sonnet",
    max_turns=50,
    run_in_background=true,
    prompt="""
    You are running a workflow. Follow the instructions in:
    <HOME>/.claude/plugins/workflow/skills/start/SKILL.md

    User's task: {original_task}
    Arguments: {workflow_args}
    """
)
```

**When to use:**
- `--fresh` or `--isolated` flag: always spawn as subagent
- swarm/thorough modes: spawn by default (these are most likely to hit limits)
- eco/turbo modes: run inline (short workflows unlikely to hit limits)
