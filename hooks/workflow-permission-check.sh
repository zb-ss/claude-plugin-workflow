#!/bin/bash
# Workflow permission check hook
# Called by PreToolUse hook for Bash commands
# Blocks dangerous commands, allows workflow operations

set -e

# Read hook input from stdin
INPUT=$(cat)

# Extract command from tool input
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Check if we're in workflow mode (active workflow exists and was updated recently)
WORKFLOW_DIR="$HOME/.claude/workflows/active"
ACTIVE_WORKFLOW=$(ls -t "$WORKFLOW_DIR"/*.org 2>/dev/null | head -1)

IN_WORKFLOW="false"
if [[ -n "$ACTIVE_WORKFLOW" && -f "$ACTIVE_WORKFLOW" ]]; then
    # Check if workflow was updated in last 30 minutes
    LAST_MOD=$(stat -c %Y "$ACTIVE_WORKFLOW" 2>/dev/null || stat -f %m "$ACTIVE_WORKFLOW" 2>/dev/null)
    NOW=$(date +%s)
    AGE=$((NOW - LAST_MOD))
    if [[ $AGE -lt 1800 ]]; then
        IN_WORKFLOW="true"
    fi
fi

# ALWAYS BLOCKED - regardless of mode
# Patterns that must match at START of command (to avoid false positives in arguments)
BLOCKED_START_PATTERNS=(
    "git push"
    "git reset --hard"
    "sudo rm"
)

# Patterns that can match ANYWHERE (truly dangerous regardless of context)
BLOCKED_ANYWHERE_PATTERNS=(
    "rm -rf /"
    "rm -rf ~"
    "rm -rf \$HOME"
    ":(){:|:&};:"
    "mkfs"
    "dd if="
    "> /dev/sd"
)

for pattern in "${BLOCKED_START_PATTERNS[@]}"; do
    if [[ "$COMMAND" == "$pattern"* ]]; then
        echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Blocked: $pattern is not allowed. User must run manually.\"}}"
        exit 0
    fi
done

for pattern in "${BLOCKED_ANYWHERE_PATTERNS[@]}"; do
    if [[ "$COMMAND" == *"$pattern"* ]]; then
        echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Blocked: $pattern is not allowed. User must run manually.\"}}"
        exit 0
    fi
done

# WORKFLOW MODE ALLOWED - no permission prompt needed
if [[ "$IN_WORKFLOW" == "true" ]]; then
    WORKFLOW_ALLOWED=(
        "git branch"
        "git checkout -b"
        "git switch -c"
        "git stash"
        "git status"
        "git diff"
        "git log"
        "git add"
        "git commit"
        "php -l"
        "composer"
        "npm"
        "npx"
        "yarn"
        "pnpm"
        "wc"
        "ls"
        "find"
        "head"
        "tail"
        "cat"
        "mkdir"
        "cp"
        "mv"
        "touch"
    )

    for allowed in "${WORKFLOW_ALLOWED[@]}"; do
        if [[ "$COMMAND" == "$allowed"* ]]; then
            # Output JSON to auto-approve without prompting
            echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"allow\",\"permissionDecisionReason\":\"Auto-approved by workflow mode\"}}"
            exit 0
        fi
    done
fi

# For all other commands, let Claude Code's normal permission system handle it
exit 0
