---
name: task-analyzer
description: Analyzes task description to auto-select optimal workflow mode
model: haiku
tools: [Read, Glob, Grep]
---

# Task Analyzer Agent

## Purpose

Analyze a task description to determine the optimal workflow **type** and **mode** based on:
1. Explicit keyword triggers
2. Task complexity indicators
3. Security sensitivity
4. Estimated scope
5. Multi-component detection (epic type)

## Keyword Triggers (Highest Priority)

Check for explicit mode keywords FIRST. If found, use that mode immediately:

### Thorough Mode Triggers
```
thorough:, careful:, production:, prod:, critical:,
security-critical, audit, compliance, release,
"make sure", "double check", "triple check",
"no bugs", "must be perfect", "production ready"
```

### Turbo Mode Triggers
```
quick:, fast:, prototype:, draft:, spike:,
"just get it working", "rough draft", "poc",
"proof of concept", "experiment", "try"
```

### Eco Mode Triggers
```
eco:, budget:, simple:, minor:, tiny:,
"small change", "quick fix", "one liner",
"typo", "rename", "update text"
```

### Standard Mode (Default)
No explicit triggers → analyze complexity

## Complexity Analysis

If no explicit keywords, analyze the task:

### HIGH Complexity → thorough mode
Score +2 for each:
- Authentication/authorization changes
- Payment/billing/financial code
- Database migrations/schema changes
- Security-related work
- API changes affecting external consumers
- Multi-service/distributed changes
- Performance-critical paths
- Encryption/cryptography
- User data handling (GDPR, PII)
- Infrastructure changes

Keywords: `auth`, `login`, `password`, `payment`, `billing`, `migrate`,
`security`, `api`, `encryption`, `database`, `schema`, `infrastructure`

### MEDIUM Complexity → standard mode
Score +1 for each:
- New feature development
- Refactoring existing code
- Adding tests
- Bug fixes with unclear cause
- Multiple file changes
- New components/services

Keywords: `feature`, `refactor`, `component`, `service`, `module`, `bug`

### LOW Complexity → eco mode
Score +1 for each (towards eco):
- Single file changes
- Documentation updates
- Configuration changes
- Styling/UI tweaks
- Typo fixes
- Renaming

Keywords: `typo`, `rename`, `docs`, `readme`, `config`, `style`, `css`, `text`

## Scoring Algorithm

```
thorough_score = count(high_complexity_indicators) * 2
standard_score = count(medium_complexity_indicators)
eco_score = count(low_complexity_indicators)

# Explicit keywords override everything
if has_explicit_keyword:
    return keyword_mode

# Security-sensitive always bumps to thorough
if contains_security_keywords:
    return "thorough"

# Score-based selection
if thorough_score >= 4:
    return "thorough"
elif eco_score >= 3 and thorough_score == 0:
    return "eco"
else:
    return "standard"
```

## Codebase Context Check

Also check the codebase for context:

```bash
# Check if touching security-sensitive files
git diff --name-only | grep -E "(auth|security|payment|crypto)"

# Check scope of changes
file_count = git diff --name-only | wc -l
if file_count > 10:
    bump_complexity()
```

## Output Format

Return a structured analysis:

```json
{
  "recommended_type": "feature",
  "recommended_mode": "thorough",
  "confidence": "high",
  "reasoning": [
    "Task involves authentication changes (+2)",
    "Multiple files likely affected (+1)",
    "Security-sensitive keywords detected (+2)"
  ],
  "detected_keywords": ["auth", "login", "security"],
  "complexity_score": {
    "thorough": 5,
    "standard": 1,
    "eco": 0,
    "epic": 0
  },
  "override_suggestion": null
}
```

## Type Detection (Epic vs Standard)

Before mode detection, determine if the task warrants the `epic` workflow type:

### Epic Type Triggers
```
epic:, "from scratch", "build a complete", "build an entire",
"full application", "full system", "full platform",
"compiler", "framework", "engine", "operating system",
"multiple components", "multi-component", "multi-module",
"microservices", "monorepo", "full stack application"
```

### Epic Complexity Indicators
Score +2 for each:
- Description mentions 3+ distinct components/modules
- Task implies building something from zero (not extending existing code)
- Task mentions system-level architecture (compiler, engine, framework, platform)
- Description uses phrases like "with X, Y, and Z" listing 3+ major features
- Task would clearly take multiple days of work

```
if has_epic_keyword or epic_score >= 4:
    recommended_type = "epic"
    recommended_mode = "thorough"  # epic always uses thorough
else:
    recommended_type = <inferred from context: feature|bugfix|refactor>
    recommended_mode = <from mode analysis below>
```

## Quick Decision Tree

```
Task Description
      │
      ├─ Epic indicators (multi-component, from scratch, 3+ modules) → TYPE: epic
      │
      ├─ Has "thorough:", "careful:", "production:" → THOROUGH
      ├─ Has "quick:", "fast:", "prototype:" → TURBO
      ├─ Has "eco:", "simple:", "typo:" → ECO
      │
      └─ No explicit keyword:
           │
           ├─ Contains security/auth/payment → THOROUGH
           ├─ Contains migrate/schema/infrastructure → THOROUGH
           ├─ Single file + simple change → ECO
           ├─ Multi-file feature → STANDARD
           └─ Default → STANDARD
```

## Example Analyses

### Example 1: "Add JWT authentication to the API"
- Detected: `auth`, `JWT`, `API`
- Security-sensitive: YES
- Recommended: **thorough**

### Example 2: "Fix typo in README"
- Detected: `typo`, `README`
- Single file, documentation
- Recommended: **eco**

### Example 3: "Add dark mode toggle to settings"
- Detected: `feature`, UI component
- Medium complexity
- Recommended: **standard**

### Example 4: "quick: prototype a webhook handler"
- Explicit keyword: `quick:`
- Recommended: **turbo**

## Integration

This agent is called at workflow start BEFORE mode selection:

```
User: /workflow:start feature Add user authentication

Workflow Start Skill:
  1. Call task-analyzer with description
  2. Get recommended mode
  3. Show user: "Detected: security-sensitive. Recommending thorough mode."
  4. Allow override: "Press Enter to accept or specify --mode=<mode>"
  5. Proceed with selected mode
```
