#!/usr/bin/env node
/**
 * File validation hook (cross-platform, security-hardened)
 * Called by PostToolUse hook after Edit/Write operations
 * Validates syntax for TypeScript, PHP, Python, and JSON files
 *
 * Security fixes applied:
 * - CRITICAL-1: JSON validation no longer uses string interpolation
 * - HIGH-1: Path validation prevents traversal attacks
 * - HIGH-3: Avoid shell: true, use proper argument escaping
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Get file path from environment variable
const filePath = process.env.CLAUDE_FILE_PATH;

if (!filePath) {
  process.exit(0);
}

// Security: Validate and sanitize file path
const validatedPath = validateFilePath(filePath);
if (!validatedPath) {
  console.error('Security: Invalid file path rejected');
  process.exit(0);
}

const ext = path.extname(validatedPath).toLowerCase();

// Run appropriate validation
switch (ext) {
  case '.ts':
  case '.tsx':
    runExternalValidator('npx', ['tsc', '--noEmit', '--skipLibCheck'], validatedPath);
    break;
  case '.php':
    runExternalValidator('php', ['-l', validatedPath], validatedPath);
    break;
  case '.py':
    const pythonCmd = getPythonCommand();
    runExternalValidator(pythonCmd, ['-m', 'py_compile', validatedPath], validatedPath);
    break;
  case '.json':
    // SECURITY FIX (CRITICAL-1): Validate JSON directly in Node.js, no shell execution
    validateJsonFile(validatedPath);
    break;
  default:
    process.exit(0);
}

/**
 * Security: Validate file path to prevent traversal attacks
 */
function validateFilePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }

  // Reject obviously malicious patterns
  const dangerousPatterns = [
    /\.\.[\/\\]/,           // Path traversal
    /[<>|"'`$(){}]/,        // Shell metacharacters
    /\0/,                   // Null bytes
    /^[\/\\]{2}/,           // UNC paths (\\server\share)
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(inputPath)) {
      return null;
    }
  }

  try {
    // Resolve to absolute path
    const resolved = path.resolve(inputPath);

    // Get allowed directories
    const cwd = process.cwd();
    const tmpDir = os.tmpdir();
    const homeDir = os.homedir();

    // Allowed paths: current working directory, temp, or under home/.claude
    const allowedRoots = [
      path.resolve(cwd),
      path.resolve(tmpDir),
      path.resolve(path.join(homeDir, '.claude')),
    ];

    // Check if path is under an allowed root
    const isAllowed = allowedRoots.some(root => {
      const normalizedRoot = root.endsWith(path.sep) ? root : root + path.sep;
      return resolved === root || resolved.startsWith(normalizedRoot);
    });

    if (!isAllowed) {
      // Also allow if it's directly in cwd (for files like package.json)
      if (path.dirname(resolved) === path.resolve(cwd)) {
        return resolved;
      }
      return null;
    }

    return resolved;
  } catch {
    return null;
  }
}

/**
 * Get Python command (python3 or python)
 */
function getPythonCommand() {
  if (commandExists('python3')) {
    return 'python3';
  }
  return 'python';
}

/**
 * Check if a command exists
 */
function commandExists(cmd) {
  try {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? 'where' : 'which';
    const result = spawnSync(checkCmd, [cmd], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      // SECURITY FIX (HIGH-3): Don't use shell: true
      shell: false,
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * SECURITY FIX (CRITICAL-1): Validate JSON directly without shell execution
 */
function validateJsonFile(file) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    JSON.parse(content);
    // Valid JSON, exit silently
  } catch (err) {
    const fileName = path.basename(file);
    if (err instanceof SyntaxError) {
      console.error(`JSON validation error in ${fileName}: ${err.message}`);
    }
  }
  process.exit(0);
}

/**
 * Run external validator command
 */
function runExternalValidator(cmd, args, file) {
  // Check if command exists
  if (!commandExists(cmd === 'npx' ? 'npm' : cmd)) {
    process.exit(0);
  }

  const fileName = path.basename(file);
  const isWindows = process.platform === 'win32';

  // SECURITY FIX (HIGH-3): Avoid shell: true
  // Use shell: false and pass arguments as array
  const proc = spawn(cmd, args, {
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: path.dirname(file) || process.cwd(),
    shell: false,  // SECURITY: Never use shell
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', data => {
    stdout += data.toString();
  });

  proc.stderr.on('data', data => {
    stderr += data.toString();
  });

  // Set up timeout with cleanup
  const timeoutId = setTimeout(() => {
    proc.kill('SIGKILL');
    process.exit(0);
  }, 15000);

  proc.on('close', code => {
    clearTimeout(timeoutId);

    const output = (stdout + stderr).trim();

    if (code !== 0 && output) {
      // Filter output to show only relevant lines
      const relevantLines = output
        .split('\n')
        .filter(line =>
          line.includes(fileName) ||
          line.toLowerCase().includes('error') ||
          line.toLowerCase().includes('syntax')
        )
        .slice(0, 5)
        .join('\n');

      if (relevantLines) {
        console.error(`Validation errors in ${fileName}:\n${relevantLines}`);
      }
    }

    process.exit(0);
  });

  proc.on('error', () => {
    clearTimeout(timeoutId);
    process.exit(0);
  });
}
