# Workflow Plugin for Claude Code

Automated development workflow orchestration with tiered agents and execution modes.

## Installation

In Claude Code, run:

```
/plugin marketplace add zb-ss/claude-plugin-workflow
/plugin install workflow@zb-ss-claude-plugin-workflow
```

After installation, restart CC and run the setup command to configure permissions:

```
/workflow:setup
```

This will check your settings and offer to add the required permissions for autonomous workflow execution.

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| setup | `/workflow:setup` | Configure permissions for workflow plugin |
| start | `/workflow:start` | Start a new development workflow |
| status | `/workflow:status` | Check workflow status |
| resume | `/workflow:resume` | Resume an existing workflow |
| mode | `/workflow:mode` | Switch execution mode |
| verify | `/workflow:verify` | Run verification loop |
| learn | `/workflow:learn` | Extract reusable patterns from current session |
| skill-create | `/workflow:skill-create` | Generate skills from git history |

## Usage Examples

### Start New Workflow

```bash
# Auto-detect mode (RECOMMENDED) - analyzes task complexity
/workflow:start feature "Add user authentication"
# → Auto-detects: thorough (security-sensitive)

/workflow:start bugfix "Fix typo in README"
# → Auto-detects: eco (simple change)

# Explicit mode keywords
/workflow:start feature "thorough: Add payment processing"
/workflow:start bugfix "quick: Prototype webhook handler"
/workflow:start refactor "eco: Rename variable"

# Override with flag (always wins)
/workflow:start feature "Add payment processing" --mode=standard

# With light style (JSON state instead of org)
/workflow:start bugfix "Quick typo fix" --style=light
```

### Auto Mode Detection

The plugin automatically selects the best mode based on task analysis:

| Task Type | Auto-Selected Mode |
|-----------|-------------------|
| Auth, security, payment | **thorough** |
| Database migrations | **thorough** |
| New features | **standard** |
| Bug fixes | **standard** |
| Typos, docs, config | **eco** |
| Prototypes (with `quick:`) | **turbo** |

**Keyword triggers** (prefix your task):
- `thorough:`, `careful:`, `production:` → thorough mode
- `quick:`, `fast:`, `prototype:` → turbo mode
- `eco:`, `simple:`, `minor:` → eco mode
- `swarm:`, `parallel:`, `multiagent:` → swarm mode

### Execution Modes

| Mode | Description | Model | Review Depth |
|------|-------------|-------|--------------|
| `standard` | Balanced (default) | sonnet | 1 code + 1 security |
| `turbo` | Maximum speed | haiku | 1 code + 1 security |
| `eco` | Token-efficient | haiku | 1 code + 1 security |
| `thorough` | Maximum quality | opus (reviews) | Multi-gate chain |
| `swarm` | Maximum parallelism | opus (validation) | 3-architect competitive |

**Note:** All modes now have MANDATORY reviews (no advisory mode).

### Swarm Mode (New in v3.2)

Swarm mode enables aggressive parallel execution with competitive 3-architect validation:

**Key Features:**
- **Orchestrator-only** - Main agent NEVER writes code, only delegates to supervisor
- **Aggressive parallelism** - Up to 4 executors per batch
- **3-architect validation** - Functional, Security, Quality (all must pass)
- **Task decomposition** - Automatic batching of independent tasks

**3-Architect Validation:**
```
┌─────────────────────────────────────────────────────┐
│ ARCHITECT 1      ARCHITECT 2      ARCHITECT 3      │
│ Functional       Security         Code Quality     │
│ (completeness)   (OWASP)          (SOLID/patterns) │
│      │               │                 │           │
│      └───────────────┴─────────────────┘           │
│                      │                             │
│              ALL MUST PASS                         │
└─────────────────────────────────────────────────────┘
```

**When to use swarm:**
- Large features (10+ files)
- Multi-service implementations
- When quality > speed > cost
- Critical production code

### Planning Styles

| Style | Storage | Use Case |
|-------|---------|----------|
| `full` | State file (default) | Complex features, audit trail, user-editable |
| `light` | JSON file | Quick fixes, simple tasks, minimal overhead |

### State File Formats

| Format | Extension | Use Case |
|--------|-----------|----------|
| `org` | `.org` (default) | Emacs org-mode, structured sections |
| `md` | `.md` | Markdown, GitHub-friendly, easier to read |

Use `--format=md` to create markdown state files:
```bash
/workflow:start feature "Add user auth" --format=md
```

### Switch Mode Mid-Workflow

```bash
/workflow:mode thorough   # Switch to thorough for remaining steps
/workflow:mode eco        # Switch to eco to save tokens
```

### Run Verification

```bash
/workflow:verify                # Full verification loop
/workflow:verify --phase=build  # Just build check
/workflow:verify --phase=test   # Just run tests
```

### Check Status

```bash
/workflow:status           # Current workflow status
/workflow:status --all     # All active workflows
```

### Resume Workflow

```bash
/workflow:resume                # Resume last workflow
/workflow:resume auth-feature   # Resume specific workflow
```

## Workflow Types

- **feature**: New feature development
- **bugfix**: Bug fix workflow
- **refactor**: Code refactoring

## Agents

The plugin includes 20 tiered agents:

### Orchestration (Swarm Mode)
- `supervisor` (sonnet) - Orchestrator-only agent that delegates all work, never implements directly

### Mode Detection
- `task-analyzer` (haiku) - Analyzes task complexity for auto mode selection

### Codebase Analysis
- `codebase-analyzer` (sonnet) - Extracts conventions, patterns, best practices

### Planning
- `architect-lite` (haiku) - Quick analysis
- `architect` (opus) - Deep architectural planning

### Implementation
- `executor-lite` (haiku) - Simple changes
- `executor` (sonnet) - Standard implementation

### Code Review
- `reviewer-lite` (haiku) - Quick review
- `reviewer` (sonnet) - Standard review
- `reviewer-deep` (opus) - Comprehensive review

### Security
- `security-lite` (haiku) - Quick security scan
- `security` (sonnet) - OWASP coverage
- `security-deep` (opus) - Deep security audit

### Quality Gates (MANDATORY)
- `quality-gate` (sonnet) - Mandatory verification with auto-fix loop
- `completion-guard` (opus) - Final architect sign-off before completion

### Other
- `explorer` (haiku) - Codebase exploration
- `test-writer` (sonnet) - Test generation
- `perf-lite` (haiku) - Quick performance check
- `perf-reviewer` (sonnet) - Performance analysis
- `doc-writer` (haiku) - Documentation updates

## Workflow Pipeline

All workflows have MANDATORY quality gates that CANNOT be skipped:

```
Codebase Analysis → Extracts conventions and patterns
     ↓
Planning → Creates implementation plan using context
     ↓
Implementation → Follows conventions from context
     ↓
Review Chain → Validates against codebase patterns
     ↓
QUALITY GATE (MANDATORY) → Build, Type, Lint, Test, Security
     ↓
COMPLETION GUARD (MANDATORY) → Architect verification
     ↓
COMPLETE
```

## Zero Tolerance Policy

**ALL modes enforce:**
- NO skipping quality gates
- NO advisory-only reviews (everything blocks)
- NO partial completion
- NO scope reduction to pass tests
- MANDATORY completion guard approval

## Standard Mode Pipeline

```
Codebase Analysis
     ↓
Planning
     ↓
Implementation
     ↓
Code Review (max 2) → FAIL → Fix → Retry
     ↓ PASS
Security Review (max 1) → FAIL → Fix → Retry
     ↓ PASS
QUALITY GATE → Auto-fix loop (max 3)
     ↓ PASS
COMPLETION GUARD → Architect sign-off
     ↓ APPROVED
COMPLETE
```

## Thorough Mode Pipeline

In thorough mode, ALL gates must pass with deeper verification:

```
Codebase Analysis (fresh)
     ↓
Planning (architect/opus)
     ↓
Implementation
     ↓
Code Review (opus) → FAIL → Fix → Retry (max 3)
     ↓ PASS
Security Review (opus) → FAIL → Fix → Retry (max 2)
     ↓ PASS
Test Coverage (80% min) → FAIL → Add tests → Retry
     ↓ PASS
QUALITY GATE (full) → FAIL → Auto-fix → Retry (max 3)
     ↓ PASS
COMPLETION GUARD (opus) → Full verification
     ↓ APPROVED
[Advisory] Performance Review
     ↓
[Advisory] Documentation Check
     ↓
COMPLETE
```

## Swarm Mode Pipeline

In swarm mode, the supervisor orchestrates parallel execution:

```
Codebase Analysis
     ↓
SUPERVISOR (orchestrator-only, never implements)
     ↓
Planning (architect/opus)
     ↓
TASK DECOMPOSITION
     ↓
┌─────────────────────────────────────────────────────┐
│ BATCH 1 (parallel - max 4 executors)               │
│ executor-1: interfaces/types                       │
│ executor-2: service A stub                         │
│ executor-3: service B stub                         │
│ executor-4: controller stubs                       │
└─────────────────────────────────────────────────────┘
     ↓ ALL COMPLETE
┌─────────────────────────────────────────────────────┐
│ BATCH 2 (parallel - depends on batch 1)            │
│ executor-1: service A implementation               │
│ executor-2: service B implementation               │
│ executor-3: controller implementation              │
│ executor-4: middleware/helpers                     │
└─────────────────────────────────────────────────────┘
     ↓ ALL COMPLETE
┌─────────────────────────────────────────────────────┐
│ BATCH 3 (parallel - depends on batch 2)            │
│ executor-1: unit tests                             │
│ executor-2: integration tests                      │
│ executor-3: e2e tests (if applicable)              │
└─────────────────────────────────────────────────────┘
     ↓ ALL COMPLETE
┌─────────────────────────────────────────────────────┐
│ 3-ARCHITECT VALIDATION (parallel)                  │
│                                                    │
│ architect-1: Functional completeness (opus)        │
│ architect-2: Security review (security-deep)       │
│ architect-3: Code quality (reviewer-deep)          │
│                                                    │
│ ALL THREE MUST PASS                                │
└─────────────────────────────────────────────────────┘
     ↓ ALL PASS (or retry max 3)
QUALITY GATE
     ↓ PASS
COMPLETION GUARD (opus)
     ↓ APPROVED
COMPLETE
```

## Hooks

The plugin includes automated hooks (enabled by default, **cross-platform**):

| Hook | Trigger | Platforms |
|------|---------|-----------|
| TypeScript validation | After `.ts`/`.tsx` edits | Windows, macOS, Linux |
| PHP syntax check | After `.php` edits | Windows, macOS, Linux |
| Python syntax check | After `.py` edits | Windows, macOS, Linux |
| JSON validation | After `.json` writes | Windows, macOS, Linux |
| Permission check | Before Bash commands | Windows, macOS, Linux |

Hooks are written in **Node.js** for full cross-platform compatibility. They gracefully skip validation if the required tool (php, python, etc.) is not installed.

## Features

- **Codebase analysis** before planning (extracts conventions)
- **Parallel agent execution** where phases are independent
- **Fully autonomous mode** - no permission prompts for safe operations
- **Memory persistence** - learnings saved across sessions
- **Continuous learning** - patterns extracted and reused
- Org-mode based state tracking (default)
- JSON state for light style
- Tiered agent routing by mode
- Multi-agent review chains
- Verification loops
- Progress persistence
- Error recovery
- Branch management

## Memory & Learning (New in v3.3)

The plugin now includes lightweight memory persistence and continuous learning:

### Project Memory

Each project maintains a memory file at `~/.claude/workflows/memory/<project>.md`:

```markdown
# Project Memory: my-app

## Key Decisions
- Using repository pattern for data access
- Chose Zod over Yup for validation

## Patterns Discovered
- Barrel exports in each module's index.ts
- Result<T, E> pattern for error handling

## Issues Resolved
- ESLint conflict with Prettier: added eslint-config-prettier

## Conventions Learned
- API responses wrapped in { data, error, meta }
```

Memory is automatically:
- **Loaded** at workflow start (~1-2k tokens, lightweight)
- **Updated** at workflow completion with new learnings

### Extract Patterns Mid-Session

```bash
/workflow:learn
```

Extracts reusable patterns from the current session:
- Error resolutions with root causes
- Debugging approaches that worked
- Workarounds for library quirks
- Project-specific conventions

Saves to:
- `~/.claude/workflows/memory/<project>.md` (project-specific)
- `~/.claude/skills/learned/<pattern>.md` (reusable across projects)

### Generate Skills from Git History

```bash
/workflow:skill-create
```

Analyzes git history to auto-generate project skills:
- Commit message conventions
- File co-change patterns
- Architecture patterns
- Testing conventions

Run once per project, skills are auto-loaded thereafter.

### Context Budget

Memory is designed to be lightweight:
- Project memory: ~1-2k tokens
- Learned skills: ~500 tokens each
- Git-generated skills: ~1k tokens total

This keeps context impact minimal while improving workflow quality.

## Autonomous Execution

Workflows run **without asking permission** for:
- File read/write/edit operations
- Branch creation
- Validation commands (lint, type-check)
- Build and test commands
- Subagent spawning

**User confirmation required only for:**
- Git commits (user reviews first)
- Git push
- File deletion
- Destructive operations

## Parallel Execution

### Agent-Level (Within Session)

| Mode | Parallel Behavior |
|------|-------------------|
| turbo | Code + Security reviews parallel, multi-file implementation |
| standard | Code + Security reviews parallel on first pass |
| thorough | Performance + Documentation checks parallel |
| eco | Sequential only (minimize tokens) |
| swarm | 4 executors/batch, 3-architect validation, aggressive parallelism |

### Instance-Level (Multiple Sessions)

For maximum throughput on large projects, use **git worktrees** to run multiple Claude Code sessions in parallel:

```bash
# Create isolated worktrees for parallel features
git worktree add ../myapp-auth feature/auth
git worktree add ../myapp-api feature/api

# Terminal 1: Auth feature
cd ../myapp-auth && claude
# /workflow:start feature swarm: "Implement authentication"

# Terminal 2: API feature
cd ../myapp-api && claude
# /workflow:start feature swarm: "Implement API endpoints"
```

**The Cascade Method** - Organize terminals left-to-right:
- Oldest tasks on left, newest on right
- Max 3-4 concurrent code-changing sessions
- One dedicated research session (read-only)

| Level | Method | Use Case |
|-------|--------|----------|
| Agent | Swarm mode | Parallel subtasks within one feature |
| Session | `/fork` | Quick parallel exploration |
| Instance | Git worktrees | Independent features, maximum isolation |

**Combined approach** for very large projects:
```
3 worktrees × swarm mode (4 executors each) = 12 parallel executors
```

See `resources/multi-instance-parallelism.md` for the full guide.

## Workflow Best Practices

1. **Explore-Plan-Code Pattern**: Understand codebase before changes
2. **Incremental Progress**: Complete one unit, validate, proceed
3. **State Persistence**: State file is the source of truth
4. **Error Recovery**: Log errors, offer recovery options

## Mode Selection Guide

| Scenario | Recommended Mode |
|----------|------------------|
| Quick prototype | turbo |
| Simple bug fix | eco |
| Regular feature | standard |
| Large multi-file feature | swarm |
| Multi-service implementation | swarm |
| Security-sensitive | thorough |
| Production release | thorough |
| Budget-conscious | eco |

## Troubleshooting

### Permission prompts during workflows

If you're getting permission prompts for mkdir or other operations:

1. **Run setup**: `/workflow:setup` to initialize directories
2. **Check settings**: Ensure `additionalDirectories` includes workflow paths
3. **Restart Claude Code** after changing settings

### State files not being created

1. Run `/workflow:setup` to verify directory structure
2. Check that `~/.claude/workflows/active/` exists and is writable
3. The plugin uses Write tool (not bash) to create files - this should work without special permissions

### Context/memory not loading

1. Verify directories exist:
   - `~/.claude/workflows/context/`
   - `~/.claude/workflows/memory/`
2. Run `/workflow:setup` if missing

### Switching between org and markdown

Both formats are fully supported. Use `--format=md` or `--format=org` when starting workflows:
```bash
/workflow:start feature "My task" --format=md
```

## Requirements

- Claude Code with Task tool access
- Git repository
- Node.js (for hooks - included with Claude Code)

### Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| Linux | ✅ Full | Native support |
| macOS | ✅ Full | Native support |
| Windows | ✅ Full | Cross-platform hooks |
| WSL | ✅ Full | Runs as Linux |

## Recommended Settings

For optimal autonomous workflow execution, copy the recommended settings to your project:

```bash
# For shared settings (committed to git)
cp ~/.claude/plugins/workflow/resources/recommended-settings.json .claude/settings.json

# For personal settings (git-ignored)
cp ~/.claude/plugins/workflow/resources/recommended-settings.json .claude/settings.local.json
```

Or manually add to your `.claude/settings.json`:

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "additionalDirectories": [
      "~/.claude/workflows",
      "~/.claude/plans"
    ],
    "allow": [
      "Read", "Write", "Edit", "Glob", "Grep", "Task", "TodoWrite",
      "Bash(mkdir -p ~/.claude/workflows)", "Bash(mkdir -p ~/.claude/plans)",
      "Bash(git status)", "Bash(git diff *)", "Bash(git add *)",
      "Bash(git checkout -b *)", "Bash(npm run *)", "Bash(npm test *)",
      "Bash(composer *)", "Bash(php -l *)", "Bash(python -m pytest *)"
    ],
    "ask": [
      "Bash(git commit *)", "Bash(git push *)", "Bash(rm *)"
    ],
    "deny": [
      "Bash(rm -rf *)", "Bash(git reset --hard *)", "Bash(git push --force *)"
    ]
  }
}
```

**Important:** The `additionalDirectories` setting grants Claude Code access to workflow state directories outside your project.

See `resources/recommended-settings.json` for the full configuration.

**Note:** Plugins cannot set permissions directly. Users must configure their project settings.

## License

MIT
