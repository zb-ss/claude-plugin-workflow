/**
 * Preload for tests/statusline.test.js (node --require). Not a test.
 *
 * Records every credential read, network attempt and shell exec made by the
 * status line process, then writes the event list as JSON to
 * STATUSLINE_PROBE_LOG on exit. An empty list proves the default path is
 * pure; a stubbed fetch lets the opt-in path run without the network.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const child_process = require('node:child_process');
const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const { fileURLToPath } = require('node:url');

const events = [];
const original_write_file_sync = fs.writeFileSync;

function isCredentialPath(file) {
  let text = null;
  if (typeof file === 'string') text = file;
  else if (Buffer.isBuffer(file)) text = file.toString();
  else if (file instanceof URL) {
    try { text = fileURLToPath(file); } catch { text = String(file); }
  }
  return text !== null && text.includes('.credentials.json');
}

// Wrap fs functions whose first argument is a path; the original still runs.
function wrapFsPathReader(owner, name) {
  const original = owner[name];
  if (typeof original !== 'function') return;
  owner[name] = function probedFsRead(file, ...rest) {
    if (isCredentialPath(file)) events.push('credentials-read');
    return original.call(this, file, ...rest);
  };
}

for (const name of ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream']) {
  wrapFsPathReader(fs, name);
}
for (const name of ['readFile', 'open']) wrapFsPathReader(fs.promises, name);

// Anything that can run a process or reach the network is blocked and logged.
function blocked(event, owner, name) {
  if (typeof owner[name] !== 'function') return;
  owner[name] = function probedBlocked() {
    events.push(event);
    throw new Error(`probe: ${name} blocked`);
  };
}

for (const name of ['execSync', 'execFileSync', 'spawnSync']) blocked('exec-sync', child_process, name);
for (const name of ['exec', 'execFile', 'spawn', 'fork']) blocked('exec-async', child_process, name);
for (const transport of [https, http]) {
  blocked('http-request', transport, 'request');
  blocked('http-request', transport, 'get');
}
blocked('net-connect', net, 'connect');
blocked('net-connect', net, 'createConnection');
blocked('net-connect', tls, 'connect');
blocked('dns-lookup', dns, 'lookup');

globalThis.fetch = async function probedFetch() {
  events.push('fetch');
  return {
    ok: true,
    json: async () => JSON.parse(process.env.STATUSLINE_PROBE_FETCH_BODY || '{}'),
  };
};

process.on('exit', () => {
  const oauth_suffix = path.join('statusline', 'oauth-usage.js');
  if (Object.keys(require.cache).some((key) => key.endsWith(oauth_suffix))) {
    events.push('oauth-module-loaded');
  }
  if (process.env.STATUSLINE_PROBE_LOG) {
    original_write_file_sync(process.env.STATUSLINE_PROBE_LOG, JSON.stringify(events));
  }
});
