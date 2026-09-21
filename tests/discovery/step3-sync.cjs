'use strict';

// Synthetic discovery only: no production imports, source discovery or user data.
const assert = require('node:assert/strict');
const process = require('node:process');
const console = require('node:console');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-step3-sync-'));
const sourcePath = path.join(root, 'synthetic-source.sqlite');
const hubPath = path.join(root, 'synthetic-hub.sqlite');
const connections = [];
const timings = [];
function open(file, options = {}) {
  const db = new DatabaseSync(file, options);
  connections.push(db);
  return db;
}
function check(name, fn) {
  const start = performance.now();
  fn();
  timings.push({ name, ms: +(performance.now() - start).toFixed(2) });
  console.log(`PASS ${name}`);
}
function identity(file) {
  const stat = fs.statSync(file, { bigint: true });
  return { real: fs.realpathSync.native(file), dev: stat.dev, ino: stat.ino };
}
function guard(target) {
  const source = identity(sourcePath);
  const candidate = fs.existsSync(target)
    ? identity(target)
    : { real: path.join(fs.realpathSync.native(path.dirname(target)), path.basename(target)) };
  const canonical = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  assert.notEqual(canonical(candidate.real), canonical(source.real), 'source path collision');
  if (candidate.ino !== undefined && source.ino !== 0n && candidate.ino !== 0n) {
    assert.ok(candidate.dev !== source.dev || candidate.ino !== source.ino, 'source identity collision');
  }
}
function sourceHashes() {
  return ['', '-wal'].map((suffix) => createHash('sha256')
    .update(fs.readFileSync(sourcePath + suffix)).digest('hex'));
}

try {
  const writer = open(sourcePath);
  // Only the synthetic Kilo-side writer creates or mutates this schema/WAL.
  writer.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT,
      title TEXT, time_updated INTEGER, time_archived INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT REFERENCES session(id)
      ON DELETE CASCADE, time_updated INTEGER, data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT REFERENCES message(id)
      ON DELETE CASCADE, session_id TEXT, time_updated INTEGER, data TEXT);
    CREATE TABLE event_sequence(aggregate_id TEXT PRIMARY KEY, seq INTEGER, owner_id TEXT);
    INSERT INTO session VALUES ('s1',NULL,'C:/synthetic/one','One',100,NULL),
      ('s2',NULL,'C:/synthetic/two','Two',100,NULL),
      ('child','s1','C:/synthetic/one','Child',100,NULL),
      ('archived',NULL,'C:/synthetic/three','Archived',100,200);
    INSERT INTO event_sequence VALUES ('s1',10,'owner'),('s2',20,'owner');`);
  const message = writer.prepare('INSERT INTO message VALUES (?,?,100,?)');
  for (const [id, session, role] of [
    ['u1', 's1', 'user'], ['a1', 's1', 'assistant'], ['t1', 's1', 'tool'],
    ['u2', 's2', 'user'], ['uc', 'child', 'user'], ['ua', 'archived', 'user'],
  ]) message.run(id, session, JSON.stringify({ role }));
  const part = writer.prepare('INSERT INTO part VALUES (?,?,?,100,?)');
  const fixtures = [
    ['plain', 'u1', 's1', { type: 'text', text: 'synthetic plain' }],
    ['mixed', 'u1', 's1', { type: 'text', text: 'synthetic context; const x = 1;' }],
    ['false-flags', 'u1', 's1', { type: 'text', text: 'explicit false', synthetic: false, ignored: false }],
    ['synthetic', 'u1', 's1', { type: 'text', text: 'exclude', synthetic: true }],
    ['ignored', 'u1', 's1', { type: 'text', text: 'exclude', ignored: true }],
    ['assistant', 'a1', 's1', { type: 'text', text: 'exclude' }],
    ['tool-role', 't1', 's1', { type: 'text', text: 'exclude' }],
    ['other-session', 'u2', 's2', { type: 'text', text: 'second' }],
    ['child', 'uc', 'child', { type: 'text', text: 'exclude' }],
    ['archived', 'ua', 'archived', { type: 'text', text: 'exclude' }],
    ['bad-join', 'u1', 's2', { type: 'text', text: 'exclude' }],
    ['missing-session', 'u1', 'absent', { type: 'text', text: 'exclude' }],
    ['non-string', 'u1', 's1', { type: 'text', text: 42 }],
  ];
  for (const type of ['file', 'image', 'tool', 'reasoning', 'compaction']) {
    fixtures.push([type, 'u1', 's1', { type, text: 'exclude' }]);
  }
  for (const [id, msg, session, data] of fixtures) part.run(id, msg, session, JSON.stringify(data));
  writer.exec("PRAGMA foreign_keys=OFF; INSERT INTO part VALUES ('orphan','absent','s1',100,'{\"type\":\"text\",\"text\":\"exclude\"}'); PRAGMA foreign_keys=ON;");

  check('realpath/stat guard rejects source and hardlink before writable open', () => {
    assert.throws(() => guard(sourcePath), /source path collision/);
    assert.throws(() => guard(path.join(root, '.', path.basename(sourcePath))), /collision/);
    const alias = path.join(root, 'synthetic-hardlink.sqlite');
    try {
      fs.linkSync(sourcePath, alias);
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error.code)) throw error;
      console.log(`SKIP hardlink: ${error.code}`);
      return;
    }
    assert.notEqual(identity(alias).real, identity(sourcePath).real);
    assert.throws(() => guard(alias), /source identity collision/);
    fs.unlinkSync(alias);
  });
  guard(hubPath);
  const hub = open(hubPath);
  hub.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=80;
    CREATE TABLE sessions(id TEXT PRIMARY KEY, directory TEXT, title TEXT);
    CREATE TABLE texts(id TEXT PRIMARY KEY, session_id TEXT, message_id TEXT, text TEXT);
    CREATE TABLE cursors(id TEXT PRIMARY KEY, seq INTEGER, owner_id TEXT);`);
  guard(hubPath);
  const second = open(hubPath);
  second.exec('PRAGMA busy_timeout=80');
  const reader = open(sourcePath, { readOnly: true });
  reader.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=80');
  check('readOnly and query_only reject writes; main/WAL hashes unchanged', () => {
    const before = sourceHashes();
    assert.equal(reader.prepare('PRAGMA query_only').get().query_only, 1);
    assert.throws(() => reader.exec("UPDATE session SET title='forbidden'"), /readonly/i);
    reader.exec('PRAGMA query_only=OFF');
    assert.throws(() => reader.exec('CREATE TABLE forbidden(id)'), /readonly/i);
    reader.exec('PRAGMA query_only=ON');
    assert.deepEqual(sourceHashes(), before);
  });

  const projection = reader.prepare(`SELECT p.id, s.id AS session_id, m.id AS message_id,
      json_extract(p.data,'$.text') AS text
    FROM part p JOIN message m ON m.id=p.message_id AND m.session_id=p.session_id
    JOIN session s ON s.id=m.session_id
    WHERE s.parent_id IS NULL AND s.time_archived IS NULL
      AND json_extract(m.data,'$.role')='user'
      AND json_extract(p.data,'$.type')='text'
      AND json_type(p.data,'$.text')='text'
      AND coalesce(json_extract(p.data,'$.synthetic'),0) != 1
      AND coalesce(json_extract(p.data,'$.ignored'),0) != 1 ORDER BY p.id`);
  const state = () => JSON.stringify(['sessions', 'texts', 'cursors'].map((table) =>
    hub.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
  // Full small-fixture reconciliation, deliberately not a bounded production importer.
  function reconcile({ failAfter = Infinity, afterSnapshot } = {}) {
    hub.exec('BEGIN IMMEDIATE');
    reader.exec('BEGIN');
    try {
      const sessions = reader.prepare(`SELECT id,directory,title FROM session
        WHERE parent_id IS NULL AND time_archived IS NULL ORDER BY id`).all();
      const cursors = reader.prepare('SELECT aggregate_id,seq,owner_id FROM event_sequence').all();
      if (afterSnapshot) afterSnapshot();
      hub.exec('DELETE FROM texts; DELETE FROM sessions; DELETE FROM cursors');
      for (const row of sessions) hub.prepare('INSERT INTO sessions VALUES (?,?,?)')
        .run(row.id, row.directory, row.title);
      let count = 0;
      for (const row of projection.iterate()) {
        hub.prepare('INSERT INTO texts VALUES (?,?,?,?)')
          .run(row.id, row.session_id, row.message_id, row.text);
        if (++count >= failAfter) throw new Error('injected partial scan failure');
      }
      for (const row of cursors) hub.prepare('INSERT INTO cursors VALUES (?,?,?)')
        .run(row.aggregate_id, row.seq, row.owner_id);
      reader.exec('COMMIT');
      hub.exec('COMMIT');
    } catch (error) {
      try { reader.exec('ROLLBACK'); } catch { /* Snapshot may already be closed. */ }
      hub.exec('ROLLBACK');
      throw error;
    }
  }
  const text = (id) => hub.prepare('SELECT text FROM texts WHERE id=?').get(id)?.text;
  check('projection filters roles/types/flags and validates both joins', () => {
    const before = sourceHashes();
    reconcile();
    assert.deepEqual(hub.prepare('SELECT id FROM texts ORDER BY id').all().map((r) => r.id),
      ['false-flags', 'mixed', 'other-session', 'plain']);
    assert.equal(text('mixed'), fixtures[1][3].text);
    assert.equal(hub.prepare('SELECT count(*) AS n FROM sessions').get().n, 2);
    const previous = state();
    reconcile();
    assert.equal(state(), previous);
    assert.deepEqual(sourceHashes(), before);
  });
  check('WAL snapshot keeps text and cursor coherent across concurrent commit', () => {
    reconcile({ afterSnapshot() {
      writer.exec(`BEGIN; UPDATE part SET data='{"type":"text","text":"edited"}'
        WHERE id='plain'; UPDATE event_sequence SET seq=11 WHERE aggregate_id='s1'; COMMIT;`);
    } });
    assert.equal(text('plain'), 'synthetic plain');
    assert.equal(hub.prepare("SELECT seq FROM cursors WHERE id='s1'").get().seq, 10);
    reconcile();
    assert.equal(text('plain'), 'edited');
    assert.equal(hub.prepare("SELECT seq FROM cursors WHERE id='s1'").get().seq, 11);
    assert.equal(reader.prepare("SELECT time_updated FROM session WHERE id='s1'").get().time_updated, 100);
  });
  check('failed partial scan rolls back projection and cursor to last-good', () => {
    const before = state();
    writer.exec("DELETE FROM part WHERE id='mixed'; UPDATE event_sequence SET seq=12 WHERE aggregate_id='s1'");
    assert.throws(() => reconcile({ failAfter: 1 }), /partial scan failure/);
    assert.equal(state(), before);
    reconcile();
    assert.equal(text('mixed'), undefined);
    assert.equal(hub.prepare("SELECT seq FROM cursors WHERE id='s1'").get().seq, 12);
  });
  check('part/message deletion and archive/unarchive need no timestamp change', () => {
    writer.exec("DELETE FROM message WHERE id='u2'; UPDATE session SET time_archived=300 WHERE id='s1'");
    reconcile();
    assert.equal(hub.prepare('SELECT count(*) AS n FROM texts').get().n, 0);
    assert.deepEqual(hub.prepare('SELECT id FROM sessions').all().map((r) => r.id), ['s2']);
    writer.exec("UPDATE session SET time_archived=NULL WHERE id='s1'");
    reconcile();
    assert.equal(text('plain'), 'edited');
    assert.ok(reader.prepare('SELECT time_updated FROM session').all().every((r) => r.time_updated === 100));
  });
  check('sequence reset and deleted session/journal require membership reconciliation', () => {
    const cursor = hub.prepare("SELECT seq FROM cursors WHERE id='s1'").get().seq;
    writer.exec(`BEGIN; UPDATE event_sequence SET seq=1 WHERE aggregate_id='s1';
      UPDATE part SET data='{"type":"text","text":"after reset"}' WHERE id='plain';
      DELETE FROM session WHERE id='s2'; DELETE FROM event_sequence WHERE aggregate_id='s2'; COMMIT;`);
    assert.equal(reader.prepare("SELECT count(*) AS n FROM event_sequence WHERE aggregate_id='s1' AND seq>?").get(cursor).n, 0);
    assert.equal(text('plain'), 'edited');
    assert.ok(hub.prepare("SELECT id FROM sessions WHERE id='s2'").get());
    reconcile();
    assert.equal(text('plain'), 'after reset');
    assert.equal(hub.prepare("SELECT id FROM sessions WHERE id='s2'").get(), undefined);
    assert.equal(hub.prepare("SELECT id FROM cursors WHERE id='s2'").get(), undefined);
    assert.equal(hub.prepare("SELECT seq FROM cursors WHERE id='s1'").get().seq, 1);
    writer.exec("DELETE FROM session WHERE id='s1'; DELETE FROM event_sequence WHERE aggregate_id='s1'");
    reconcile();
    assert.equal(hub.prepare('SELECT count(*) AS n FROM texts').get().n, 0);
    assert.equal(hub.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  });
  check('two BEGIN IMMEDIATE writers serialize; rollback releases ownership', () => {
    const before = state();
    hub.exec("BEGIN IMMEDIATE; INSERT INTO sessions VALUES ('uncommitted','synthetic','test')");
    assert.equal(second.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    const start = performance.now();
    assert.throws(() => second.exec('BEGIN IMMEDIATE'), /locked|busy/i);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 2000, `busy wait exceeded discovery bound: ${elapsed}`);
    console.log(`EVIDENCE busy_timeout=80ms observed=${elapsed.toFixed(2)}ms`);
    hub.exec('ROLLBACK');
    second.exec("BEGIN IMMEDIATE; INSERT INTO sessions VALUES ('next','synthetic','test'); COMMIT");
    assert.ok(hub.prepare("SELECT id FROM sessions WHERE id='next'").get());
    second.exec("DELETE FROM sessions WHERE id='next'");
    assert.equal(state(), before);
  });
  check('process exit without close rolls back writer; next writer commits', () => {
    const before = state();
    const child = spawnSync(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec("BEGIN IMMEDIATE; INSERT INTO sessions VALUES ('crash','synthetic','test')");
      process.stdout.write('transaction-open\\n', () => process.exit(23));
    `, hubPath], { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    assert.ifError(child.error);
    assert.equal(child.status, 23, child.stderr);
    assert.match(child.stdout, /transaction-open/);
    assert.equal(state(), before);
    second.exec("BEGIN IMMEDIATE; INSERT INTO sessions VALUES ('recovered','synthetic','test'); COMMIT");
    assert.ok(hub.prepare("SELECT id FROM sessions WHERE id='recovered'").get());
  });
  console.log(JSON.stringify({ runtime: process.versions, checks: timings,
    memoryBytes: process.memoryUsage(), syntheticPartCount: fixtures.length + 1,
    limitations: ['small fixture, not throughput/SLA evidence', 'no installed Extension Host or storage-profile test',
      'identity check is not a TOCTOU defense', 'no power-loss, disk-full or corruption simulation',
      'event_sequence only, no claim of complete durable journal', 'SHM byte identity not asserted'] }, null, 2));
} finally {
  for (const db of connections.reverse()) {
    try { db.close(); } catch { /* Preserve original assertion failure during cleanup. */ }
  }
  fs.rmSync(root, { recursive: true, force: true });
}
