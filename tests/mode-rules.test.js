/**
 * Tests for hooks/lib/mode-rules.js
 * Covers E2E workflow additions and existing functionality
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  MODEL_CONSTRAINTS,
  AGENT_GATE_MAP,
  PHASE_ORDER,
  E2E_PHASE_ORDER,
  isModelForbidden,
  getGateForAgent,
  getPreferredModel,
} = require('../hooks/lib/mode-rules.js');

describe('E2E Workflow Integration', () => {
  describe('AGENT_GATE_MAP - E2E Agents', () => {
    it('should map workflow:e2e-explorer to e2e_exploration gate', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:e2e-explorer'], 'e2e_exploration');
    });

    it('should map workflow:e2e-generator to e2e_generation gate', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:e2e-generator'], 'e2e_generation');
    });

    it('should map workflow:e2e-reviewer to e2e_validation gate', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:e2e-reviewer'], 'e2e_validation');
    });
  });

  describe('E2E_PHASE_ORDER', () => {
    it('should exist and be an array', () => {
      assert.ok(Array.isArray(E2E_PHASE_ORDER));
    });

    it('should have exactly 6 phases', () => {
      assert.strictEqual(E2E_PHASE_ORDER.length, 6);
    });

    it('should start with setup phase', () => {
      assert.strictEqual(E2E_PHASE_ORDER[0], 'setup');
    });

    it('should include e2e_exploration phase', () => {
      assert.ok(E2E_PHASE_ORDER.includes('e2e_exploration'));
    });

    it('should include e2e_generation phase', () => {
      assert.ok(E2E_PHASE_ORDER.includes('e2e_generation'));
    });

    it('should include e2e_validation phase', () => {
      assert.ok(E2E_PHASE_ORDER.includes('e2e_validation'));
    });

    it('should include quality_gate phase', () => {
      assert.ok(E2E_PHASE_ORDER.includes('quality_gate'));
    });

    it('should include completion_guard phase', () => {
      assert.ok(E2E_PHASE_ORDER.includes('completion_guard'));
    });

    it('should have correct phase ordering', () => {
      const expected = [
        'setup',
        'e2e_exploration',
        'e2e_generation',
        'e2e_validation',
        'quality_gate',
        'completion_guard',
      ];
      assert.deepStrictEqual(E2E_PHASE_ORDER, expected);
    });
  });

  describe('getGateForAgent - E2E Agents', () => {
    it('should return correct gate for e2e-explorer', () => {
      assert.strictEqual(getGateForAgent('workflow:e2e-explorer'), 'e2e_exploration');
    });

    it('should return correct gate for e2e-generator', () => {
      assert.strictEqual(getGateForAgent('workflow:e2e-generator'), 'e2e_generation');
    });

    it('should return correct gate for e2e-reviewer', () => {
      assert.strictEqual(getGateForAgent('workflow:e2e-reviewer'), 'e2e_validation');
    });
  });
});

describe('Existing Functionality Preserved', () => {
  describe('AGENT_GATE_MAP - Surviving Agents', () => {
    it('should preserve architect mapping', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:architect'], 'planning');
    });

    it('should not contain deleted lite/standard agents', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:architect-lite'], undefined);
      assert.strictEqual(AGENT_GATE_MAP['workflow:executor-lite'], undefined);
      assert.strictEqual(AGENT_GATE_MAP['workflow:reviewer'], undefined);
      assert.strictEqual(AGENT_GATE_MAP['workflow:reviewer-lite'], undefined);
      assert.strictEqual(AGENT_GATE_MAP['workflow:security'], undefined);
      assert.strictEqual(AGENT_GATE_MAP['workflow:security-lite'], undefined);
      assert.strictEqual(AGENT_GATE_MAP['workflow:perf-lite'], undefined);
      assert.strictEqual(AGENT_GATE_MAP['workflow:perf-reviewer'], undefined);
      assert.strictEqual(AGENT_GATE_MAP['workflow:doc-writer'], undefined);
      assert.strictEqual(AGENT_GATE_MAP['workflow:task-analyzer'], undefined);
    });

    it('should preserve executor mapping', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:executor'], 'implementation');
    });

    it('should preserve reviewer-deep mapping', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:reviewer-deep'], 'code_review');
    });

    it('should preserve security-deep mapping', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:security-deep'], 'security_review');
    });

    it('should preserve test-writer mapping', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:test-writer'], 'tests');
    });

    it('should preserve quality-gate mapping', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:quality-gate'], 'quality_gate');
    });

    it('should preserve completion-guard mapping', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:completion-guard'], 'completion_guard');
    });

    it('should preserve codebase-analyzer mapping', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:codebase-analyzer'], 'codebase_analysis');
    });

    it('should preserve supervisor mapping', () => {
      assert.strictEqual(AGENT_GATE_MAP['workflow:supervisor'], 'orchestration');
    });
  });

  describe('PHASE_ORDER - Existing Phases', () => {
    it('should have 8 phases', () => {
      assert.strictEqual(PHASE_ORDER.length, 8);
    });

    it('should maintain correct ordering (e2e_validation gates before completion)', () => {
      const expected = [
        'planning',
        'implementation',
        'code_review',
        'security_review',
        'tests',
        'quality_gate',
        'e2e_validation',
        'completion_guard',
      ];
      assert.deepStrictEqual(PHASE_ORDER, expected);
    });
  });

  describe('MODEL_CONSTRAINTS', () => {
    it('should have exactly 2 modes defined (swarm, epic)', () => {
      const modes = ['swarm', 'epic'];
      modes.forEach(mode => {
        assert.ok(MODEL_CONSTRAINTS[mode], `Mode ${mode} should exist`);
      });
      assert.strictEqual(Object.keys(MODEL_CONSTRAINTS).length, 2);
    });

    it('should not contain removed modes', () => {
      assert.strictEqual(MODEL_CONSTRAINTS.eco, undefined);
      assert.strictEqual(MODEL_CONSTRAINTS.turbo, undefined);
      assert.strictEqual(MODEL_CONSTRAINTS.standard, undefined);
      assert.strictEqual(MODEL_CONSTRAINTS.thorough, undefined);
    });

    it('should maintain swarm mode constraints', () => {
      assert.deepStrictEqual(MODEL_CONSTRAINTS.swarm.forbidden, []);
      assert.strictEqual(MODEL_CONSTRAINTS.swarm.preferred, 'sonnet');
    });

    it('should maintain epic mode constraints', () => {
      assert.deepStrictEqual(MODEL_CONSTRAINTS.epic.forbidden, []);
      assert.strictEqual(MODEL_CONSTRAINTS.epic.preferred, 'sonnet');
    });
  });
});

describe('Function Tests', () => {
  describe('isModelForbidden', () => {
    it('should return false for swarm mode (no forbidden models)', () => {
      assert.strictEqual(isModelForbidden('swarm', 'opus'), false);
      assert.strictEqual(isModelForbidden('swarm', 'sonnet'), false);
    });

    it('should return false for epic mode (no forbidden models)', () => {
      assert.strictEqual(isModelForbidden('epic', 'opus'), false);
    });

    it('should return false for unknown mode', () => {
      assert.strictEqual(isModelForbidden('unknown', 'opus'), false);
    });

    it('should return false for removed modes (treated as unknown)', () => {
      assert.strictEqual(isModelForbidden('eco', 'opus'), false);
      assert.strictEqual(isModelForbidden('turbo', 'opus'), false);
      assert.strictEqual(isModelForbidden('standard', 'opus'), false);
      assert.strictEqual(isModelForbidden('thorough', 'opus'), false);
    });
  });

  describe('getGateForAgent', () => {
    it('should return null for unknown agent type', () => {
      assert.strictEqual(getGateForAgent('workflow:unknown-agent'), null);
    });

    it('should return null for malformed agent type', () => {
      assert.strictEqual(getGateForAgent('invalid-format'), null);
    });

    it('should handle case-sensitive agent names correctly', () => {
      assert.strictEqual(getGateForAgent('workflow:Executor'), null);
      assert.strictEqual(getGateForAgent('workflow:executor'), 'implementation');
    });
  });

  describe('getPreferredModel', () => {
    it('should return sonnet for swarm mode', () => {
      assert.strictEqual(getPreferredModel('swarm'), 'sonnet');
    });

    it('should return sonnet for epic mode', () => {
      assert.strictEqual(getPreferredModel('epic'), 'sonnet');
    });

    it('should return sonnet as default for unknown mode', () => {
      assert.strictEqual(getPreferredModel('unknown'), 'sonnet');
    });

    it('should return sonnet as default for removed modes', () => {
      assert.strictEqual(getPreferredModel('eco'), 'sonnet');
      assert.strictEqual(getPreferredModel('turbo'), 'sonnet');
      assert.strictEqual(getPreferredModel('standard'), 'sonnet');
      assert.strictEqual(getPreferredModel('thorough'), 'sonnet');
    });
  });
});

describe('Module Exports', () => {
  it('should export MODEL_CONSTRAINTS', () => {
    assert.ok(MODEL_CONSTRAINTS);
    assert.strictEqual(typeof MODEL_CONSTRAINTS, 'object');
  });

  it('should export AGENT_GATE_MAP', () => {
    assert.ok(AGENT_GATE_MAP);
    assert.strictEqual(typeof AGENT_GATE_MAP, 'object');
  });

  it('should export PHASE_ORDER', () => {
    assert.ok(PHASE_ORDER);
    assert.ok(Array.isArray(PHASE_ORDER));
  });

  it('should export E2E_PHASE_ORDER', () => {
    assert.ok(E2E_PHASE_ORDER);
    assert.ok(Array.isArray(E2E_PHASE_ORDER));
  });

  it('should export isModelForbidden function', () => {
    assert.strictEqual(typeof isModelForbidden, 'function');
  });

  it('should export getGateForAgent function', () => {
    assert.strictEqual(typeof getGateForAgent, 'function');
  });

  it('should export getPreferredModel function', () => {
    assert.strictEqual(typeof getPreferredModel, 'function');
  });
});

describe('Data Integrity', () => {
  it('should have all E2E agents in AGENT_GATE_MAP', () => {
    const e2eAgents = ['workflow:e2e-explorer', 'workflow:e2e-generator', 'workflow:e2e-reviewer'];
    e2eAgents.forEach(agent => {
      assert.ok(AGENT_GATE_MAP[agent], `${agent} should be in AGENT_GATE_MAP`);
    });
  });

  it('should have all E2E gates in E2E_PHASE_ORDER', () => {
    const e2eGates = ['e2e_exploration', 'e2e_generation', 'e2e_validation'];
    e2eGates.forEach(gate => {
      assert.ok(E2E_PHASE_ORDER.includes(gate), `${gate} should be in E2E_PHASE_ORDER`);
    });
  });

  it('should have unique phases in PHASE_ORDER', () => {
    const uniquePhases = new Set(PHASE_ORDER);
    assert.strictEqual(uniquePhases.size, PHASE_ORDER.length);
  });

  it('should have unique phases in E2E_PHASE_ORDER', () => {
    const uniquePhases = new Set(E2E_PHASE_ORDER);
    assert.strictEqual(uniquePhases.size, E2E_PHASE_ORDER.length);
  });

  it('should have no overlap between standard and E2E exclusive phases', () => {
    const standardExclusive = ['planning', 'implementation', 'code_review', 'security_review', 'tests'];
    const e2eExclusive = ['setup', 'e2e_exploration', 'e2e_generation', 'e2e_validation'];

    standardExclusive.forEach(phase => {
      assert.ok(!e2eExclusive.includes(phase), `${phase} should not be in E2E exclusive phases`);
    });
  });

  it('should share common final phases between workflows', () => {
    const commonPhases = ['quality_gate', 'completion_guard'];
    commonPhases.forEach(phase => {
      assert.ok(PHASE_ORDER.includes(phase), `${phase} should be in PHASE_ORDER`);
      assert.ok(E2E_PHASE_ORDER.includes(phase), `${phase} should be in E2E_PHASE_ORDER`);
    });
  });
});
