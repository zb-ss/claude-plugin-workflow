# Autopilot Setup — Agent Runbook

**For the human:** point your coding agent at this file —
*"Set up the autopilot system by following SETUP.md in the workflow plugin."*
The agent does everything it safely can on its own, asks you for the handful of
values only you know, and ends with a short **manual checklist** (restart, schedule)
for the steps an agent can't do for you.

**For the agent:** you are setting up this plugin's autonomous workflow system.
Work the steps in order. Where a step needs a real value or a judgment call, **ask
the user** — never invent internal names, and never push anything to a public repo
during setup. When done, print the **§7 hand-back checklist** verbatim with your
results filled in.

---

## 0. Preflight

1. **`gh` is authenticated:** run `gh auth status`. If not logged in, stop and tell
   the user to run `gh auth login` (needs `repo` scope), then resume.
2. **`node` is available:** `node --version`.
3. **Resolve the plugin root** — the directory containing *this* file. Call it
   `$PLUGIN_ROOT`. Its CLIs live at `$PLUGIN_ROOT/lib/*.js`. Verify:
   `node "$PLUGIN_ROOT/lib/queue-cli.js" --help` (or just confirm the file exists).
4. Note the canonical references you'll reuse:
   `skills/queue/SKILL.md` (queue + labels), `skills/auto/SKILL.md` (the driver),
   `resources/autonomy-config.md` (configuration, permissions).

> Each task runs the plan and implement workflows (review, a browser check for
> user-facing changes, sign-off), then the target repository's full test suite locally
> and the scrub gate before a pull request. Clear **Acceptance Criteria** on the issue
> are what the sign-off checks.

## 1. Create the private control repo

1. **Ask the user** for the GitHub owner/org and a repo name (default:
   `<owner>/autopilot-queue`). Call the result `$CONTROL`.
2. Check it doesn't already exist: `gh repo view "$CONTROL"` (expect "not found").
3. Create it **private**:
   ```bash
   gh repo create "$CONTROL" --private --add-readme \
     --description "Autopilot control-plane queue for the workflow plugin"
   ```
4. Confirm: `gh repo view "$CONTROL" --json visibility` → must be `PRIVATE`. If it
   isn't, stop and tell the user (this repo must never be public).

## 2. Create the label state machine

Create these 8 labels (the queue's state machine) with `gh label create … --force`:
`queued`, `in-progress`, `scrub-pending`, `review`, `done`, `blocked`,
`scrub-failed`, `changes-requested`. Colors/descriptions: see `skills/queue/SKILL.md`.
Verify with `gh label list --repo "$CONTROL"`.

## 3. Seed the repo (README, task template, denylist template)

1. **Ask the user** where to keep a local checkout (default `~/projects/<name>`);
   call it `$LOCAL`. Clone: `gh repo clone "$CONTROL" "$LOCAL"`.
2. Add these files (content/templates are in `skills/queue/SKILL.md`):
   - `README.md` — the user-facing queue guide.
   - `.github/ISSUE_TEMPLATE/task.md` — the Task template (frontmatter `labels: queued`;
     body sections: Target Repo / Description / Acceptance Criteria / Constraints /
     Priority — must match `parseTaskSpec` in `lib/queue-cli.js`).
   - `scrub-denylist.json` — start from the template; you fill it in §4.
3. Commit + push.

## 4. Seed the scrub denylist (ASK — this is the safety list)

The scrub gate blocks these strings from ever reaching a **public** repo. **Ask the
user** for, and write into `$LOCAL/scrub-denylist.json`:
- customer/client names, internal project/brand/codenames,
- internal hostnames/domains, infra identifiers (bucket / ALB / IAM names),
- internal feature-flag prefixes,
- the user's own usernames/handles (so home-path/username leaks get caught).

Format each as `{ "category", "pattern", "regex": true|false, "label" }`; use
`regex:true` for patterns. This repo is **private**, so real values are safe here.
Commit + push. If the user can't answer now, leave the template and **record it as
deferred** in the hand-back — until it's filled, the gate runs structural markers
only (secrets, AI-context files, real public IPs) and warns.

**Optional `allow_ips`:** add an `"allow_ips": ["1.2.3.4", "203.0.113.5"]` array to
the same file to treat specific public IPs as neutral — useful for long-standing
placeholder IPs your test suite uses that would otherwise trip the public-IP guard.
This is an **exact-string match only**; it never weakens secret, denylist-name, or
other-public-IP detection.

## 5. Wire the configuration

**Confirm with the user**, then add to `~/.claude/settings.json` under an `env` block:
```json
"env": {
  "CLAUDE_WORKFLOW_CONTROL_REPO": "<$CONTROL>",
  "CLAUDE_WORKFLOW_SCRUB_DENYLIST": "~/<path under the home directory>/scrub-denylist.json"
}
```
Write the denylist path in the `~/` form. Settings values are not shell-expanded, but the
plugin expands a leading `~/`, `$HOME/` or `${HOME}/`, so one value works on every machine
that shares this settings file. An absolute path tied to one machine silently disables
name-based scrubbing on the others; the scrub gate and the startup check report that case
as "configured denylist path not readable".

Ask the user for the local checkout of each target repository and write `target_repos`
into `<state dir>/preferences.json` (default state dir `~/.claude-workflows`), merging
with any existing keys:
```json
{ "target_repos": { "owner/repo": "~/projects/repo" } }
```
Optionally add `demo_skill`, the skill that records a proof video for user-facing work.
Configure the permissions in `resources/autonomy-config.md`. **Never** weaken the deny
list (force-push, `rm -rf`, resource deletion) and **never** bypass the scrub gate.

## 6. Verify (live, against the real repo)

1. **Queue round-trip:** create a throwaway issue with the task template body and the
   `queued` label, then:
   ```bash
   node "$PLUGIN_ROOT/lib/queue-cli.js" list --repo "$CONTROL"   # lists it
   node "$PLUGIN_ROOT/lib/queue-cli.js" read <n> --repo "$CONTROL" # parsed spec
   ```
   Confirm `target_repo`/`priority` parse correctly, then **close the test issue**.
   Then check the driver:
   ```bash
   node "$PLUGIN_ROOT/lib/driver-cli.js" install-wake                 # prints the launcher path
   node "$PLUGIN_ROOT/lib/driver-cli.js" next --repo "$CONTROL"       # action idle on an empty queue
   ```
2. **Scrub denylist loads:** pipe a surface containing one seeded name into
   `node "$PLUGIN_ROOT/lib/scrub-cli.js" scan` with `CLAUDE_WORKFLOW_SCRUB_DENYLIST`
   set, and confirm `denylist_loaded: true` and the name is caught.
3. **Identity:** confirm both `gh` **and** the GitHub MCP can reach `$CONTROL` and the
   user's intended target repos.

## 7. Hand back to the user (steps an agent CANNOT do)

Print this, with your results filled in:

```
✅ Done autonomously:
  - Private control repo: <$CONTROL>
  - Labels, README, Task template, denylist template
  - Denylist seeded: <yes / DEFERRED — user to fill scrub-denylist.json>
  - Config wired in settings.json (CONTROL_REPO + SCRUB_DENYLIST, ~/ form)
  - Verified: queue round-trip + scrub denylist load

👤 You must do (an agent can't):
  [ ] Restart Claude Code — loads the new env vars + rebuilds the plugin.
  [ ] If the plugin was just installed/updated: /plugin → reinstall/refresh.
  [ ] Schedule the launcher locally: `node <launcher path>` from cron, e.g.
        0 * * * * PATH="$HOME/.local/bin:<dir of node>:<dir of gh>:/usr/local/bin:$PATH" node "$HOME/.claude-workflows/driver/wake.js" >> "$HOME/.claude-workflows/driver/wake.log" 2>&1
      or a systemd timer. Cron's PATH is only /usr/bin:/bin, so node, claude,
      git and gh are not found unless PATH is set inside the command (sh
      expands $HOME and $PATH there, not in a separate `PATH=` crontab line).
      Fill <dir of node> and <dir of gh> from `dirname "$(command -v node)"` and
      `dirname "$(command -v gh)"`; also include the directory of `claude`
      (`command -v claude`) if it is not ~/.local/bin, because an npm-installed
      claude needs node on PATH too.
      A start failure is written to wake.log. Then run it once by hand and confirm it comments on a
      queued issue.
  [ ] Enqueue your first real task (Issues → New → Task) and watch it run.
```

Then summarize anything deferred (e.g. denylist not yet seeded) so nothing is silently skipped.
