#!/usr/bin/env node
/**
 * Workflow directory initialization script
 * Creates all required directories for workflow plugin operation.
 *
 * This script is idempotent - safe to run multiple times.
 * Uses Node.js fs module to avoid shell permission prompts.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = os.homedir();

// All required directories for workflow plugin
const WORKFLOW_DIRECTORIES = [
  path.join(homeDir, '.claude', 'workflows'),
  path.join(homeDir, '.claude', 'workflows', 'active'),
  path.join(homeDir, '.claude', 'workflows', 'completed'),
  path.join(homeDir, '.claude', 'workflows', 'context'),
  path.join(homeDir, '.claude', 'workflows', 'memory'),
  path.join(homeDir, '.claude', 'plans'),
  path.join(homeDir, '.claude', 'skills'),
  path.join(homeDir, '.claude', 'skills', 'learned'),
];

/**
 * Ensure a directory exists (creates recursively if needed)
 */
function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
      return { path: dirPath, status: 'created' };
    }
    return { path: dirPath, status: 'exists' };
  } catch (err) {
    return { path: dirPath, status: 'error', error: err.message };
  }
}

/**
 * Create .gitkeep file in a directory if empty
 */
function ensureGitkeep(dirPath) {
  const gitkeepPath = path.join(dirPath, '.gitkeep');
  try {
    const files = fs.readdirSync(dirPath);
    if (files.length === 0) {
      fs.writeFileSync(gitkeepPath, '');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Initialize all workflow directories
 */
function initializeWorkflowDirectories() {
  const results = {
    success: true,
    directories: [],
    errors: [],
  };

  for (const dir of WORKFLOW_DIRECTORIES) {
    const result = ensureDir(dir);
    results.directories.push(result);

    if (result.status === 'error') {
      results.success = false;
      results.errors.push(result);
    } else if (result.status === 'created') {
      // Add .gitkeep to new directories
      ensureGitkeep(dir);
    }
  }

  return results;
}

/**
 * Check if all directories exist (no creation)
 */
function checkDirectories() {
  const missing = [];
  for (const dir of WORKFLOW_DIRECTORIES) {
    if (!fs.existsSync(dir)) {
      missing.push(dir);
    }
  }
  return {
    allExist: missing.length === 0,
    missing,
  };
}

// Export for use as module
module.exports = {
  WORKFLOW_DIRECTORIES,
  ensureDir,
  ensureGitkeep,
  initializeWorkflowDirectories,
  checkDirectories,
};

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--check')) {
    // Check mode - only report status
    const status = checkDirectories();
    if (status.allExist) {
      console.log(JSON.stringify({ status: 'ok', message: 'All directories exist' }));
      process.exit(0);
    } else {
      console.log(JSON.stringify({
        status: 'missing',
        missing: status.missing,
      }));
      process.exit(1);
    }
  } else {
    // Initialize mode - create directories
    const results = initializeWorkflowDirectories();

    if (args.includes('--json')) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log('Workflow Directory Initialization');
      console.log('==================================');
      for (const dir of results.directories) {
        const icon = dir.status === 'created' ? '✓' : dir.status === 'exists' ? '·' : '✗';
        console.log(`${icon} ${dir.path} (${dir.status})`);
      }
      if (results.errors.length > 0) {
        console.log('\nErrors:');
        for (const err of results.errors) {
          console.log(`  ${err.path}: ${err.error}`);
        }
      }
    }

    process.exit(results.success ? 0 : 1);
  }
}
