'use strict';

// Synthetic discovery only; no external source paths or production imports.
const assert = require('node:assert/strict');
const process = require('node:process');
const console = require('node:console');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const { fork } = require('node:child_process');
const { setTimeout, clearTimeout } = require('node:timers');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');

const normalize = (s) => s.normalize('NFC').toLowerCase().replace(/\u0451/g, '\u0435').normalize('NFC');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const round = (n) => Math.round(n * 100) / 100;
const memory = () => ({ ...process.memoryUsage(), maxRssKiB: process.resourceUsage().maxRSS });
const smallText = (id) => `Synthetic user ${id} CAFE\u0301 \u0401\u0416\u0418\u041a escaped\0nul ${'ordinary code const value = 42; '.repeat(4)}tail${id}`;
const needles = ['caf\u00e9', '\u0435\u0436\u0438\u043a', 'abc\0def', '\ud83d\ude80', 'finaltailmarker', 'notpresent', '\u03bf\u03c3', '\u03bf\u03c2'];
const quote = (s) => JSON.stringify(s).slice(1, -1).replace(/[\u007f-\uffff]/g,
  (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const jsonText = (escaped) => `{"type":"text","text":"${escaped}","synthetic":false,"ignored":false}`;
const projection = `FROM part p JOIN message m ON m.id=p.message_id AND m.session_id=p.session_id
  JOIN session s ON s.id=p.session_id
  WHERE s.parent_id IS NULL AND s.time_archived IS NULL
    AND json_extract(m.data,'$.role')='user' AND json_extract(p.data,'$.type')='text'
    AND json_type(p.data,'$.text')='text'
    AND coalesce(json_extract(p.data,'$.synthetic'),0)!=1
    AND coalesce(json_extract(p.data,'$.ignored'),0)!=1`;

function build(root) {
  const db = new DatabaseSync(path.join(root, 'source.sqlite'));
  const rows = [];
  try {
    db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE session(id INTEGER PRIMARY KEY,parent_id INTEGER,time_archived INTEGER,directory TEXT);
      CREATE TABLE message(id INTEGER PRIMARY KEY,session_id INTEGER,data TEXT);
      CREATE TABLE part(id INTEGER PRIMARY KEY,message_id INTEGER,session_id INTEGER,data TEXT);
      CREATE TABLE marker(revision INTEGER); INSERT INTO marker VALUES(0);`);
    const session = db.prepare('INSERT INTO session VALUES(?,NULL,NULL,?)');
    const message = db.prepare('INSERT INTO message VALUES(?,?,?)');
    const part = db.prepare('INSERT INTO part VALUES(?,?,?,?)');
    const corpusDigest = createHash('sha256');
    db.exec('BEGIN');
    for (let id = 1; id <= 10000; id++) {
      session.run(id, `C:/synthetic/folder${Math.floor((id - 1) / 10)}`);
      message.run(id, id, '{"role":"user"}');
    }
    for (let id = 1; id <= 100000; id++) {
      const msg = Math.floor((id - 1) / 10) + 1;
      const text = smallText(id);
      part.run(id, msg, msg, jsonText(quote(text)));
      corpusDigest.update(`${id}\0`).update(normalize(text));
    }
    db.exec('COMMIT');
    const block = 'Synthetic CAFE\u0301 \u039f\u03a3 \u0401\u0416\u0418\u041a \ud83d\ude80 abc\0def quote" slash\\ newline\n ';
    const encodedBlock = quote(block);
    function add(id, kind, data) {
      // Independent whole JSON.parse + whole normalization oracle, construction process only.
      const text = JSON.parse(data).text;
      const normalized = normalize(text);
      rows.push({ id, kind, jsonBytes: Buffer.byteLength(data), textBytes: Buffer.byteLength(text),
        jsonPrefixHash: sha(Buffer.from(data).subarray(0, 32768)),
        utf16Units: text.length, rawHash: sha(text), normalizedHash: sha(normalized),
        firstNulPrefixHash: text.includes('\0') ? sha(text.slice(0, text.indexOf('\0'))) : null,
        firstNulPrefixBytes: text.includes('\0') ? Buffer.byteLength(text.slice(0, text.indexOf('\0'))) : null,
        normalizedBytes: Buffer.byteLength(normalized), found: needles.map((n) => normalized.includes(n)) });
      part.run(id, 1, 1, data);
    }
    for (const [id, size] of [[100001, 1], [100002, 4], [100003, 12]]) {
      const repeat = Math.ceil(size * 1024 * 1024 / Buffer.byteLength(block));
      add(id, `ordinary-${size}MiB`, jsonText(encodedBlock.repeat(repeat) + quote(' finaltailmarker')));
    }
    add(100004, 'no-space-combining-context', jsonText(quote('\u039f\u03a3' + '\u0315'.repeat(300000) + '\u0300\u0391finaltailmarker')));
    add(100005, 'no-space-12MiB', jsonText('X'.repeat(12 * 1024 * 1024) + 'finaltailmarker'));
    assert.equal(db.prepare('SELECT count(*) AS n FROM part').get().n, 100005);
    return { rows, corpusHash: corpusDigest.digest('hex'), folders: 1000, sessions: 10000, ordinaryParts: 100000 };
  } finally { db.close(); }
}

function probe({ root, mode, id, chunkBytes = 262144 }) {
  const reader = new DatabaseSync(path.join(root, 'source.sqlite'), { readOnly: true });
  const stats = { mode, id, chunkBytes, baseline: memory(), peakSampled: memory() };
  const sample = () => {
    const current = memory();
    for (const key of Object.keys(current)) stats.peakSampled[key] = Math.max(stats.peakSampled[key], current[key]);
  };
  const started = performance.now();
  try {
    reader.exec('PRAGMA query_only=ON; PRAGMA cache_size=-2048; BEGIN');
    assert.throws(() => reader.exec('UPDATE marker SET revision=2'), /readonly/i);
    if (mode === 'raw-slice' || mode === 'metadata') {
      const began = performance.now();
      stats.jsonBytes = reader.prepare('SELECT octet_length(data) AS bytes FROM part WHERE id=?').get(id).bytes;
      stats.metadataMs = round(performance.now() - began);
      stats.afterMetadata = memory(); sample();
      if (mode === 'raw-slice') {
        const start = performance.now();
        const bytes = reader.prepare('SELECT substr(CAST(data AS BLOB),1,32768) AS bytes FROM part WHERE id=?').get(id).bytes;
        stats.firstRawSliceMs = round(performance.now() - start);
        stats.returnBytes = bytes.length;
        stats.jsonPrefixHash = sha(bytes); sample();
      }
      stats.databaseMethods = Object.getOwnPropertyNames(DatabaseSync.prototype);
      stats.maxLengthCompileOption = reader.prepare('PRAGMA compile_options').all()
        .map((row) => row.compile_options).find((value) => value.startsWith('MAX_LENGTH='));
    } else if (mode === 'corpus') {
      const statement = reader.prepare(`SELECT p.id,CAST(json_extract(p.data,'$.text') AS BLOB) AS bytes ${projection}
        AND p.id>? AND p.id<=100000 ORDER BY p.id LIMIT 100`);
      const digest = createHash('sha256');
      let last = 0;
      let count = 0;
      let batches = 0;
      let maxBatchMs = 0;
      let maxBatchBytes = 0;
      for (;;) {
        const began = performance.now();
        const rows = statement.all(last);
        if (!rows.length) break;
        let bytes = 0;
        for (const row of rows) {
          const text = Buffer.from(row.bytes).toString('utf8');
          digest.update(`${row.id}\0`).update(normalize(text));
          bytes += row.bytes.length;
          last = row.id; count++;
        }
        maxBatchMs = Math.max(maxBatchMs, performance.now() - began);
        maxBatchBytes = Math.max(maxBatchBytes, bytes);
        batches++; sample();
      }
      Object.assign(stats, { rows: count, batches, maxBatchMs: round(maxBatchMs), maxBatchBytes,
        normalizedHash: digest.digest('hex') });
    } else if (mode === 'failure') {
      const hub = new DatabaseSync(path.join(root, 'hub.sqlite'));
      try {
        hub.exec(`CREATE TABLE published(id INTEGER PRIMARY KEY,text TEXT);
          INSERT INTO published VALUES(1,'last-good');
          CREATE TABLE progress(cursor INTEGER,complete INTEGER); INSERT INTO progress VALUES(7,1);`);
        const state = () => JSON.stringify([hub.prepare('SELECT * FROM published').all(), hub.prepare('SELECT * FROM progress').get()]);
        const before = state();
        const sourceBytes = reader.prepare('SELECT octet_length(data) AS bytes FROM part WHERE id=?');
        let rejected = false;
        hub.exec('BEGIN IMMEDIATE');
        try {
          hub.exec("UPDATE published SET text='uncommitted-new'; UPDATE progress SET cursor=8,complete=0");
          if (sourceBytes.get(100003).bytes > 1024 * 1024) throw new Error('ROW_RESOURCE_LIMIT');
          throw new Error('Expected resource rejection');
        } catch (error) {
          hub.exec('ROLLBACK');
          assert.equal(error.message, 'ROW_RESOURCE_LIMIT');
          rejected = true;
        }
        assert.equal(state(), before);
        Object.assign(stats, { rejected, lastGoodPreserved: true, attemptedGenerationComplete: false,
          classification: 'deterministic preflight budget rejection, not an actual native OOM test' });
      } finally { hub.close(); }
    } else {
      let text;
      if (mode === 'whole' || mode === 'text-diagnostic') {
        const getStarted = performance.now();
        if (mode === 'text-diagnostic') {
          text = reader.prepare(`SELECT json_extract(p.data,'$.text') AS text ${projection} AND p.id=?`).get(id).text;
        } else {
          const row = reader.prepare(`SELECT CAST(json_extract(p.data,'$.text') AS BLOB) AS bytes ${projection} AND p.id=?`).get(id);
          stats.afterSql = memory();
          text = Buffer.from(row.bytes.buffer, row.bytes.byteOffset, row.bytes.byteLength).toString('utf8');
        }
        stats.extractMs = round(performance.now() - getStarted); sample();
        stats.afterExtract = memory();
      } else if (mode === 'chunks') {
        const statement = reader.prepare(`SELECT substr(CAST(json_extract(p.data,'$.text') AS BLOB),?,?) AS bytes
          ${projection} AND p.id=?`);
        const staged = path.join(root, `stage-${id}-${chunkBytes}.utf8`);
        const fd = fs.openSync(staged, 'wx');
        const digest = createHash('sha256');
        let offset = 1;
        let maxSqlMs = 0;
        let maxReturnBytes = 0;
        let calls = 0;
        const began = performance.now();
        try {
          for (;;) {
            const sqlBegan = performance.now();
            const bytes = statement.get(offset, chunkBytes, id).bytes;
            const sqlMs = performance.now() - sqlBegan;
            maxSqlMs = Math.max(maxSqlMs, sqlMs); calls++;
            sample();
            if (calls === 1) stats.afterFirstChunk = memory();
            if (!bytes.length) break;
            assert.ok(bytes.length <= chunkBytes);
            let written = 0;
            while (written < bytes.length) written += fs.writeSync(fd, bytes, written, bytes.length - written);
            digest.update(bytes);
            maxReturnBytes = Math.max(maxReturnBytes, bytes.length);
            offset += bytes.length;
          }
        } finally { fs.closeSync(fd); }
        Object.assign(stats, { extractMs: round(performance.now() - began), calls, maxSqlMs: round(maxSqlMs),
          maxReturnBytes, stagedBytes: offset - 1, stagedRawHash: digest.digest('hex') });
        // Deliberately honest baseline: disk transport alone does NOT make NFC streaming.
        text = fs.readFileSync(staged, 'utf8'); sample();
        fs.unlinkSync(staged);
      } else throw new Error('Unknown synthetic probe mode');
      stats.rawHash = sha(text);
      stats.textBytes = Buffer.byteLength(text);
      const normalizeStarted = performance.now();
      const normalized = normalize(text);
      stats.normalizeMs = round(performance.now() - normalizeStarted); sample();
      stats.normalizedHash = sha(normalized);
      stats.normalizedBytes = Buffer.byteLength(normalized);
      stats.found = needles.map((n) => normalized.includes(n));
      sample();
    }
    reader.exec('ROLLBACK');
    stats.elapsedMs = round(performance.now() - started);
    sample();
    return stats;
  } finally {
    if (reader.isTransaction) reader.exec('ROLLBACK');
    reader.close();
  }
}

function runChild(request) {
  return new Promise((resolve, reject) => {
    const child = fork(require.resolve('./step3-json-extraction.cjs'), ['--synthetic-child'], {
      execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, silent: true,
    });
    let result;
    let failure;
    const watchdog = setTimeout(() => { failure = new Error(`Synthetic child deadline: ${request.mode}`); child.kill(); }, 180000);
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    child.on('message', (message) => {
      if (message.error) failure = new Error(message.error);
      else result = message.result;
    });
    child.once('error', (error) => { failure = error; });
    child.once('exit', (code) => {
      clearTimeout(watchdog);
      if (failure) reject(failure);
      else if (code !== 0 || !result) reject(new Error(`Synthetic child failed: ${request.mode}/${code}`));
      else resolve(result);
    });
    child.send(request);
  });
}

async function main() {
  assert.equal(process.argv.length, 2, 'No source paths accepted');
  assert.ok(process.versions.electron, 'Run bundled Code.exe');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-json-synthetic-'));
  let writer;
  const report = { runtime: { node: process.versions.node, electron: process.versions.electron }, results: [] };
  const sourceHashes = () => ['', '-wal'].map((suffix) => {
    const fd = fs.openSync(path.join(root, `source.sqlite${suffix}`), 'r');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(32768);
    try {
      for (;;) {
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (!bytes) break;
        hash.update(buffer.subarray(0, bytes));
      }
      return hash.digest('hex');
    } finally { fs.closeSync(fd); }
  });
  try {
    report.fixture = await runChild({ mode: 'build', root });
    writer = new DatabaseSync(path.join(root, 'source.sqlite'));
    writer.exec('UPDATE marker SET revision=1'); // Synthetic Kilo-side writer pins a live WAL.
    report.runtime.sqlite = writer.prepare('SELECT sqlite_version() AS v').get().v;
    const before = sourceHashes();
    report.textDiagnostic = await runChild({ root, mode: 'text-diagnostic', id: 100001 });
    const diagnosticOracle = report.fixture.rows[0];
    report.textDiagnostic.matchesWholeOracle = report.textDiagnostic.rawHash === diagnosticOracle.rawHash;
    report.textDiagnostic.matchesNulPrefix = report.textDiagnostic.rawHash === diagnosticOracle.firstNulPrefixHash;
    assert.ok(report.textDiagnostic.matchesWholeOracle || report.textDiagnostic.matchesNulPrefix,
      'Unexpected TEXT conversion mismatch requires investigation');
    for (const row of report.fixture.rows) {
      for (const mode of ['whole', 'chunks']) {
        const result = await runChild({ root, mode, id: row.id });
        assert.equal(result.rawHash, row.rawHash, `${mode}/${row.kind}: raw extraction`);
        assert.equal(result.normalizedHash, row.normalizedHash, `${mode}/${row.kind}: normalized extraction`);
        assert.equal(result.textBytes, row.textBytes);
        assert.equal(result.normalizedBytes, row.normalizedBytes);
        assert.deepEqual(result.found, row.found);
        if (mode === 'chunks') {
          assert.equal(result.stagedRawHash, row.rawHash);
          assert.equal(result.stagedBytes, row.textBytes);
        }
        report.results.push(result);
      }
    }
    const huge = report.fixture.rows.find((row) => row.id === 100003);
    for (const mode of ['metadata', 'raw-slice']) {
      const result = await runChild({ root, mode, id: huge.id });
      assert.equal(result.jsonBytes, huge.jsonBytes);
      if (mode === 'raw-slice') {
        assert.equal(result.returnBytes, 32768);
        assert.equal(result.jsonPrefixHash, huge.jsonPrefixHash);
      }
      report.results.push(result);
    }
    const smallerChunks = await runChild({ root, mode: 'chunks', id: huge.id, chunkBytes: 32768 });
    assert.equal(smallerChunks.stagedRawHash, huge.rawHash);
    assert.equal(smallerChunks.normalizedHash, huge.normalizedHash);
    assert.deepEqual(smallerChunks.found, huge.found);
    report.results.push(smallerChunks);
    report.corpus = await runChild({ root, mode: 'corpus' });
    assert.equal(report.corpus.rows, 100000);
    assert.equal(report.corpus.normalizedHash, report.fixture.corpusHash);
    report.failure = await runChild({ root, mode: 'failure' });
    assert.deepEqual(sourceHashes(), before);
    report.sourceMainWalUnchanged = true;
  } finally {
    if (writer) writer.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  report.cleanup = !fs.existsSync(root);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[2] === '--synthetic-child' && process.send) {
  process.once('message', (request) => {
    try {
      const result = request.mode === 'build' ? build(request.root) : probe(request);
      process.send({ result }, () => process.exit(0));
    } catch (error) { process.send({ error: error.message }, () => process.exit(1)); }
  });
} else main().catch((error) => { console.error(error); process.exitCode = 1; });
