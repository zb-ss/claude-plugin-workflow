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

const { getAllDirectories, getStateDir, getActiveDir, getCompletedDir } = require('./paths');

// All required directories for workflow plugin
const WORKFLOW_DIRECTORIES = getAllDirectories();

// Legacy directories (for migration detection)
const LEGACY_WORKFLOWS_DIR = path.join(os.homedir(), '.claude', 'workflows');
const LEGACY_ACTIVE_DIR = path.join(LEGACY_WORKFLOWS_DIR, 'active');

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

/**
 * Migrate active workflow files from legacy ~/.claude/workflows/ to new location.
 * Copies files (does not delete originals) for safety.
 * Returns { migrated: number, skipped: number, errors: string[] }
 */
function migrateFromLegacy() {
  const results = { migrated: 0, skipped: 0, errors: [] };

  if (!fs.existsSync(LEGACY_ACTIVE_DIR)) return results;

  const newActiveDir = getActiveDir();
  ensureDir(newActiveDir);

  try {
    const files = fs.readdirSync(LEGACY_ACTIVE_DIR)
      .filter(f => f.endsWith('.state.json') || f.endsWith('.org') || f.endsWith('.md'));

    for (const file of files) {
      const src = path.join(LEGACY_ACTIVE_DIR, file);
      const dest = path.join(newActiveDir, file);

      if (fs.existsSync(dest)) {
        results.skipped++;
        continue;
      }

      try {
        fs.copyFileSync(src, dest);
        results.migrated++;
      } catch (err) {
        results.errors.push(`${file}: ${err.message}`);
      }
    }
  } catch (err) {
    results.errors.push(`readdir: ${err.message}`);
  }

  // Migrate context, memory, and completed files too
  for (const subdir of ['context', 'memory', 'completed']) {
    const legacySub = path.join(LEGACY_WORKFLOWS_DIR, subdir);
    const newSub = path.join(getStateDir(), subdir);

    if (!fs.existsSync(legacySub)) continue;
    ensureDir(newSub);

    try {
      const files = fs.readdirSync(legacySub).filter(f => f !== '.gitkeep');
      for (const file of files) {
        const src = path.join(legacySub, file);
        const dest = path.join(newSub, file);
        if (!fs.existsSync(dest)) {
          try {
            fs.copyFileSync(src, dest);
            results.migrated++;
          } catch (err) {
            results.errors.push(`${subdir}/${file}: ${err.message}`);
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  // Migrate plans (sibling of workflows, not a child)
  const legacyPlansDir = path.join(os.homedir(), '.claude', 'plans');
  if (fs.existsSync(legacyPlansDir)) {
    const newPlansDir = getPlansDir();
    ensureDir(newPlansDir);
    try {
      const files = fs.readdirSync(legacyPlansDir).filter(f => f !== '.gitkeep');
      for (const file of files) {
        const src = path.join(legacyPlansDir, file);
        const dest = path.join(newPlansDir, file);
        if (!fs.existsSync(dest)) {
          try {
            fs.copyFileSync(src, dest);
            results.migrated++;
          } catch (err) {
            results.errors.push(`plans/${file}: ${err.message}`);
          }
        }
      }
    } catch {
      // Skip unreadable directory
    }
  }

  return results;
}

// Export for use as module
module.exports = {
  WORKFLOW_DIRECTORIES,
  LEGACY_WORKFLOWS_DIR,
  LEGACY_ACTIVE_DIR,
  ensureDir,
  ensureGitkeep,
  initializeWorkflowDirectories,
  checkDirectories,
  migrateFromLegacy,
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
