export const meta = {
  name: 'review',
  description: 'Scoped review of a change: blocking findings are merged, checked by evidence-quoting verifiers and returned; minor ones come back as notes',
  whenToUse: 'Before merging a change. Default scope is every uncommitted change; narrow it with args.paths and args.base.',
  phases: [
    { title: 'Scope', detail: 'resolve the files in scope and classify the change risk' },
    { title: 'Review', detail: 'quality lens, plus the security lens unless the risk is low' },
    { title: 'Merge', detail: 'group duplicate findings across lenses' },
    { title: 'Verify', detail: 'verifiers quote the line each verdict rests on' },
  ],
}

// args: {
//   base?: string,        git ref the working tree is compared with (default 'HEAD')
//   paths?: string[],     limit the review to these paths (default: every uncommitted change)
//   repo?: string,        absolute repo path (default: session working directory)
//   context?: string,     what the change is meant to do (plan summary, ticket text)
//   verifiers?: number,   verifiers for CRITICAL and security MAJOR findings (default 3, majority decides)
//   max_agents?: number,  stop spawning agents after this many (default 25)
//   judge_effort?: string,  effort for the fable lenses: low | medium | high | xhigh | max (default: frontmatter)
//   worker_effort?: string, effort for the sonnet verifiers (default: frontmatter)
//   judge_fallback?: string model a judge call is retried on once when it returns nothing (default 'opus'; 'none' = no retry)
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
const input = argsObject(args, 'context')
const REPO = input.repo || '.'
const BASE = input.base || 'HEAD'
const PATHS = Array.isArray(input.paths) ? input.paths.filter(Boolean) : []
const VERIFIERS = Math.max(1, input.verifiers || 3)
const MAX_AGENTS = Math.max(1, input.max_agents || 25)

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
  judge: checkEffort('review: judge_effort', input.judge_effort),
  worker: checkEffort('review: worker_effort', input.worker_effort),
}
const FALLBACK = checkFallback('review: judge_fallback', input.judge_fallback)
const { spawn, state } = makeSpawner(MAX_AGENTS, 0, EFFORT, FALLBACK)

phase('Scope')
const scope = await resolveScope(spawn, PATHS)
if (!scope.files.length) {
  const why = scope.error ? `scope could not be resolved: ${scope.error}` : 'no uncommitted change matches the given paths'
  log(`nothing reviewed: ${why}`)
  return {
    status: scope.error ? 'scope_failed' : 'empty', base: BASE, paths: PATHS, scope,
    confirmed: [], refuted: [], unverified: [], notes: [], effort: effortRecord(EFFORT),
    judge_fallback: fallbackRecord(FALLBACK, state),
    agents_used: state.used, stopped: state.stop, summary: `nothing reviewed: ${why}`,
  }
}
const lenses = lensesFor(scope.risk)
log(`${scope.files.length} files in scope, risk ${scope.risk}; lenses: ${lenses.map(l => l.key).join(', ')}`)

phase('Review')
const { findings, missing } = await runLenses(spawn, lenses, l => lensPrompt(l, scope, scope.risk, input.context), scope, 1)
const { blocking, notes } = splitBlocking(findings)
log(`${findings.length} findings: ${blocking.length} blocking, ${notes.length} notes`)

phase('Merge')
const candidates = await mergeDuplicates(spawn, blocking, 1)

phase('Verify')
const { confirmed, refuted, unverified } = await verifyFindings(spawn, candidates, scope, VERIFIERS, 1)
const numbered = confirmed.map((f, i) => ({ id: `ISSUE-${i + 1}`, ...f }))

return {
  status: state.stop ? 'stopped' : 'done',
  base: BASE,
  paths: PATHS,
  scope,
  lenses_run: lenses.map(l => l.key),
  lenses_missing: missing,
  lens_stats: lensStats(lenses, findings, confirmed),
  confirmed: numbered,
  refuted,
  unverified,
  notes,
  effort: effortRecord(EFFORT),
  judge_fallback: fallbackRecord(FALLBACK, state),
  agents_used: state.used,
  stopped: state.stop,
  summary: `${numbered.length} confirmed (${['CRITICAL', 'MAJOR'].map(s => `${numbered.filter(c => c.severity === s).length} ${s}`).join(', ')}), ` +
    `${refuted.length} refuted, ${unverified.length} unverified, ${notes.length} notes; risk ${scope.risk}`,
}
