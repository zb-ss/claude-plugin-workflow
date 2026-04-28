#!/usr/bin/env node
/**
 * CLI: prints the repo-key for a given directory (default: cwd).
 * Usage: node lib/repo-key-cli.js [cwd]
 */
'use strict';
const { getRepoKey } = require('./repo-key');
process.stdout.write(getRepoKey(process.argv[2]) + '\n');
