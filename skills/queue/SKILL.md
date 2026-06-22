---
description: "/workflow:queue — manage the autonomous task queue backed by a private GitHub-issues repo"
disable-model-invocation: true
---

# `/workflow:queue` — GitHub-Issues Queue Adapter

The queue is a single **private** GitHub repository. One issue = one task.
Labels encode the state machine. Comments are the progress log.
The CLI adapter lives at `lib/queue-cli.js`.

> **Identity note.** `gh` CLI and the GitHub MCP server may authenticate as
> different GitHub identities. Both must be able to read/write the control repo
> AND every `target_repo`. Verify with `gh auth status` before setting up.

---

## 1. One-Time Setup — Create the Label Vocabulary

The GitHub MCP server has no label-create tool; use `gh` directly.

```bash
QUEUE_REPO="owner/autopilot-queue"   # your private control repo

# State-machine labels
gh label create queued            --repo "$QUEUE_REPO" --color "0075ca" --description "Ready to pick up"
gh label create in-progress       --repo "$QUEUE_REPO" --color "e4e669" --description "Driver is working on this"
gh label create scrub-pending     --repo "$QUEUE_REPO" --color "d93f0b" --description "Awaiting scrub-gate review"
gh label create review            --repo "$QUEUE_REPO" --color "0e8a16" --description "Awaiting human review"
gh label create done              --repo "$QUEUE_REPO" --color "6f42c1" --description "Completed and closed"
gh label create blocked           --repo "$QUEUE_REPO" --color "b60205" --description "Blocked — needs human input"
gh label create scrub-failed      --repo "$QUEUE_REPO" --color "e11d48" --description "Scrub gate rejected this task"
gh label create changes-requested --repo "$QUEUE_REPO" --color "f97316" --description "Reviewer requested changes"
```

Set the control repo once for your shell session (or add to `.env`):

```bash
export CLAUDE_WORKFLOW_CONTROL_REPO="owner/autopilot-queue"
```

---

## 2. Issue-Body Template

Every task issue **must** use exactly this template so `parseTaskSpec()` can
parse it reliably. Copy it verbatim when creating issues.

```markdown
## Target Repo
owner/repo-name

## Description
One-paragraph summary of the work required. Be specific enough that the driver
can start without asking follow-up questions.

## Acceptance Criteria
- [ ] First verifiable outcome
- [ ] Second verifiable outcome

## Constraints
- Any hard restrictions (e.g. "no breaking API changes", "PHP 8.1 min")

## Priority
high
```

**Field rules:**

| Field | Required | Valid values | Notes |
|-------|----------|-------------|-------|
| `Target Repo` | yes | `owner/repo` | The work repo (may be public) |
| `Description` | yes | free text | One paragraph minimum |
| `Acceptance Criteria` | no | markdown checklist | Parsed to array; `- [ ]` or `- [x]` both accepted |
| `Constraints` | no | bullet list | Parsed to array |
| `Priority` | no | `critical`, `high`, `medium`, `low` | Defaults to `medium` if absent or unrecognised |

---

## 3. Enqueue a Task

```bash
gh issue create \
  --repo "$CLAUDE_WORKFLOW_CONTROL_REPO" \
  --title "Short imperative title (< 80 chars)" \
  --label queued \
  --body "$(cat <<'EOF'
## Target Repo
owner/my-work-repo

## Description
Implement rate-limit retry logic in the HTTP client.

## Acceptance Criteria
- [ ] Retries up to 3 times on 429 with exponential backoff
- [ ] Unit tests cover the retry path

## Constraints
- No new dependencies

## Priority
high
EOF
)"
```

Or via the adapter CLI (after setting `CLAUDE_WORKFLOW_CONTROL_REPO`):

```bash
# List queued tasks
node lib/queue-cli.js list

# Read a specific task (number from `gh issue list`)
node lib/queue-cli.js read 42

# Enqueue using gh directly (preferred — gives you the issue URL back)
```

---

## 4. Driver Read / Transition / Comment / Close Ops

The driver uses the adapter's exported functions. All take `repo` as the first
argument (resolved from `controlRepo(opts)`).

### Reading the queue

```js
const { listQueued, readTask, parseTaskSpec, controlRepo } = require('./lib/queue-cli.js');

const repo = controlRepo({ repo: process.env.CLAUDE_WORKFLOW_CONTROL_REPO });
const issues = listQueued(repo);               // [{number, title, body, labels}, ...]
const issue  = readTask(repo, issues[0].number);
const spec   = parseTaskSpec(issue.body);
// spec: { target_repo, description, acceptance_criteria, constraints, priority, _parse_errors }
```

### Transitioning state

```js
const { transition, nextLabel, LABELS } = require('./lib/queue-cli.js');

// Validate the transition first (throws on invalid)
const to = nextLabel(LABELS.QUEUED, 'pick');   // 'in-progress'
transition(repo, issueNumber, LABELS.QUEUED, to);
```

State machine (event → next state):

| From | Event | To |
|------|-------|----|
| `queued` | `pick` | `in-progress` |
| `queued` | `block` | `blocked` |
| `in-progress` | `scrub` | `scrub-pending` |
| `in-progress` | `block` | `blocked` |
| `in-progress` | `abandon` | `queued` |
| `scrub-pending` | `approve` | `review` |
| `scrub-pending` | `fail` | `scrub-failed` |
| `scrub-pending` | `in_progress` | `in-progress` |
| `review` | `approve` | `done` |
| `review` | `request_changes` | `changes-requested` |
| `review` | `block` | `blocked` |
| `changes-requested` | `resume` | `in-progress` |
| `changes-requested` | `block` | `blocked` |
| `scrub-failed` | `resume` | `in-progress` |
| `scrub-failed` | `abandon` | `queued` |
| `blocked` | `unblock` | `queued` |
| `done` | _(terminal)_ | — |

### Posting progress comments

```js
const { comment } = require('./lib/queue-cli.js');
comment(repo, issueNumber, 'Step 3/5 complete: migrations applied.');
```

### Closing a completed task

```js
const { closeDone, transition, LABELS, nextLabel } = require('./lib/queue-cli.js');

// Transition to done label first, then close the issue
const to = nextLabel(LABELS.REVIEW, 'approve'); // 'done'
transition(repo, n, LABELS.REVIEW, to);
closeDone(repo, n);   // gh issue close --reason completed
```

### Reopening a task

```js
const { reopen } = require('./lib/queue-cli.js');
reopen(repo, issueNumber);   // re-opens a closed issue (e.g. after a blocked→queued path)
```

---

## 5. CLI Reference

```
node lib/queue-cli.js list                              [--repo owner/name]
node lib/queue-cli.js read       <number>               [--repo owner/name]
node lib/queue-cli.js transition <number> <from> <to>  [--repo owner/name]
node lib/queue-cli.js comment    <number> "<body>"     [--repo owner/name]
node lib/queue-cli.js close      <number>               [--repo owner/name]
node lib/queue-cli.js reopen     <number>               [--repo owner/name]
```

`--repo` overrides `CLAUDE_WORKFLOW_CONTROL_REPO`. Both must be `owner/repo`.
