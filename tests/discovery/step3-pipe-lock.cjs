'use strict';
const assert = require('node:assert/strict');
const process = require('node:process');
const console = require('node:console');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { setTimeout, clearTimeout } = require('node:timers');

assert.equal(process.platform, 'win32');
const pipe = `\\\\.\\pipe\\hub-discovery-${randomUUID()}`;
const bind = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(pipe, () => { server.removeListener('error', reject); resolve(); });
});
async function main() {
  const child = spawn(process.execPath, ['-e', `
    const net = require('node:net');
    net.createServer(socket => socket.end()).listen(process.argv[1], () => process.stdout.write('ready\\n'));
  `, pipe], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  child.once('exit', () => { exited = true; });
  const contender = net.createServer();
  const successor = net.createServer();
  const secondContender = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('child pipe startup deadline')), 10000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('child exited before ready')); });
      child.stdout.once('data', (data) => { clearTimeout(timer); assert.match(data.toString(), /ready/); resolve(); });
    });
    await assert.rejects(bind(contender), (error) => error.code === 'EADDRINUSE');
    const ended = once(child, 'exit');
    child.kill();
    await ended;
    await bind(successor);
    await assert.rejects(bind(secondContender), (error) => error.code === 'EADDRINUSE');
    console.log(JSON.stringify({ checks: 3, node: process.versions.node, electron: process.versions.electron,
      result: 'exclusive pipe bind; owner process death releases ownership; successor excludes competitor',
      limits: 'local Windows IPC only; not coordinator corruption recovery implementation or malicious ACL defense' }));
  } finally {
    for (const server of [contender, successor, secondContender]) {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
    if (!exited) { const ended = once(child, 'exit'); child.kill(); await ended; }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
