# Troubleshooting

## Permission Prompts During Workflows

If you're getting permission prompts for bash commands:

1. **Ensure `Bash(*)` is in your allow list** - This allows all bash commands. Individual command whitelisting doesn't work for piped/complex commands.
2. **Check deny/ask rules** - Rules evaluate: `deny > ask > allow`. Dangerous commands in `deny` are always blocked regardless of `Bash(*)`.
3. **Check `additionalDirectories`** - Ensure `~/.claude/workflows` and `~/.claude/plans` are listed.
4. **Restart Claude Code** after changing settings.
5. **Run setup**: `/workflow:setup` to verify configuration.

## State Files Not Being Created

1. Run `/workflow:setup` to verify directory structure
2. Check that `~/.claude/workflows/active/` exists and is writable
3. The plugin uses Write tool (not bash) to create files - this should work without special permissions

## Context Not Loading

1. Verify directory exists: `~/.claude/workflows/context/`
2. Run `/workflow:setup` if missing
3. Learnings are now saved to project's `CLAUDE.md` (auto-loaded by CC)

## Switching Between Org and Markdown

Both formats are fully supported. Use `--format=md` or `--format=org` when starting workflows:

```bash
/workflow:start feature "My task" --format=md
```
