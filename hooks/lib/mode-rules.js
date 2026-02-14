/**
 * Mode constraint definitions extracted from resources/mode-routing.md.
 * These are enforceable rules, not advisory guidelines.
 */

/**
 * Model constraints per mode.
 * forbidden: models that CANNOT be used in this mode
 * preferred: the default model for this mode
 */
const MODEL_CONSTRAINTS = {
  eco: {
    forbidden: ['opus'],
    preferred: 'haiku',
    description: 'Budget-conscious, haiku only',
  },
  turbo: {
    forbidden: ['opus'],
    preferred: 'haiku',
    description: 'Speed-first, no opus',
  },
  standard: {
    forbidden: [],
    preferred: 'sonnet',
    description: 'Balanced, sonnet default',
  },
  thorough: {
    forbidden: [],
    preferred: 'sonnet',
    description: 'Quality-first, opus for reviews',
  },
  swarm: {
    forbidden: [],
    preferred: 'sonnet',
    description: 'Parallel execution, opus for validation',
  },
};

/**
 * Maps agent subagent_type to gate names in the state file.
 * Used by subagent-stop-track.js to update gate status.
 */
const AGENT_GATE_MAP = {
  'workflow:architect': 'planning',
  'workflow:architect-lite': 'planning',
  'workflow:executor': 'implementation',
  'workflow:executor-lite': 'implementation',
  'workflow:reviewer': 'code_review',
  'workflow:reviewer-lite': 'code_review',
  'workflow:reviewer-deep': 'code_review',
  'workflow:security': 'security_review',
  'workflow:security-lite': 'security_review',
  'workflow:security-deep': 'security_review',
  'workflow:test-writer': 'tests',
  'workflow:quality-gate': 'quality_gate',
  'workflow:completion-guard': 'completion_guard',
  'workflow:perf-reviewer': 'performance',
  'workflow:perf-lite': 'performance',
  'workflow:doc-writer': 'documentation',
  'workflow:codebase-analyzer': 'codebase_analysis',
  'workflow:task-analyzer': 'task_analysis',
  'workflow:supervisor': 'orchestration',
  'workflow:e2e-explorer': 'e2e_exploration',
  'workflow:e2e-generator': 'e2e_generation',
  'workflow:e2e-reviewer': 'e2e_validation',
};

/**
 * Canonical phase ordering.
 * Defines the expected flow through a workflow.
 */
const PHASE_ORDER = [
  'planning',
  'implementation',
  'code_review',
  'security_review',
  'tests',
  'quality_gate',
  'completion_guard',
];

/**
 * E2E testing workflow phase ordering.
 * Alternative track for E2E testing workflows.
 */
const E2E_PHASE_ORDER = [
  'setup',
  'e2e_exploration',
  'e2e_generation',
  'e2e_validation',
  'quality_gate',
  'completion_guard',
];

/**
 * Check if a model is forbidden for a given mode.
 */
function isModelForbidden(mode, model) {
  const constraints = MODEL_CONSTRAINTS[mode];
  if (!constraints) return false;
  return constraints.forbidden.includes(model);
}

/**
 * Get the gate name for an agent type.
 */
function getGateForAgent(agentType) {
  return AGENT_GATE_MAP[agentType] || null;
}

/**
 * Get the preferred model for a mode.
 */
function getPreferredModel(mode) {
  const constraints = MODEL_CONSTRAINTS[mode];
  return constraints ? constraints.preferred : 'sonnet';
}

module.exports = {
  MODEL_CONSTRAINTS,
  AGENT_GATE_MAP,
  PHASE_ORDER,
  E2E_PHASE_ORDER,
  isModelForbidden,
  getGateForAgent,
  getPreferredModel,
};
