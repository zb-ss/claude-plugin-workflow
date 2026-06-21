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
  swarm: {
    forbidden: [],
    preferred: 'sonnet',
    description: 'Single-worktree parallel execution, opus for review/validation',
  },
  epic: {
    forbidden: [],
    preferred: 'sonnet',
    description: 'Multi-worktree per-component execution, opus for review/validation',
  },
};

/**
 * Maps agent subagent_type to gate names in the state file.
 * Used by subagent-stop-track.js to update gate status.
 */
const AGENT_GATE_MAP = {
  'workflow:architect': 'planning',
  'workflow:executor': 'implementation',
  'workflow:reviewer-deep': 'code_review',
  'workflow:security-deep': 'security_review',
  'workflow:test-writer': 'tests',
  'workflow:quality-gate': 'quality_gate',
  'workflow:completion-guard': 'completion_guard',
  'workflow:codebase-analyzer': 'codebase_analysis',
  'workflow:supervisor': 'orchestration',
  'workflow:e2e-explorer': 'e2e_exploration',
  'workflow:e2e-generator': 'e2e_generation',
  'workflow:e2e-reviewer': 'e2e_validation',
  'workflow:web-tester': 'live_testing',
  'workflow:epic-integrator': 'integration',
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
  'e2e_validation',   // mandatory for FE-facing changes; marked `skipped` otherwise
  'scrub_gate',       // mandatory before any public-repo write; `skipped` if target is private
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
 * Epic workflow phase ordering.
 * Defines the expected flow through an epic workflow.
 */
const EPIC_PHASE_ORDER = [
  'architecture',
  'component_execution',
  'integration',
  'e2e_validation',   // mandatory for FE-facing changes; marked `skipped` otherwise
  'scrub_gate',       // mandatory before any public-repo write; `skipped` if target is private
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
  EPIC_PHASE_ORDER,
  isModelForbidden,
  getGateForAgent,
  getPreferredModel,
};
