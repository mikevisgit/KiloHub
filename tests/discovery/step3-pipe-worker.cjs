'use strict';
const assert = require('node:assert/strict');
const console = require('node:console');
const process = require('node:process');
const { Worker } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
assert.equal(process.platform, 'win32');
const pipe = `\\\\.\\pipe\\hub-worker-discovery-${randomUUID()}`;
const code = `
  const {parentPort,workerData} = require('node:worker_threads');
  const server = require('node:net').createServer(socket => socket.end());
  server.once('error', error => { parentPort.postMessage({bound:false,code:error.code}); parentPort.close(); });
  server.listen(workerData, () => parentPort.postMessage({bound:true}));
`;
const workers = [];
async function start() {
  const worker = new Worker(code, { eval: true, workerData: pipe });
  workers.push(worker);
  const [result] = await once(worker, 'message', { signal: globalThis.AbortSignal.timeout(10000) });
  return { worker, result };
}
async function main() {
  try {
    const first = await start();
    assert.deepEqual(first.result, { bound: true });
    const contender = await start();
    assert.deepEqual(contender.result, { bound: false, code: 'EADDRINUSE' });
    await first.worker.terminate();
    const successor = await start();
    assert.deepEqual(successor.result, { bound: true });
    const competitor = await start();
    assert.deepEqual(competitor.result, { bound: false, code: 'EADDRINUSE' });
    console.log(JSON.stringify({ checks: 4, node: process.versions.node,
      result: 'same-process workers share exclusive OS pipe; termination releases ownership',
      limits: 'no production service/recovery or native SQLite interruption proof' }));
  } finally { await Promise.all(workers.map((worker) => worker.terminate())); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
