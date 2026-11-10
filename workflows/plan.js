export const meta = {
  name: 'plan',
  description: 'Explore the codebase in parallel, then a judge returns a complete plan or the open questions that block one',
  whenToUse: 'Before implementing a non-trivial change. Runs one round per call: when it returns status "questions", ask the user and call it again with args.answers, passing the result\'s findings and explore back as args.findings and args.explore.',
  phases: [
    { title: 'Explore', detail: 'parallel read-only explorers, one per angle' },
    { title: 'Judge', detail: 'architect decides: complete plan or open questions' },
  ],
}

// args: {
//   task: string,                         what to build (required)
//   repo?: string,                        absolute repo path (default: session working directory)
//   answers?: [{question, answer}],       answers to earlier rounds' questions
//   findings?: object[],                  explorer findings from earlier rounds (pass back result.findings)
//   explore?: string[],                   areas to explore this round (pass back result.explore)
//   angles?: string[],                    exploration angles for a first round (default: DEFAULT_ANGLES)
//   round?: number,                       round number, for the record (default 1)
//   judge_effort?: string,                effort for the fable architect: low | medium | high | xhigh | max (default: frontmatter)
//   worker_effort?: string,               effort for the sonnet explorers (default: frontmatter)
//   judge_fallback?: string               model the judge is retried on once when it returns nothing (default 'opus'; 'none' = no retry)
// }
// A follow-up round (args.findings given) reuses the earlier findings and runs explorers only
// for args.explore, so the judge does not pay for the same exploration twice.
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
const input = argsObject(args, 'task')
if (!input.task) throw new Error('plan: a task is required: pass it as args.task, or as the text after /workflow:plan')

const REPO = input.repo || '.'
const ROUND = input.round || 1
const ANSWERS = input.answers || []
const PRIOR_FINDINGS = Array.isArray(input.findings) ? input.findings : []
const EXPLORE = Array.isArray(input.explore) ? input.explore.filter(Boolean) : []

// Same levels and rule as the shared review core in review.js and implement.js:
// omitted means nothing is passed and the agents' frontmatter levels apply.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
function checkEffort(name, value) {
  if (value === undefined || value === null || value === '') return null
  if (!EFFORT_LEVELS.includes(value)) {
    throw new Error(`${name} must be one of ${EFFORT_LEVELS.join(', ')} (got ${JSON.stringify(value)})`)
  }
  return value
}
const JUDGE_EFFORT = checkEffort('plan: judge_effort', input.judge_effort)
const WORKER_EFFORT = checkEffort('plan: worker_effort', input.worker_effort)
const withEffort = (opts, level) => (level ? { ...opts, effort: level } : opts)
const EFFORT_RECORD = { judge: JUDGE_EFFORT || 'frontmatter', worker: WORKER_EFFORT || 'frontmatter' }

// Same rule as the shared review core: the fable judge is retried once on this model
// when it returns nothing (default opus; 'none' turns the retry off).
const DEFAULT_JUDGE_FALLBACK = 'opus'
function checkFallback(name, value) {
  if (value === undefined || value === null || value === '') return DEFAULT_JUDGE_FALLBACK
  if (value === 'none') return null
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]*$/.test(value)) {
    throw new Error(`${name} must be a model alias or id, or "none" (got ${JSON.stringify(value)})`)
  }
  return value
}
const FALLBACK = checkFallback('plan: judge_fallback', input.judge_fallback)
const fallbacks_used = []

const DEFAULT_ANGLES = [
  'Code paths: the modules, functions and call sites this task would change or extend',
  'Conventions: the nearest existing analog to what is being built, naming, error handling, and how tests are laid out',
  'Constraints: docs, READMEs, specs, configuration and dependency versions that limit how this can be built',
]
const ANGLES = PRIOR_FINDINGS.length
  ? EXPLORE
  : (input.angles && input.angles.length ? input.angles : DEFAULT_ANGLES)

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['angle', 'findings', 'relevant_files'],
  properties: {
    angle: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'files'],
        properties: {
          claim: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    relevant_files: { type: 'array', items: { type: 'string' } },
    conventions: { type: 'array', items: { type: 'string' } },
    unknowns: { type: 'array', items: { type: 'string' }, description: 'What the code could not answer' },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['plan', 'questions'] },
    explore: {
      type: 'array',
      items: { type: 'string' },
      description: 'With questions only: areas the findings do not cover and the next round must explore',
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['question', 'why'],
        properties: {
          question: { type: 'string' },
          why: { type: 'string', description: 'How the answer changes the plan' },
          options: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    plan: {
      type: 'object',
      required: ['summary', 'acceptance_criteria', 'work_items'],
      properties: {
        summary: { type: 'string' },
        acceptance_criteria: { type: 'array', items: { type: 'string' } },
        work_items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'title', 'description', 'files'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string', description: 'Enough detail for an executor to work without re-deriving the design' },
              files: { type: 'array', items: { type: 'string' } },
              analog: { type: 'string', description: 'Existing file to match' },
              depends_on: { type: 'array', items: { type: 'string' } },
              optional: { type: 'boolean', description: 'true for hardening or policy beyond the acceptance criteria' },
            },
          },
        },
        tests_in_items: {
          type: 'boolean',
          description: 'true when the work items themselves write the tests that cover the acceptance criteria',
        },
        risks: { type: 'array', items: { type: 'string' } },
        testing: { type: 'string' },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
    },
  },
}

const answersBlock = ANSWERS.length
  ? '\n\nAnswers from earlier rounds (treat as requirements):\n' +
    ANSWERS.map((a, i) => `${i + 1}. Q: ${a.question}\n   A: ${a.answer}`).join('\n')
  : ''

phase('Explore')
if (PRIOR_FINDINGS.length) {
  log(`follow-up round: reusing ${PRIOR_FINDINGS.length} earlier findings; ${ANGLES.length ? `exploring ${ANGLES.length} new areas` : 'no new exploration'}`)
}
const fresh = (await parallel(ANGLES.map((angle, i) => () =>
  agent(
    `Repository: ${REPO}\nTask being planned: ${input.task}${answersBlock}\n\n` +
    `Your angle: ${angle}\n\n` +
    'Explore read-only from this angle and report what a planner needs: concrete claims with the files ' +
    'that support them, the files that matter, the conventions to follow, and what the code cannot answer.',
    withEffort({ label: `explore:r${ROUND}.${i + 1}`, phase: 'Explore', agentType: 'workflow:explorer', schema: FINDINGS_SCHEMA }, WORKER_EFFORT),
  )))).filter(Boolean)

if (fresh.length < ANGLES.length) {
  log(`${ANGLES.length - fresh.length} of ${ANGLES.length} explorers returned nothing; the judge works from the rest`)
}
const explored = [...PRIOR_FINDINGS, ...fresh]

phase('Judge')
const judge_opts = withEffort({ label: `judge:r${ROUND}`, phase: 'Judge', agentType: 'workflow:architect', schema: JUDGE_SCHEMA }, JUDGE_EFFORT)
const judge_prompt = (
  `Repository: ${REPO}\nTask: ${input.task}${answersBlock}\n\n` +
  `Exploration findings (JSON):\n${JSON.stringify(explored, null, 2)}\n\n` +
  'Work from these findings; do not explore the codebase again. Open a file only to confirm a specific ' +
  'detail the findings leave ambiguous. If an area the plan depends on is not covered, return status ' +
  '"questions" and name it under explore, so the next round explores just that.\n\n' +
  'Decide whether a complete plan can be written without guessing. If a requirement, constraint or ' +
  'acceptance criterion is missing and its answer would change the design, return status "questions" ' +
  'with only those questions. Otherwise return status "plan": numbered testable acceptance criteria, ' +
  'and work items an executor can follow, each naming its files, the analog to match, and the ids it ' +
  'depends on. Items that share a file must depend on each other. Executors see only the plan and ' +
  'their own work item, never this task text: copy any exact text, values or code the task gives into ' +
  'the work item that needs it, verbatim.\n\n' +
  'Write the smallest plan that meets the acceptance criteria. Hardening, extra validation or policy ' +
  'beyond them goes into separate work items marked optional: true, not into the required items. Set ' +
  'tests_in_items to true when the work items themselves write the tests that cover the acceptance ' +
  'criteria. Do not write the plan to disk; return it.'
)
let verdict = await agent(judge_prompt, judge_opts)
if (verdict === null && FALLBACK) {
  log(`${judge_opts.label} returned no result. A workflow cannot see why; an unavailable model is one cause. ` +
    `Retrying once on ${FALLBACK}.`)
  verdict = await agent(judge_prompt, { ...judge_opts, label: `${judge_opts.label}:fallback`, model: FALLBACK })
  fallbacks_used.push({ label: judge_opts.label, model: FALLBACK, result: verdict === null ? 'no result' : 'ok' })
}
const FALLBACK_RECORD = { model: FALLBACK || 'none', used: fallbacks_used }

if (!verdict) throw new Error('plan: the judge returned no result')
if (verdict.status === 'plan' && !verdict.plan) {
  log('judge said "plan" but returned none; reporting as questions')
  return {
    status: 'questions', round: ROUND, findings: explored, explore: [], effort: EFFORT_RECORD, judge_fallback: FALLBACK_RECORD,
    questions: [{ question: 'The judge returned no plan; rerun or narrow the task.', why: 'No plan was produced' }],
  }
}

if (verdict.status === 'plan') {
  const optional = (verdict.plan.work_items || []).filter(w => w.optional === true)
  if (optional.length) log(`${optional.length} optional work items; implement skips them unless args.include_optional is true`)
  return { status: 'plan', round: ROUND, task: input.task, plan: verdict.plan, effort: EFFORT_RECORD, judge_fallback: FALLBACK_RECORD }
}
// Pass findings and explore back as args.findings and args.explore with the answers.
return {
  status: 'questions', round: ROUND, questions: verdict.questions || [], explore: verdict.explore || [],
  findings: explored, effort: EFFORT_RECORD, judge_fallback: FALLBACK_RECORD,
}
