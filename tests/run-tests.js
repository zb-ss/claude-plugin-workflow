#!/usr/bin/env node

/**
 * Test runner for E2E workflow tests
 * Uses Node.js built-in test runner (node:test)
 */

const { run } = require('node:test');
const { spec } = require('node:test/reporters');
const path = require('node:path');
const fs = require('node:fs');

const testDir = __dirname;
const testFiles = fs.readdirSync(testDir)
  .filter(file => file.endsWith('.test.js'))
  .map(file => path.join(testDir, file));

console.log('Running E2E Workflow Tests\n');
console.log('Test files:');
testFiles.forEach(file => console.log(`  - ${path.basename(file)}`));
console.log('');

const stream = run({ files: testFiles });

// The reporter only prints; without this the runner exits 0 when tests fail.
stream.on('test:fail', () => {
  process.exitCode = 1;
});

stream.compose(spec).pipe(process.stdout);
