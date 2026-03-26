# Workflow Orchestrator - Usage Examples

## Basic Usage

```bash
# Feature development
/workflow feature Add user authentication with JWT tokens and refresh token support

# Bug fix
/workflow bugfix Fix the race condition in the payment processing queue

# Refactoring
/workflow refactor Extract the validation logic from UserController into a dedicated service

# Security hardening
/workflow security Audit and harden the API endpoints for the admin panel
```

## What Happens

### Feature Workflow Example

1. **You invoke:** `/workflow feature Add dark mode support`

2. **Planning Phase:**
   - Supervisor spawns `Plan` agent
   - Agent explores codebase, identifies theme system, components to modify
   - Creates plan at `.claude-workflows/plans/<id>-plan.md`
   - Supervisor validates plan has actionable steps

3. **Implementation Phase:**
   - Supervisor spawns `workflow:executor` agent
   - Agent follows plan, modifies/creates files using native Write/Edit tools
   - Reports changes made

4. **Code Review Phase:**
   - Supervisor spawns `workflow:reviewer` agent
   - Agent checks implementation against plan
   - If FAIL: Supervisor sends feedback to `workflow:executor`, loops
   - If PASS: Proceeds

5. **Security Review Phase:**
   - Supervisor spawns `workflow:security` agent
   - Checks for XSS in theme switching, etc.
   - If issues: Loop back to implementation

6. **Test Writing Phase:**
   - Supervisor spawns `workflow:test-writer` agent
   - Creates tests for dark mode functionality
   - Verifies tests pass

7. **Completion:**
   - Supervisor updates state to "completed"
   - Outputs detailed summary
   - You review and test manually

## Monitoring Progress

Check the workflow state:
```bash
cat .claude/workflow-state.json | jq .
```

## Interrupting a Workflow

If you need to pause or cancel:
- Simply stop Claude (Ctrl+C)
- State is preserved in `.claude/workflow-state.json`
- You can resume manually or start fresh

## Customization

### Adding a New Workflow Type

1. Edit `~/.claude/skills/workflow-orchestrator/SKILL.md`
2. Add new workflow section with phases
3. Update the command file to recognize the new type

### Changing Max Review Iterations

Edit the `MAX_REVIEWS` value in the skill file.

### Custom Notifications

Add a hook for the `Notification` event to integrate with Slack, Discord, etc.
