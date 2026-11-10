export const meta = {
  name: 'implement',
  description: 'Execute a plan: executors per work item, tests, a scoped review whose blocking findings are verified and fixed in bounded rounds, then sign-off',
  whenToUse: 'After /workflow:plan returned status "plan". Pass that result (or its plan object) as args.plan.',
  phases: [
    { title: 'Implement', detail: 'one executor per work item; items sharing files never run at the same time' },
    { title: 'Test', detail: 'test-writer covers the changed code, unless the plan already put tests in the work items' },
    { title: 'Scope', detail: 'resolve the reviewed files and classify the change risk, once per run' },
    { title: 'Review', detail: 'quality lens, plus the security lens unless the risk is low; later rounds see only the fixes' },
    { title: 'Merge', detail: 'group duplicate findings across lenses' },
    { title: 'Verify', detail: 'verifiers quote the line each verdict rests on' },
    { title: 'Fix', detail: 'executor fixes confirmed findings; bounded rounds' },
    { title: 'Sign-off', detail: 'completion-guard checks requirements, build and tests' },
  ],
}

// args: {
//   plan: object,               result of /workflow:plan, or its .plan object (required)
//   repo?: string,              absolute repo path (default: session working directory)
//   base?: string,              git ref the review compares with (default 'HEAD')
//   paths?: string[],           review these paths (default: the plan's files plus every file reported changed)
//   max_fix_rounds?: number,    fix rounds after the first review (default 2)
//   verifiers?: number,         verifiers for CRITICAL and security MAJOR findings (default 3, majority decides)
//   sign_off?: boolean,         run completion-guard at the end (default true)
//   max_agents?: number,        stop spawning agents after this many; one slot stays reserved for sign-off (default 25)
//   include_optional?: boolean, also build work items the plan marked optional (default false)
//   judge_effort?: string,      effort for the fable lenses and sign-off: low | medium | high | xhigh | max (default: frontmatter)
//   worker_effort?: string,     effort for the sonnet executors, test-writer and verifiers (default: frontmatter)
//   judge_fallback?: string     model a judge call is retried on once when it returns nothing (default 'opus'; 'none' = no retry)
// }
// A slash command passes the text typed after it as one plain string. A string that
// holds a JSON object is read as the args object; any other string fills `field`.
function argsObject(raw, field) {
  if (typeof raw !== 'string') return raw || {}
  const text = raw.trim()
  if (!text) return {}
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch (error) {
      // Not JSON: fall through and use it as text
    }
  }
  return field ? { [field]: text } : null
}
const input = argsObject(args, null)
if (input === null) {
  throw new Error('implement: needs the plan result from /workflow:plan as args.plan, not plain text. ' +
    'To go from a task in plain words to a change, use /workflow:do.')
}
const PLAN = input.plan && input.plan.plan ? input.plan.plan : input.plan
// The plan result carries the original task: executors need any exact text it gives.
const TASK = input.plan && typeof input.plan.task === 'string' ? input.plan.task : ''
if (!PLAN || !Array.isArray(PLAN.work_items) || PLAN.work_items.length === 0) {
  throw new Error('implement: args.plan with a non-empty work_items array is required')
}
const REPO = input.repo || '.'
const BASE = input.base || 'HEAD'
const PATHS = Array.isArray(input.paths) ? input.paths.filter(Boolean) : []
const MAX_FIX_ROUNDS = input.max_fix_rounds === undefined ? 2 : input.max_fix_rounds
const VERIFIERS = Math.max(1, input.verifiers || 3)
const SIGN_OFF = input.sign_off !== false
const MAX_AGENTS = Math.max(SIGN_OFF ? 2 : 1, input.max_agents || 25)
const INCLUDE_OPTIONAL = input.include_optional === true

const dropped = []
function drop(what, why) {
  dropped.push({ what, why })
  log(`dropped: ${what} (${why})`)
}

const unique = list => [...new Set(list.filter(Boolean))]

const EXEC_SCHEMA = {
  type: 'object',
  required: ['status', 'files_changed', 'notes'],
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    files_changed: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    deviations: { type: 'array', items: { type: 'string' } },
    remaining: { type: 'array', items: { type: 'string' } },
  },
}
const TEST_SCHEMA = {
  type: 'object',
  required: ['test_files', 'passed', 'failed'],
  properties: {
    test_files: { type: 'array', items: { type: 'string' } },
    passed: { type: 'integer' },
    failed: { type: 'integer' },
    failures: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}
const FIX_SCHEMA = {
  type: 'object',
  required: ['fixes', 'files_changed'],
  properties: {
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'status', 'detail'],
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['FIXED', 'DISPUTE'] },
          detail: { type: 'string' },
          regions: {
            type: 'array',
            description: 'Every region this fix changed',
            items: {
              type: 'object',
              required: ['file', 'start_line', 'end_line'],
              properties: { file: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } },
            },
          },
        },
      },
    },
    files_changed: { type: 'array', items: { type: 'string' }, description: 'Every file you touched' },
  },
}
const SIGNOFF_SCHEMA = {
  type: 'object',
  required: ['approved', 'issues'],
  properties: {
    approved: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['issue', 'action'],
        properties: { issue: { type: 'string' }, file: { type: 'string' }, action: { type: 'string' } },
      },
    },
  },
}

// ==== shared review core: keep identical in review.js and implement.js ====
const BLOCKING = new Set(['CRITICAL', 'MAJOR'])
const RANK = { CRITICAL: 3, MAJOR: 2, MINOR: 1 }
const VERIFY_BATCH = 4

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'confidence', 'title', 'file', 'failure_scenario', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['CRITICAL', 'MAJOR', 'MINOR'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string' },
          file: { type: 'string', description: 'Path relative to the repository root' },
          line: { type: 'integer' },
          failure_scenario: { type: 'string', description: 'The input or state, and the wrong result it produces' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
          previous_id: { type: 'string', description: 'Only when re-reporting a finding from an earlier round: its id' },
        },
      },
    },
  },
}

const VERDICTS_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'real', 'reason', 'evidence'],
        properties: {
          index: { type: 'integer' },
          real: { type: 'boolean', description: 'true only if the defect exists and its failure scenario can happen' },
          reason: { type: 'string' },
          evidence: {
            type: 'object',
            required: ['file', 'line', 'quote'],
            properties: {
              file: { type: 'string' },
              line: { type: 'integer' },
              quote: { type: 'string', description: 'The exact text of that line, copied from the file' },
            },
          },
        },
      },
    },
  },
}

const MERGE_SCHEMA = {
  type: 'object',
  required: ['groups'],
  properties: {
    groups: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
  },
}

const SCOPE_SCHEMA = {
  type: 'object',
  required: ['risk', 'files'],
  properties: {
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    signals: {
      type: 'array',
      items: { type: 'object', properties: { category: { type: 'string' }, where: { type: 'string' } } },
    },
    files: { type: 'array', items: { type: 'string' } },
    untracked: { type: 'array', items: { type: 'string' } },
    lines_changed: { type: 'integer' },
    error: { type: 'string' },
  },
}

const QUALITY_LENS = { key: 'quality', agentType: 'workflow:reviewer-deep' }
const SECURITY_LENS = { key: 'security', agentType: 'workflow:security-deep' }
const SECURITY_CHECKLIST =
  '\n\nThe change was classified low risk, so no separate security review runs. Also check briefly for: ' +
  'untrusted input reaching a shell, SQL, file path or HTML sink; secrets or credentials in code, logs ' +
  'or errors; new network calls or file writes outside the repository; weakened authentication or ' +
  'permission checks. Report what you find as normal findings.'

// Per-run effort overrides by tier. Omitted means nothing is passed and each
// agent's frontmatter level applies. The haiku agents (scope, finding-merger)
// are never overridden.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const JUDGE_TYPES = new Set(['workflow:architect', 'workflow:reviewer-deep', 'workflow:security-deep', 'workflow:completion-guard', 'workflow:spec-conformance'])
const WORKER_TYPES = new Set(['workflow:explorer', 'workflow:executor', 'workflow:test-writer', 'workflow:verifier'])

function checkEffort(name, value) {
  if (value === undefined || value === null || value === '') return null
  if (!EFFORT_LEVELS.includes(value)) {
    throw new Error(`${name} must be one of ${EFFORT_LEVELS.join(', ')} (got ${JSON.stringify(value)})`)
  }
  return value
}

function effortFor(agent_type, efforts) {
  if (JUDGE_TYPES.has(agent_type)) return efforts.judge
  if (WORKER_TYPES.has(agent_type)) return efforts.worker
  return null
}

function effortRecord(efforts) {
  return { judge: efforts.judge || 'frontmatter', worker: efforts.worker || 'frontmatter', mechanical: 'frontmatter' }
}

// Judges pin the fable alias. When a judge call returns nothing, the call is
// retried once on this model (default opus); 'none' turns the retry off.
const DEFAULT_JUDGE_FALLBACK = 'opus'

function checkFallback(name, value) {
  if (value === undefined || value === null || value === '') return DEFAULT_JUDGE_FALLBACK
  if (value === 'none') return null
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]*$/.test(value)) {
    throw new Error(`${name} must be a model alias or id, or "none" (got ${JSON.stringify(value)})`)
  }
  return value
}

// Counts every agent the run starts. `reserve` slots are kept back for calls
// made with reserved: true (sign-off), so a stop still leaves room for them.
// A judge call that returns nothing is retried once on `fallback`; the retry
// counts against the cap like any other agent.
function makeSpawner(max_agents, reserve, efforts, fallback) {
  const state = { used: 0, stop: null, fallbacks: [] }

  async function start(prompt, opts, reserved) {
    const limit = reserved ? max_agents : max_agents - reserve
    if (!reserved && state.stop) return { ran: false, result: null }
    if (state.used >= limit) {
      if (!state.stop) {
        state.stop = `agent cap of ${max_agents} reached before ${opts.label}`
        log(`stopping: ${state.stop}`)
      }
      return { ran: false, result: null }
    }
    state.used++
    const level = effortFor(opts.agentType, efforts)
    try {
      return { ran: true, result: await agent(prompt, level ? { ...opts, effort: level } : opts) }
    } catch (error) {
      if (!state.stop) {
        state.stop = `${opts.label} could not start: ${String((error && error.message) || error)}`
        log(`stopping: ${state.stop}`)
      }
      return { ran: false, result: null }
    }
  }

  async function spawn(prompt, opts, reserved) {
    const first = await start(prompt, opts, reserved)
    if (!first.ran || first.result !== null || !fallback || !JUDGE_TYPES.has(opts.agentType)) return first.result
    log(`${opts.label} returned no result. A workflow cannot see why; an unavailable model is one cause. ` +
      `Retrying once on ${fallback}.`)
    const retry = await start(prompt, { ...opts, label: `${opts.label}:fallback`, model: fallback }, reserved)
    state.fallbacks.push({ label: opts.label, model: fallback, result: retry.result === null ? 'no result' : 'ok' })
    return retry.result
  }

  return { spawn, state }
}

function fallbackRecord(fallback, state) {
  return { model: fallback || 'none', used: state.fallbacks }
}

function relPath(file) {
  let p = String(file || '')
  if (REPO !== '.' && p.startsWith(REPO + '/')) p = p.slice(REPO.length + 1)
  return p.replace(/^\.\//, '')
}

// Lenses sometimes return absolute paths; map them onto the scoped files.
function normalizeFile(file, scope_files) {
  const p = relPath(file)
  if (!p.startsWith('/')) return p
  const match = (scope_files || []).find(s => p.endsWith('/' + s))
  return match || p
}

function scopeText(scope) {
  const tracked = scope.files.filter(f => !(scope.untracked || []).includes(f))
  return `Repository: ${REPO}\n` +
    `Change under review: \`git diff ${BASE} -- <file>\` for ${tracked.length ? tracked.join(', ') : '(no tracked files)'}` +
    `${(scope.untracked || []).length ? `; untracked new files (read them whole): ${scope.untracked.join(', ')}` : ''}. ` +
    'Run git in the repository directory. Review nothing outside these files.'
}

async function resolveScope(spawn, paths) {
  const result = await spawn(
    `Repository: ${REPO}\nBase ref: ${BASE}\n` +
    `Paths: ${paths.length ? paths.join(' ') : '(none: the whole uncommitted change)'}`,
    { label: 'scope', phase: 'Scope', agentType: 'workflow:scope', schema: SCOPE_SCHEMA },
  )
  if (!result) {
    log('scope agent returned nothing; treating the change as high risk')
    return { risk: 'high', signals: [], files: paths.map(relPath), untracked: [], error: 'scope agent returned nothing' }
  }
  if (result.error) log(`scope: ${result.error}`)
  return {
    risk: result.risk,
    signals: result.signals || [],
    files: (result.files || []).map(relPath),
    untracked: (result.untracked || []).map(relPath),
    lines_changed: result.lines_changed,
    error: result.error,
  }
}

function lensesFor(risk) {
  return risk === 'low' ? [QUALITY_LENS] : [QUALITY_LENS, SECURITY_LENS]
}

async function runLenses(spawn, lenses, prompt_for, scope, round) {
  const results = await parallel(lenses.map(l => () =>
    spawn(prompt_for(l), { label: `lens:${l.key}:r${round}`, phase: 'Review', agentType: l.agentType, schema: FINDINGS_SCHEMA })
      .then(r => (r ? r.findings.map(f => ({
        ...f,
        title: f.title.replace(/^\s*\[ISSUE-\d+\]\s*/, ''),
        file: normalizeFile(f.file, scope.files),
        lens: l.key,
      })) : null))))
  const missing = lenses.filter((_, i) => !results[i]).map(l => l.key)
  if (missing.length) log(`round ${round}: no result from ${missing.join(', ')} lens; that dimension is not covered`)
  return { findings: results.filter(Boolean).flat(), missing }
}

// Per-lens evidence for deciding later whether both lenses earn their cost.
// A merged finding confirmed by both lenses counts under confirmed_with_other_lens.
function lensStats(lenses, findings, confirmed) {
  return lenses.map(l => ({
    lens: l.key,
    candidates: findings.filter(f => f.lens === l.key).length,
    blocking: findings.filter(f => f.lens === l.key && BLOCKING.has(f.severity)).length,
    confirmed_only_this_lens: confirmed.filter(f => f.lens === l.key).length,
    confirmed_with_other_lens: confirmed.filter(f => f.lens !== l.key && String(f.lens).split('+').includes(l.key)).length,
  }))
}

function splitBlocking(findings) {
  return {
    blocking: findings.filter(f => BLOCKING.has(f.severity)),
    notes: findings.filter(f => !BLOCKING.has(f.severity)),
  }
}

// True only when every index 0..n-1 appears in exactly one non-empty group.
function isPartition(groups, n) {
  if (!Array.isArray(groups)) return false
  const seen = new Set()
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) return false
    for (const i of group) {
      if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) return false
      seen.add(i)
    }
  }
  return seen.size === n
}

// One merge call per round, only when two lenses both raised blocking findings.
// The merger's output is checked in code: anything but an exact partition of the
// findings falls back to the unmerged list, and a merged finding keeps every
// member in merged_from, so a wrong merge can never drop a finding.
async function mergeDuplicates(spawn, candidates, round) {
  const lens_count = new Set(candidates.map(f => f.lens)).size
  if (candidates.length < 2 || lens_count < 2) return candidates
  const brief = f => ({ lens: f.lens, severity: f.severity, title: f.title, file: f.file, line: f.line, failure_scenario: f.failure_scenario })
  const listed = candidates.map((f, index) => ({ index, ...brief(f) }))
  const result = await spawn(
    `Group these review findings by underlying defect:\n${JSON.stringify(listed, null, 2)}`,
    { label: `merge:r${round}`, phase: 'Merge', agentType: 'workflow:finding-merger', schema: MERGE_SCHEMA },
  )
  if (!result) return candidates
  if (!isPartition(result.groups, candidates.length)) {
    log(`round ${round}: merge result is not an exact partition of the ${candidates.length} findings; verifying them unmerged`)
    return candidates
  }
  const merged = result.groups.map(members => {
    const group = members.map(i => candidates[i])
    const top = group.slice().sort((a, b) => RANK[b.severity] - RANK[a.severity])[0]
    return group.length === 1 ? top : {
      ...top,
      lens: [...new Set(group.map(f => f.lens))].join('+'),
      merged: group.length,
      merged_from: group.map(brief),
    }
  })
  if (merged.length < candidates.length) log(`round ${round}: merged ${candidates.length} blocking findings into ${merged.length}`)
  return merged
}

// CRITICAL and security MAJOR findings get `verifiers` votes and a majority;
// every other blocking finding gets one. A verdict counts only with a quote.
function votesNeeded(f, verifiers) {
  const security = String(f.lens).split('+').includes('security')
  return f.severity === 'CRITICAL' || (f.severity === 'MAJOR' && security) ? verifiers : 1
}

function hasEvidence(v) {
  const e = v && v.evidence
  return Boolean(e && typeof e.file === 'string' && e.file.trim() &&
    Number.isInteger(e.line) && e.line > 0 && typeof e.quote === 'string' && e.quote.trim().length >= 3)
}

async function verifyFindings(spawn, candidates, scope, verifiers, round) {
  const assigned = candidates.map(f => votesNeeded(f, verifiers))
  const votes = candidates.map(() => [])
  const pools = {}
  candidates.forEach((f, index) => { (pools[assigned[index]] = pools[assigned[index]] || []).push({ index, ...f }) })
  const thunks = []
  for (const [n, pool] of Object.entries(pools)) {
    for (let c = 0; c * VERIFY_BATCH < pool.length; c++) {
      const chunk = pool.slice(c * VERIFY_BATCH, (c + 1) * VERIFY_BATCH)
      for (let v = 0; v < Number(n); v++) {
        thunks.push(() => spawn(
          `${scopeText(scope)}\n\nVerify these findings. Return exactly one verdict per index, each quoting ` +
          `the file, line and exact text it rests on.\n\n${JSON.stringify(chunk, null, 2)}`,
          { label: `verify:r${round}.${n}x.${c + 1}.${v + 1}`, phase: 'Verify', agentType: 'workflow:verifier', schema: VERDICTS_SCHEMA },
        ).then(r => {
          if (!r) return
          const counted = new Set()
          for (const vd of r.verdicts) {
            if (counted.has(vd.index) || !chunk.some(f => f.index === vd.index)) continue
            counted.add(vd.index)
            votes[vd.index].push(vd)
          }
        }))
      }
    }
  }
  await parallel(thunks)

  const confirmed = []
  const refuted = []
  const unverified = []
  candidates.forEach((f, i) => {
    const counted = votes[i].filter(hasEvidence)
    const yes = counted.filter(v => v.real).length
    const no = counted.length - yes
    const needed = Math.floor(assigned[i] / 2) + 1
    const record = {
      ...f,
      votes: `${yes} real, ${no} not real, ${votes[i].length - counted.length} without evidence (of ${assigned[i]})`,
      reasons: counted.map(v => `${v.evidence.file}:${v.evidence.line} ${v.reason}`),
    }
    if (yes >= needed) confirmed.push(record)
    else if (no >= needed) refuted.push(record)
    else unverified.push(record)
  })
  if (unverified.length) log(`round ${round}: ${unverified.length} blocking findings got no evidence-backed majority; returned as unverified`)
  return { confirmed, refuted, unverified }
}

function lensPrompt(lens, scope, risk, context, extra) {
  return `${scopeText(scope)}${context ? `\nIntent of the change: ${context}` : ''}\n\n` +
    'Review the change through your lens. Report a finding only with a concrete failure_scenario and an honest ' +
    'severity: CRITICAL and MAJOR findings are verified and must be fixed; MINOR findings are returned as ' +
    'non-blocking notes. Give file paths relative to the repository root.' +
    (lens.key === 'quality' && risk === 'low' ? SECURITY_CHECKLIST : '') +
    (extra || '')
}
// ==== end shared review core ====

const EFFORT = {
  judge: checkEffort('implement: judge_effort', input.judge_effort),
  worker: checkEffort('implement: worker_effort', input.worker_effort),
}
const FALLBACK = checkFallback('implement: judge_fallback', input.judge_fallback)
const { spawn, state } = makeSpawner(MAX_AGENTS, SIGN_OFF ? 1 : 0, EFFORT, FALLBACK)

const planBlock =
  `Repository: ${REPO}\n` +
  (TASK ? `Original task (for exact text and values; your work item sets the scope):\n${TASK}\n\n` : '') +
  `Plan summary: ${PLAN.summary || '(none)'}\n` +
  `Acceptance criteria:\n${(PLAN.acceptance_criteria || []).map((c, i) => `${i + 1}. ${c}`).join('\n')}`

// ---------------------------------------------------------------- Implement
// Dependency waves; inside a wave, items that share a file go into separate batches so two
// executors never edit the same file at once (no worktree merge-back is needed that way).
phase('Implement')
const all_items = PLAN.work_items
const skipped_optional = INCLUDE_OPTIONAL ? [] : all_items.filter(it => it.optional === true)
if (skipped_optional.length) {
  log(`skipping optional items ${skipped_optional.map(i => i.id).join(', ')} (pass include_optional: true to build them)`)
}
const items = all_items.filter(it => !skipped_optional.includes(it))
const ids = new Set(all_items.map(i => i.id))
for (const it of items) {
  for (const d of it.depends_on || []) if (!ids.has(d)) log(`item ${it.id}: unknown dependency ${d} ignored`)
}
const done = new Set(skipped_optional.map(i => i.id))
const itemResults = {}
let pending = items.slice()

function batchesWithoutOverlap(wave) {
  const batches = []
  for (const it of wave) {
    const files = new Set(it.files || [])
    const slot = batches.find(b => b.every(o => !(o.files || []).some(f => files.has(f))))
    if (slot) slot.push(it)
    else batches.push([it])
  }
  return batches
}

while (pending.length) {
  let wave = pending.filter(it => (it.depends_on || []).every(d => done.has(d) || !ids.has(d)))
  if (!wave.length) {
    log(`dependency cycle among ${pending.map(i => i.id).join(', ')}; running them one at a time in plan order`)
    wave = [pending[0]]
  }
  for (const batch of batchesWithoutOverlap(wave)) {
    const results = await parallel(batch.map(it => () =>
      spawn(
        `${planBlock}\n\nYour work item (JSON):\n${JSON.stringify(it, null, 2)}\n\n` +
        'Implement this item only, in the repository above. Change only the files it names; list anything ' +
        'else that must change under remaining. Do not commit.',
        { label: `exec:${it.id}`, phase: 'Implement', agentType: 'workflow:executor', schema: EXEC_SCHEMA },
      )))
    batch.forEach((it, i) => {
      itemResults[it.id] = results[i]
      if (!results[i]) drop(`work item ${it.id}`, state.stop || 'executor returned no result')
      else if (results[i].status !== 'done') log(`item ${it.id}: ${results[i].status}; remaining: ${(results[i].remaining || []).join('; ') || 'none listed'}`)
      done.add(it.id)
    })
  }
  pending = pending.filter(it => !done.has(it.id))
}

const changedFiles = unique(Object.values(itemResults).filter(Boolean).flatMap(r => r.files_changed).map(relPath))

// ---------------------------------------------------------------- Test
let tests = null
if (PLAN.tests_in_items === true) {
  tests = { skipped: true, reason: 'the plan put the tests in its work items' }
  log('test-writer skipped: the plan put the tests in its work items')
} else {
  phase('Test')
  tests = await spawn(
    `${planBlock}\n\nFiles changed by the implementation: ${changedFiles.join(', ') || '(see git status)'}\n\n` +
    'Write tests that cover the acceptance criteria and the changed code, following the project\'s test ' +
    'conventions, then run the whole suite and report the counts. Change test files only.',
    { label: 'tests', phase: 'Test', agentType: 'workflow:test-writer', schema: TEST_SCHEMA },
  )
  if (!tests) drop('test writing', state.stop || 'test-writer returned no result')
}

// ---------------------------------------------------------------- Scope
// Default scope: the plan's files plus every file reported changed, so unrelated
// uncommitted work in the tree is never reviewed. Resolved once per run.
const scopePaths = PATHS.length
  ? PATHS
  : unique([
    ...items.flatMap(it => it.files || []),
    ...changedFiles,
    ...((tests && tests.test_files) || []),
  ].map(relPath))
phase('Scope')
let scope = await resolveScope(spawn, scopePaths)
let lenses = lensesFor(scope.risk)
log(`${scope.files.length} files in scope, risk ${scope.risk}; lenses: ${lenses.map(l => l.key).join(', ')}`)

// ---------------------------------------------------------------- Review / Verify / Fix
function regionsFromFix(fix) {
  const touched = unique((fix.files_changed || []).map(f => normalizeFile(f, scope.files)))
  const regions = []
  for (const f of fix.fixes || []) {
    for (const r of f.regions || []) regions.push({ id: f.id, file: normalizeFile(r.file, scope.files), start_line: r.start_line, end_line: r.end_line })
  }
  // A fix without regions, or a touched file no region names, goes to the next round whole.
  const some_fix_without_regions = (fix.fixes || []).some(f => !(f.regions || []).length)
  const named = new Set(regions.map(r => r.file))
  const whole_files = some_fix_without_regions ? touched : touched.filter(f => !named.has(f))
  return { touched, regions: regions.filter(r => !whole_files.includes(r.file)), whole_files }
}

function followUpText(open, refuted, changed) {
  const brief = f => ({ id: f.id, severity: f.severity, title: f.title, file: f.file, line: f.line, failure_scenario: f.failure_scenario })
  return '\n\nThis is a follow-up round after fixes. Review only what the fixes changed:\n' +
    `- changed regions: ${JSON.stringify(changed.regions)}\n` +
    `- whole files (no exact regions were reported): ${changed.whole_files.join(', ') || '(none)'}\n\n` +
    'Previously confirmed findings. Check each; if it is still present, report it again with previous_id set to its id:\n' +
    `${JSON.stringify(open.map(brief), null, 2)}\n\n` +
    'Findings already refuted. Do not report them again unless the code at that location changed:\n' +
    `${JSON.stringify(refuted.map(f => ({ title: f.title, file: f.file, line: f.line })), null, 2)}\n\n` +
    'Report a new finding only if it lies inside the changed regions or whole files above.'
}

let open = []
const refutedAll = []
const unverifiedAll = []
const notesAll = []
const lensStatsAll = []
const fixLog = []
let nextId = 1
let round = 0
let changed = null

while (!state.stop) {
  round++
  phase('Review')
  const extra = changed ? followUpText(open, refutedAll, changed) : ''
  const { findings, missing } = await runLenses(spawn, lenses, l => lensPrompt(l, scope, scope.risk, PLAN.summary, extra), scope, round)
  const open_ids = new Set(open.map(f => f.id))
  // A lens that returned nothing cannot confirm a fix, so its round keeps every open finding.
  const still_open = missing.length
    ? open
    : open.filter(f => findings.some(n => n.previous_id === f.id))
  const fresh = findings.filter(f => !(f.previous_id && open_ids.has(f.previous_id)))
  const { blocking, notes } = splitBlocking(fresh)
  notesAll.push(...notes.map(n => ({ round, ...n })))

  phase('Merge')
  const candidates = await mergeDuplicates(spawn, blocking, round)
  phase('Verify')
  const { confirmed, refuted, unverified } = await verifyFindings(spawn, candidates, scope, VERIFIERS, round)
  refutedAll.push(...refuted.map(f => ({ round, ...f })))
  unverifiedAll.push(...unverified.map(f => ({ round, ...f })))
  lensStatsAll.push({ round, lenses: lensStats(lenses, findings, confirmed) })
  open = [...still_open, ...confirmed.map(f => ({ id: `ISSUE-${nextId++}`, round, ...f }))]
  log(`review round ${round}: ${open.length} open (${confirmed.length} new, ${still_open.length} still open), ` +
    `${refuted.length} refuted, ${unverified.length} unverified, ${notes.length} notes`)

  if (!open.length || state.stop) break
  if (round > MAX_FIX_ROUNDS) {
    open.forEach(f => drop(`${f.id} ${f.severity} "${f.title}" (${f.file})`, `still open after ${MAX_FIX_ROUNDS} fix rounds`))
    break
  }

  phase('Fix')
  const fix = await spawn(
    `${planBlock}\n\nFix these confirmed review findings (Fix Protocol: every id must come back FIXED ` +
    `or DISPUTE with a justification):\n${JSON.stringify(open, null, 2)}\n\n` +
    'For every fix, report each region you changed (file, start_line, end_line). List every file you ' +
    'touched in files_changed. Do not commit.',
    { label: `fix:r${round}`, phase: 'Fix', agentType: 'workflow:executor', schema: FIX_SCHEMA },
  )
  if (!fix) {
    drop(`fix round ${round}`, state.stop || 'executor returned no result')
    break
  }
  fixLog.push({ round, fixes: fix.fixes, files_changed: fix.files_changed })
  for (const d of fix.fixes.filter(x => x.status === 'DISPUTE')) log(`${d.id} disputed: ${d.detail}`)
  // Nothing changed, so another review round would only re-report the same findings.
  if (!(fix.files_changed || []).length) {
    log(`fix round ${round} changed no files; the open findings go to sign-off without another review`)
    open.forEach(f => drop(`${f.id} ${f.severity} "${f.title}" (${f.file})`, 'the fix round changed nothing'))
    break
  }

  changed = regionsFromFix(fix)
  const outside = changed.touched.filter(f => !scope.files.includes(f))
  if (outside.length) {
    log(`the fix touched files outside the scope (${outside.join(', ')}); resolving the scope again`)
    phase('Scope')
    scope = await resolveScope(spawn, unique([...scopePaths, ...outside]))
    lenses = lensesFor(scope.risk)
  }
}

// ---------------------------------------------------------------- Sign-off
let sign_off
if (!SIGN_OFF) {
  sign_off = { ran: false, reason: 'disabled with sign_off: false' }
} else {
  phase('Sign-off')
  const result = await spawn(
    `${planBlock}\n\nWork items (JSON): ${JSON.stringify(items)}\n` +
    `Executor reports (JSON): ${JSON.stringify(itemResults)}\n` +
    `Test report (JSON): ${JSON.stringify(tests)}\n` +
    `Files reviewed: ${scope.files.join(', ')}\n` +
    `Review findings still open: ${JSON.stringify(open)}\n` +
    `Blocking findings nobody could verify: ${JSON.stringify(unverifiedAll)}\n` +
    `${state.stop ? `The run stopped early: ${state.stop}\n` : ''}\n` +
    'Verify every acceptance criterion against the code, run the build (if any) and the full test suite, ' +
    'and decide whether this work may be called complete. Base the verdict on the code, the suite and at ' +
    'most a few targeted checks of specific criteria; do not build new test inputs or run tracing tools. ' +
    'Keep your usual verdict format.',
    { label: 'sign-off', phase: 'Sign-off', agentType: 'workflow:completion-guard', schema: SIGNOFF_SCHEMA },
    true,
  )
  sign_off = result ? { ran: true, ...result } : { ran: false, reason: state.stop || 'completion-guard returned no result' }
  if (!result) drop('sign-off', sign_off.reason)
}

const complete = !state.stop && open.length === 0 && unverifiedAll.length === 0 &&
  (!SIGN_OFF || sign_off.approved === true) &&
  items.every(it => itemResults[it.id] && itemResults[it.id].status === 'done')

return {
  status: complete ? 'complete' : 'needs_attention',
  stopped: state.stop,
  agents_used: state.used,
  items: items.map(it => ({ id: it.id, title: it.title, ...(itemResults[it.id] || { status: 'no_result' }) })),
  skipped_optional: skipped_optional.map(it => ({ id: it.id, title: it.title })),
  changed_files: changedFiles,
  scope,
  lenses: lenses.map(l => l.key),
  effort: effortRecord(EFFORT),
  judge_fallback: fallbackRecord(FALLBACK, state),
  tests,
  review: {
    rounds: round, open, fixes: fixLog, refuted: refutedAll, unverified: unverifiedAll, notes: notesAll, lens_stats: lensStatsAll,
  },
  sign_off,
  dropped,
}
