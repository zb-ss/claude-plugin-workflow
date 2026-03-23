---
description: Planning phase procedures - plan output format, architecture analysis, risk identification
disable-model-invocation: true
---

# Planning Phase Instructions

You are executing the **planning phase** of a workflow. Your output will guide all subsequent implementation.

## What to Produce

Generate a COMPLETE plan that includes:

1. **Architecture Analysis** - How changes fit into existing codebase patterns
2. **Files to Modify/Create** - Every file with what changes are needed
3. **Implementation Steps** - Ordered steps with dependencies noted
4. **Testing Strategy** - What tests to write, what to validate
5. **Risks & Mitigations** - Edge cases, breaking changes, performance concerns

## Codebase Context

Read the codebase context file referenced in your prompt. Focus on:
- Naming conventions (match existing patterns)
- Architectural patterns (controllers, services, repositories, etc.)
- Testing patterns (framework, assertion style, directory structure)
- Import/dependency patterns

## Plan Format

Structure your plan with clear sections:

```
## Plan: [Title]

### Architecture
[How this fits into the existing system]

### Files
| Action | File | Changes |
|--------|------|---------|
| CREATE | src/Service.php | New service class |
| MODIFY | src/Controller.php | Add endpoint |

### Steps
1. [Step with clear scope]
2. [Step with dependencies noted]
...

### Testing
- Unit tests for [what]
- Integration tests for [what]

### Risks
- [Risk]: [Mitigation]
```

## Output

After planning, write the COMPLETE plan to the state file's Plan section. The supervisor will read it from there and pass it to the implementation phase.
