'use strict';

// Discovery only. Every database is generated under this process's temporary root.
const assert = require('node:assert/strict');
const process = require('node:process');
const console = require('node:console');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const { StringDecoder } = require('node:string_decoder');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout, clearTimeout } = require('node:timers');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const leaseMs = 15000;
const chunkBytes = 32768;
const segmentLimit = 262144;
const normalize = (s) => s.normalize('NFC').toLowerCase().replace(/\u0451/g, '\u0435').normalize('NFC');
const round = (n) => Math.round(n * 100) / 100;

function child() {
  let db;
  let observation;
  let offset = 0;
  const now = () => performance.now() + offset;
  const row = () => db.prepare('SELECT * FROM lease').get();
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  process.on('message', ({ id, command, file, owner, token, advance = 0 }) => {
    try {
      let result;
      if (command === 'open') {
        db = new DatabaseSync(file);
        db.exec('PRAGMA busy_timeout=80');
        result = true;
      } else if (command === 'observe') {
        observation = { ...row(), at: now() };
        result = observation;
      } else if (command === 'claim') {
        // Inject monotonic elapsed time, not a wall-clock deadline or a sleep guarantee.
        assert.ok(advance >= 0);
        offset += advance;
        result = transaction(() => {
          const current = row();
          if (!observation || current.generation !== observation.generation ||
            current.beat !== observation.beat || now() - observation.at < leaseMs) return null;
          assert.ok(Number.isSafeInteger(current.generation + 1));
          db.prepare('UPDATE lease SET generation=generation+1,beat=beat+1,owner=?').run(owner);
          return row().generation;
        });
      } else if (command === 'renew' || command === 'write' || command === 'hold') {
        db.exec('BEGIN IMMEDIATE');
        try {
          const current = row();
          assert.equal(current.generation, token, 'stale generation');
          assert.equal(current.owner, owner, 'stale owner');
          db.exec('UPDATE lease SET beat=beat+1');
          if (command !== 'renew') {
            db.prepare('INSERT INTO publication(owner,generation) VALUES (?,?)').run(owner, token);
            db.prepare('UPDATE progress SET generation=?').run(token);
          }
          if (command !== 'hold') db.exec('COMMIT');
          result = true;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      } else if (command === 'commit') { db.exec('COMMIT'); result = true; }
      else if (command === 'close') { db.close(); process.send({ id, result: true }, () => process.exit(0)); return; }
      else throw new Error('Unknown command');
      process.send({ id, result });
    } catch (error) { process.send({ id, error: error.message, code: error.errcode }); }
  });
}

// ASCII space is a normalization and default-lowercase context boundary. Never
// normalize arbitrary UTF-16 chunks: NFC and Greek final sigma cross boundaries.
function scan(read, tokens) {
  const decoder = new StringDecoder('utf8');
  const longest = Math.max(...tokens.map((t) => t.length));
  assert.ok(longest <= segmentLimit, 'query needs explicit resource-limit handling');
  const found = tokens.map(() => false);
  let pending = '';
  let tail = '';
  let bytes = 0;
  let peakPending = 0;
  let maxStepMs = 0;
  let peak = process.memoryUsage();
  const consume = (text) => {
    const combined = tail + normalize(text);
    tokens.forEach((token, i) => { found[i] ||= combined.includes(token); });
    tail = longest > 1 ? combined.slice(-(longest - 1)) : '';
  };
  for (let position = 1;; position += chunkBytes) {
    const start = performance.now();
    const data = read(position, chunkBytes);
    bytes += data.length;
    pending += decoder.write(data);
    if (data.length === 0) pending += decoder.end();
    peakPending = Math.max(peakPending, pending.length);
    const end = data.length === 0 ? pending.length : pending.lastIndexOf(' ') + 1;
    if (end) { consume(pending.slice(0, end)); pending = pending.slice(end); }
    const memory = process.memoryUsage();
    for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], memory[key]);
    maxStepMs = Math.max(maxStepMs, performance.now() - start);
    if (pending.length > segmentLimit) return { status: 'deferred-oversize-segment', bytes, peakPending, maxStepMs, peak };
    if (!data.length) break;
  }
  return { status: 'complete', bytes, found, peakPending, maxStepMs, peak };
}

async function main() {
  assert.equal(process.argv.length, 2, 'No external data paths accepted');
  assert.ok(process.versions.electron, 'Use bundled Code.exe runtime');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-fence-synthetic-'));
  const children = [];
  const connections = [];
  const report = { runtime: { node: process.versions.node, electron: process.versions.electron }, checks: [] };
  let serial = 0;
  async function start() {
    const instance = fork(require.resolve('./step3-writer-fence.cjs'), ['--synthetic-child'], {
      execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, silent: true,
    });
    children.push(instance);
    instance.stderr.on('data', () => {});
    const request = (command, args = {}) => new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => finish(new Error(`IPC deadline: ${command}`)), 10000);
      const finish = (error, value) => {
        clearTimeout(timer); instance.off('message', message); instance.off('exit', exited);
        if (error) reject(error); else resolve(value);
      };
      const message = (value) => { if (value.id === id) finish(null, value); };
      const exited = () => finish(new Error('Child exited during request'));
      instance.on('message', message); instance.once('exit', exited);
      instance.send({ id, command, ...args });
    });
    const opened = await request('open', { file: path.join(root, 'hub.sqlite') });
    assert.equal(opened.result, true);
    return { instance, request };
  }
  try {
    const hub = new DatabaseSync(path.join(root, 'hub.sqlite')); connections.push(hub);
    hub.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE lease(generation INTEGER NOT NULL,beat INTEGER NOT NULL,owner TEXT);
      INSERT INTO lease VALUES(0,0,NULL);
      CREATE TABLE publication(owner TEXT,generation INTEGER);
      CREATE TABLE progress(generation INTEGER); INSERT INTO progress VALUES(0);`);
    const a = await start(); const b = await start();
    await a.request('observe');
    assert.equal((await a.request('claim', { owner: 'a' })).result, null);
    const first = (await a.request('claim', { owner: 'a', advance: leaseMs })).result;
    assert.equal(first, 1);
    await b.request('observe');
    assert.equal((await a.request('renew', { owner: 'a', token: first })).result, true);
    assert.equal((await b.request('claim', { owner: 'b', advance: leaseMs })).result, null);
    report.checks.push('local observation waits; renewal invalidates expired observation');
    await b.request('observe');
    const second = (await b.request('claim', { owner: 'b', advance: leaseMs })).result;
    assert.equal(second, 2);
    for (const command of ['write', 'renew', 'hold']) {
      assert.match((await a.request(command, { owner: 'a', token: first })).error, /stale generation/);
    }
    assert.equal(hub.prepare('SELECT count(*) AS n FROM publication').get().n, 0);
    report.checks.push('takeover fences stale write, renewal and transaction');
    await a.request('observe');
    assert.equal((await b.request('hold', { owner: 'b', token: second })).result, true);
    const begin = performance.now();
    assert.equal((await a.request('claim', { owner: 'a', advance: leaseMs })).code, 5);
    report.busyMs = round(performance.now() - begin);
    assert.equal(hub.prepare('SELECT generation FROM progress').get().generation, 0);
    assert.equal((await b.request('commit')).result, true);
    assert.equal((await a.request('claim', { owner: 'a' })).result, null);
    report.checks.push('held IMMEDIATE lock blocks takeover even after lease expiry; cursor atomic');
    await a.request('observe');
    assert.equal((await b.request('hold', { owner: 'b', token: second })).result, true);
    const death = once(b.instance, 'exit'); b.instance.kill(); await death;
    assert.equal(hub.prepare('SELECT count(*) AS n FROM publication').get().n, 1);
    const third = (await a.request('claim', { owner: 'a', advance: leaseMs })).result;
    assert.equal(third, 3);
    assert.equal((await a.request('write', { owner: 'a', token: third })).result, true);
    assert.equal(hub.prepare('SELECT generation FROM progress').get().generation, third);
    report.checks.push('owner process killed with open transaction; rollback and successor commit');
    const c = await start();
    await a.request('observe'); await c.request('observe');
    const race = await Promise.all([
      a.request('claim', { owner: 'a', advance: leaseMs }),
      c.request('claim', { owner: 'c', advance: leaseMs }),
    ]);
    assert.equal(race.filter((value) => value.result === 4).length, 1);
    assert.ok(race.every((value) => value.result === 4 || value.result === null || value.code === 5));
    assert.equal(hub.prepare('SELECT generation FROM lease').get().generation, 4);
    report.checks.push('simultaneous claimants observing same epoch produce exactly one successor');
    const cExit = once(c.instance, 'exit');
    assert.equal((await c.request('close')).result, true); await cExit;

    const sourcePath = path.join(root, 'source.sqlite');
    const fixture = new DatabaseSync(sourcePath); connections.push(fixture);
    fixture.exec('PRAGMA journal_mode=WAL; CREATE TABLE part(id INTEGER PRIMARY KEY,payload BLOB)');
    const block = Buffer.from(('synthetic CAFE\u0301 \u039f\u03a3 \u0401\u0416\u0418\u041a \ud83d\ude80 abc\0def ').repeat(1024));
    fixture.prepare('INSERT INTO part VALUES(1,zeroblob(0))').run();
    const append = fixture.prepare('UPDATE part SET payload=CAST(payload || ? AS BLOB) WHERE id=1');
    // Fixture construction is intentionally excluded from scanner memory/latency budgets.
    for (let i = 0; i < 256; i++) append.run(block);
    append.run(Buffer.from(' finaltailmarker'));
    const reader = new DatabaseSync(sourcePath, { readOnly: true }); connections.push(reader);
    const hash = () => ['', '-wal'].map((s) => {
      const fd = fs.openSync(sourcePath + s, 'r');
      const digest = createHash('sha256');
      const buffer = Buffer.alloc(chunkBytes);
      try {
        for (;;) {
          const length = fs.readSync(fd, buffer, 0, buffer.length, null);
          if (!length) break;
          digest.update(buffer.subarray(0, length));
        }
        return digest.digest('hex');
      } finally { fs.closeSync(fd); }
    });
    const before = hash();
    assert.throws(() => reader.exec('UPDATE part SET payload=NULL'), /readonly/i);
    const select = reader.prepare('SELECT substr(payload,?,?) AS bytes FROM part WHERE id=1');
    const tokens = ['caf\u00e9', '\u03bf\u03c2', '\u0435\u0436\u0438\u043a', 'abc\0def', 'finaltailmarker', 'notpresent'];
    const started = performance.now();
    const baseline = process.memoryUsage();
    report.longText = scan((pos, count) => select.get(pos, count).bytes, tokens);
    report.longText.elapsedMs = round(performance.now() - started);
    report.longText.baseline = baseline;
    assert.equal(report.longText.status, 'complete');
    assert.deepEqual(report.longText.found, [true, true, true, true, true, false]);
    assert.equal(report.longText.bytes, block.length * 256 + Buffer.byteLength(' finaltailmarker'));
    assert.deepEqual(hash(), before);
    report.checks.push('source readOnly rejects writes; main/WAL unchanged; huge part tail and NUL found');
    let comparisons = 0;
    const samples = ['A\u030a B', '\u1100\u1161\u11a8 xyz', '\u039f\u03a3 \u039f\u03a3\u0391', '\u0130 \u0401\u0416\u0418\u041a', '\ud83d\ude80 abc\0def', 'e\u0301\u0323 tail'];
    for (const sample of samples) {
      const bytes = Buffer.from(sample);
      const expected = normalize(sample);
      const needles = [expected, expected.slice(1), 'absent'];
      for (let size = 1; size <= bytes.length; size++) {
        let offset = 0;
        const result = scan(() => { const next = bytes.subarray(offset, offset + size); offset += size; return next; }, needles);
        assert.deepEqual(result.found, needles.map((needle) => expected.includes(needle)));
        comparisons++;
      }
    }
    const longNeedle = 'b'.repeat(chunkBytes + 17);
    const boundaryBytes = Buffer.from('a'.repeat(chunkBytes - 3) + ' ' + longNeedle + ' tail');
    const boundary = scan((pos, count) => boundaryBytes.subarray(pos - 1, pos - 1 + count), [longNeedle, ' tail', 'absent']);
    assert.equal(boundary.status, 'complete');
    assert.deepEqual(boundary.found, [true, true, false]);
    comparisons++;
    const pathological = Buffer.from('a' + '\u0301'.repeat(segmentLimit + chunkBytes));
    const deferred = scan((pos, count) => pathological.subarray(pos - 1, pos - 1 + count), ['aaa']);
    assert.equal(deferred.status, 'deferred-oversize-segment');
    assert.equal(deferred.found, undefined, 'Partial scan must not publish a negative result');
    report.normalization = { comparisons, deferredStatus: deferred.status, peakPending: deferred.peakPending };
    report.checks.push('every UTF8 split agrees with whole-field normalization; oversized segment explicitly deferred');
    const exit = once(a.instance, 'exit');
    assert.equal((await a.request('close')).result, true); await exit;
    report.budgets = { leaseMs, busyTimeoutMs: 80, chunkBytes, segmentLimit };
  } finally {
    for (const instance of children) if (instance.exitCode === null && instance.signalCode === null) {
      const exit = once(instance, 'exit'); instance.kill(); await exit;
    }
    for (const db of connections.reverse()) db.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  report.cleanup = !fs.existsSync(root);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[2] === '--synthetic-child' && process.send) child();
else main().catch((error) => { console.error(error); process.exitCode = 1; });
