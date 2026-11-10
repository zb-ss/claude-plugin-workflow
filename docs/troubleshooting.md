# Troubleshooting

## A Judge Step Fails or Runs on Opus

The judge agents pin the `fable` model alias. If your account cannot use it, the saved
workflows (`/workflow:do`, `plan`, `implement`, `review`) retry the judge once on `opus` and
list it under `judge_fallback.used` in their result. If a judge still returns nothing,
`/workflow:do` relays the error from the agent's transcript.

The previous engine (`/workflow:start`, `/workflow:resume`) and the autonomous driver have no
retry of their own. Add a fallback to `~/.claude/settings.json`, or let `/workflow:setup` add it:

```json
{ "fallbackModel": ["opus"] }
```

## A Workflow Stops After 10 Minutes in `claude -p`

Headless `claude -p` stops background work 10 minutes after its last turn. Set
`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` for runs that take longer. To finish a stopped run,
resume the session with `claude -p --resume <session id>` and relaunch the workflow; agents that
finished return their saved results.

## Scrub Gate Says the Denylist Path Is Not Readable

`CLAUDE_WORKFLOW_SCRUB_DENYLIST` is set, but the file is missing or is not valid JSON, so only
the structural checks ran. Settings values are not shell-expanded except for a leading `~/`,
`$HOME/` or `${HOME}/`, which the plugin expands. If you share one settings file between
machines, use the `~/` form so the path resolves on each of them.

## Permission Prompts During Workflows

If you're getting permission prompts for bash commands:

1. **Ensure `Bash(*)` is in your allow list** - This allows all bash commands. Individual command whitelisting doesn't work for piped/complex commands.
2. **Check deny/ask rules** - Rules evaluate: `deny > ask > allow`. Dangerous commands in `deny` are always blocked regardless of `Bash(*)`.
3. **Check `additionalDirectories`** - Ensure `~/.claude-workflows` and `~/.claude/skills` are listed. Plans are under `~/.claude-workflows/plans/` so one entry covers both.
4. **Restart Claude Code** after changing settings.
5. **Run setup**: `/workflow:setup` to verify configuration.

If you're getting permission prompts **for writing state files** (org files, state JSON):

1. **Add path-scoped Edit/Write rules** - `additionalDirectories` only grants **read** access. You need explicit rules like `Edit(~/.claude-workflows/**)` and `Write(~/.claude-workflows/**)` in your allow list.
2. **Check your allow list contains all four rules:**
   ```json
   "Edit(~/.claude-workflows/**)", "Edit(~/.claude/skills/**)",
   "Write(~/.claude-workflows/**)", "Write(~/.claude/skills/**)"
   ```
3. **Restart Claude Code** after changes.

## State Files Not Being Created

1. Run `/workflow:setup` to verify directory structure
2. Check that `~/.claude-workflows/active/<repo-key>/` exists and is writable (the repo-scoped bucket is created automatically on first workflow start)
3. The plugin uses Write tool (not bash) to create files — ensure path-scoped `Write(~/.claude-workflows/**)` is in your allow list
4. To find the active directory for the current repo: `node $CLAUDE_PLUGIN_ROOT/lib/active-dir-cli.js`

## Switching Between Org and Markdown

Both formats are fully supported. Use `--format=md` or `--format=org` when starting workflows:

```bash
/workflow:start swarm: "My task" --format=md
```

## Legacy State Files (pre-v2)

Workflows created before the repo-scoped schema live flat under `~/.claude-workflows/active/`. `/workflow:migrate-legacy` lists them; assign each to the new per-repo buckets:

```bash
/workflow:migrate-legacy
```
