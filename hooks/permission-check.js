#!/usr/bin/env node
/**
 * Workflow permission check hook (cross-platform, security-hardened)
 * Called by PreToolUse hook for Bash commands
 * Blocks dangerous commands, allows workflow operations
 *
 * Security fixes applied:
 * - CRITICAL-2: Detect command chaining and shell metacharacters
 * - HIGH-2: Restrict safe commands to specific subcommands
 * - MEDIUM-1: Input size limit
 * - MEDIUM-3: Expanded dangerous pattern list
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// SECURITY FIX (MEDIUM-1): Limit input size
const MAX_INPUT_SIZE = 1024 * 1024; // 1MB

// Read hook input from stdin with size limit
let input = '';
let inputSize = 0;

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  inputSize += chunk.length;
  if (inputSize > MAX_INPUT_SIZE) {
    console.error('Security: Input too large');
    process.exit(0);
  }
  input += chunk;
});

process.stdin.on('end', () => {
  try {
    processHook(input);
  } catch (err) {
    // On error, let Claude Code's normal permission system handle it
    process.exit(0);
  }
});

function processHook(rawInput) {
  let hookData;
  try {
    hookData = JSON.parse(rawInput);
  } catch {
    process.exit(0);
  }

  const command = hookData?.tool_input?.command || '';
  if (!command || typeof command !== 'string') {
    process.exit(0);
  }

  // SECURITY FIX (CRITICAL-2): Detect shell metacharacters that enable command chaining
  if (containsShellMetacharacters(command)) {
    // Command contains chaining operators - apply stricter checking
    if (containsBlockedPatternAnywhere(command)) {
      outputDecision('deny', 'Blocked: Command contains dangerous patterns with shell operators');
      return;
    }
    // Let Claude Code's normal permission system handle complex commands
    process.exit(0);
  }

  // Check blocked patterns (for simple commands)
  if (isBlockedCommand(command)) {
    outputDecision('deny', 'Blocked: This command requires manual execution');
    return;
  }

  // Check if it's a safe command
  if (isSafeCommand(command)) {
    outputDecision('allow', 'Auto-approved safe command');
    return;
  }

  // For all other commands, let Claude Code's normal permission system handle it
  process.exit(0);
}

/**
 * SECURITY FIX (CRITICAL-2): Detect shell metacharacters that enable command chaining
 */
function containsShellMetacharacters(command) {
  // Shell operators that enable command chaining or injection
  const shellMetacharacters = [
    ';',      // Command separator
    '&&',     // AND operator
    '||',     // OR operator
    '|',      // Pipe
    '$(',     // Command substitution
    '`',      // Backtick command substitution
    '${{',    // Parameter expansion (some shells)
    '\n',     // Newline (command separator)
    '\r',     // Carriage return
  ];

  return shellMetacharacters.some(char => command.includes(char));
}

/**
 * Check if command contains any blocked pattern (for chained commands)
 */
function containsBlockedPatternAnywhere(command) {
  const lowerCommand = command.toLowerCase();

  // Dangerous commands that should never appear in any part of the command
  const dangerousPatterns = [
    // Git dangerous operations
    'git push',
    'git reset --hard',
    'git clean -fd',
    'push --force',
    'push -f',
    // Destructive file operations
    'rm -rf',
    'rm -fr',
    'rmdir /s',
    'del /f',
    'del /s',
    'format ',
    // System modification
    'mkfs',
    'dd if=',
    '> /dev/',
    'chmod 777',
    'chmod -R 777',
    'chown ',
    'chgrp ',
    // Remote execution
    'curl | sh',
    'curl |sh',
    'wget | sh',
    'wget |sh',
    'curl | bash',
    'wget | bash',
    // Privilege escalation
    'sudo ',
    'su -',
    'doas ',
    // Cron/scheduled tasks
    'crontab',
    'at ',
    'schtasks',
    // Network tools (potential reverse shells)
    'nc -',
    'netcat',
    'ncat',
    // Encoded execution
    'base64 -d',
    'base64 --decode',
    'eval ',
    'exec ',
    // Fork bombs and resource exhaustion
    ':(){',
    ':()',
  ];

  return dangerousPatterns.some(pattern => lowerCommand.includes(pattern));
}

/**
 * Check if command is explicitly blocked
 */
function isBlockedCommand(command) {
  const lowerCommand = command.toLowerCase().trim();

  // Commands blocked at the start
  const blockedPrefixes = [
    'git push',
    'git reset --hard',
    'git clean',
    'sudo rm',
    'sudo ',
    'rm -rf',
    'rm -fr',
  ];

  return blockedPrefixes.some(prefix => lowerCommand.startsWith(prefix));
}

/**
 * SECURITY FIX (HIGH-2): More restrictive safe command list
 * Only allow specific subcommands, not broad command families
 */
function isSafeCommand(command) {
  const trimmedCommand = command.trim();

  // Exact safe commands (read-only operations)
  const exactSafeCommands = [
    'git status',
    'git diff',
    'git log',
    'git branch',
    'git branch -a',
    'git branch -r',
    'git remote -v',
    'git stash list',
    'git worktree list',
    'pwd',
    'whoami',
    'date',
    'uname',
    'uname -a',
    'node --version',
    'npm --version',
    'python --version',
    'python3 --version',
    'php --version',
    'git --version',
  ];

  if (exactSafeCommands.includes(trimmedCommand)) {
    return true;
  }

  // Safe command prefixes with restricted patterns
  const safePrefixes = [
    // Git read operations
    { prefix: 'git log ', allow: true },
    { prefix: 'git diff ', allow: true },
    { prefix: 'git show ', allow: true },
    { prefix: 'git status ', allow: true },
    { prefix: 'git branch ', deny: ['-d', '-D', '--delete', '-m', '-M', '--move'] },

    // Git write operations (safe)
    { prefix: 'git add ', allow: true },
    { prefix: 'git stash', allow: true },
    { prefix: 'git checkout -b ', allow: true },
    { prefix: 'git switch -c ', allow: true },
    { prefix: 'git commit ', allow: true },  // Commits are reviewed by user anyway
    { prefix: 'git worktree add ', allow: true },

    // File listing (read-only)
    { prefix: 'ls ', allow: true },
    { prefix: 'ls', exact: true, allow: true },
    { prefix: 'dir ', allow: true },
    { prefix: 'dir', exact: true, allow: true },
    { prefix: 'find ', deny: ['-exec', '-delete', '-ok'] },
    { prefix: 'cat ', allow: true },
    { prefix: 'head ', allow: true },
    { prefix: 'tail ', allow: true },
    { prefix: 'wc ', allow: true },
    { prefix: 'grep ', allow: true },
    { prefix: 'which ', allow: true },
    { prefix: 'where ', allow: true },
    { prefix: 'type ', allow: true },
    { prefix: 'file ', allow: true },
    { prefix: 'stat ', allow: true },

    // Safe file operations (within project)
    { prefix: 'mkdir ', deny: ['/etc', '/usr', '/bin', '/var', '/root', 'C:\\Windows', 'C:\\Program'] },
    { prefix: 'touch ', deny: ['/etc', '/usr', '/bin', '/var', '/root'] },

    // Build/test commands (specific subcommands only)
    { prefix: 'npm run ', allow: true },
    { prefix: 'npm test', allow: true },
    { prefix: 'npm install', deny: ['-g', '--global'] },  // Allow local install only
    { prefix: 'npm ci', allow: true },
    { prefix: 'npm audit', allow: true },
    { prefix: 'yarn test', allow: true },
    { prefix: 'yarn install', allow: true },
    { prefix: 'yarn run ', allow: true },
    { prefix: 'pnpm test', allow: true },
    { prefix: 'pnpm install', allow: true },
    { prefix: 'pnpm run ', allow: true },
    { prefix: 'composer install', allow: true },
    { prefix: 'composer update', allow: true },
    { prefix: 'composer dump-autoload', allow: true },
    { prefix: 'cargo build', allow: true },
    { prefix: 'cargo test', allow: true },
    { prefix: 'cargo check', allow: true },
    { prefix: 'go build', allow: true },
    { prefix: 'go test', allow: true },
    { prefix: 'go mod ', allow: true },

    // Linting/validation
    { prefix: 'npx tsc', allow: true },
    { prefix: 'npx eslint', allow: true },
    { prefix: 'npx prettier', allow: true },
    { prefix: 'php -l ', allow: true },
    { prefix: 'python -m py_compile', allow: true },
    { prefix: 'python3 -m py_compile', allow: true },
    { prefix: 'python -m pytest', allow: true },
    { prefix: 'python3 -m pytest', allow: true },
    { prefix: 'phpunit', allow: true },
    { prefix: 'pytest', allow: true },

    // Test commands
    { prefix: 'test ', allow: true },
    { prefix: '[ ', allow: true },
  ];

  for (const rule of safePrefixes) {
    if (rule.exact && trimmedCommand === rule.prefix) {
      return true;
    }

    if (trimmedCommand.startsWith(rule.prefix)) {
      // Check for denied patterns
      if (rule.deny) {
        const hasDenied = rule.deny.some(denied =>
          trimmedCommand.toLowerCase().includes(denied.toLowerCase())
        );
        if (hasDenied) {
          return false;
        }
      }
      if (rule.allow) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if we're in an active workflow
 */
function checkActiveWorkflow() {
  const homeDir = os.homedir();
  const workflowDir = path.join(homeDir, '.claude', 'workflows', 'active');

  try {
    if (!fs.existsSync(workflowDir)) {
      return false;
    }

    const files = fs.readdirSync(workflowDir)
      .filter(f => f.endsWith('.org'))
      .map(f => {
        const fullPath = path.join(workflowDir, f);
        try {
          const stat = fs.statSync(fullPath);
          return { path: fullPath, mtime: stat.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(f => f !== null)
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      return false;
    }

    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    return files[0].mtime > thirtyMinutesAgo;
  } catch {
    return false;
  }
}

/**
 * Output hook decision
 */
function outputDecision(decision, reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason
    }
  };
  console.log(JSON.stringify(output));
  process.exit(0);
}
