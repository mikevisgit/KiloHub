import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

import { HubIndexEngine } from '../../src/hubIndexEngine.js';
import type { HubIndexOptions, HubIndexSnapshot } from '../../src/hubIndexProtocol.js';
import { admitField, normalizeIndexText } from '../../src/hubSource.js';
import { assertIsolated, HubStorage, type HubPointer } from '../../src/hubStorage.js';
import { projectSessions } from '../../src/projection.js';
import { presentFolders } from '../../src/presentation.js';

function fixture(count = 1) {
  const root = mkdtempSync(join(tmpdir(), 'hub-b-synthetic-'));
  const options: HubIndexOptions = { sourcePath: join(root, 'synthetic.sqlite'), storagePath: join(root, 'hub') };
  const source = new DatabaseSync(options.sourcePath);
  source.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE session(id TEXT PRIMARY KEY,title TEXT NOT NULL,directory TEXT NOT NULL,parent_id TEXT,
      time_created INTEGER NOT NULL,time_updated INTEGER NOT NULL,time_archived INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,message_id TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE event_sequence(aggregate_id TEXT PRIMARY KEY,seq INTEGER,owner_id TEXT);
    CREATE TABLE session_message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT);
    CREATE TABLE session_input(id TEXT PRIMARY KEY,session_id TEXT,prompt TEXT);`);
  source.exec('BEGIN');
  for (let index = 0; index < count; index += 1) {
    const id = `s${String(index).padStart(5, '0')}`;
    source.prepare('INSERT INTO session VALUES (?,?,?,NULL,1,2,NULL)').run(id, `Title ${index}`, 'C:\\Synthetic\\Project');
    source.prepare('INSERT INTO message VALUES (?,?,?)').run(`m${id}`, id, JSON.stringify({ role: 'user' }));
    source.prepare('INSERT INTO part VALUES (?,?,?,?)').run(`p${id}`, id, `m${id}`, JSON.stringify({ type: 'text', text: `PRIVATE-SYNTHETIC-${index}\0Ё e\u0301 tail` }));
    source.prepare('INSERT INTO event_sequence VALUES (?,1,\'owner\')').run(id);
  }
  source.exec('COMMIT');
  const engines: HubIndexEngine[] = [];
  let sourceOpen = true;
  return { root, source, options,
    engine(budget?: () => number) { const engine = new HubIndexEngine(options, budget); engines.push(engine); return engine; },
    pointer() { return JSON.parse(readFileSync(join(options.storagePath, 'hub-pointer.json'), 'utf8')) as HubPointer; },
    read(generation: string) { return new DatabaseSync(join(options.storagePath, `hub-${generation}.sqlite`), { readOnly: true }); },
    closeSource() { if (sourceOpen) { source.close(); sourceOpen = false; } },
    async close() { for (const engine of engines) await engine.close(); if (sourceOpen) source.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

async function complete(engine: HubIndexEngine, force = false): Promise<HubIndexSnapshot> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const snapshot = await engine.tick(force && attempt === 0);
    if (snapshot.complete || snapshot.diagnostic) return snapshot;
  }
  throw new Error('Synthetic import did not complete');
}

void test('durable generations preserve all history, resume committed session progress, and never transport corpus', async () => {
  const f = fixture(205);
  try {
    const engine = f.engine();
    const partial = await engine.tick();
    assert.equal(partial.complete, false);
    assert.equal(partial.health, 'preparing');
    const first = f.pointer();
    assert.equal(first.published, first.building);
    assert.ok(first.building);
    const stage = f.read(first.building);
    assert.equal(stage.prepare('SELECT count(*) n FROM sessions').get()?.n, 100);
    assert.equal(stage.prepare('SELECT cursor FROM progress').get()?.cursor, 's00099');
    stage.close();
    await engine.close();
    const restarted = f.engine();
    const snapshot = await complete(restarted);
    assert.equal(snapshot.health, 'ready');
    assert.equal(snapshot.complete, true);
    assert.equal(f.pointer().published, first.building);
    assert.equal(snapshot.folders[0]?.conversations.length, 3);
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE-SYNTHETIC|message_id|texts/);
    const db = f.read(f.pointer().published!);
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get()?.n, 205);
    assert.equal(db.prepare('SELECT count(*) n FROM texts').get()?.n, 205);
    const bytes = db.prepare('SELECT CAST(text AS BLOB) text FROM texts WHERE id=\'ps00000\'').get()?.text;
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(Buffer.from(bytes).toString('utf8'), normalizeIndexText('PRIVATE-SYNTHETIC-0\0Ё e\u0301 tail'));
    db.close();
  } finally { await f.close(); }
});

void test('reconciliation catches edits without updated/sequence changes, deletion, archive and unarchive', async () => {
  const f = fixture(2);
  try {
    const engine = f.engine();
    assert.equal((await complete(engine)).complete, true);
    const first = f.pointer().published;
    f.source.prepare('UPDATE part SET data=? WHERE id=?').run(JSON.stringify({ type: 'text', text: 'edited\0tail' }), 'ps00000');
    assert.equal((await engine.tick()).generation.endsWith(first!), true);
    assert.equal((await complete(engine, true)).complete, true);
    let db = f.read(f.pointer().published!);
    const value = db.prepare('SELECT CAST(text AS BLOB) t FROM texts WHERE id=\'ps00000\'').get()?.t;
    assert.ok(value instanceof Uint8Array);
    assert.equal(Buffer.from(value).toString(), 'edited\0tail'); db.close();
    f.source.exec("DELETE FROM part WHERE id='ps00000'; UPDATE session SET time_archived=3 WHERE id='s00001'");
    assert.equal((await complete(engine, true)).complete, true);
    db = f.read(f.pointer().published!);
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get()?.n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM texts').get()?.n, 0); db.close();
    f.source.exec("UPDATE session SET time_archived=NULL WHERE id='s00001'; UPDATE event_sequence SET seq=0");
    assert.equal((await complete(engine)).complete, true);
    db = f.read(f.pointer().published!);
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get()?.n, 2); db.close();
    f.source.exec('DELETE FROM session');
    assert.deepEqual((await complete(engine)).folders, []);
  } finally { await f.close(); }
});

void test('DB06 excludes non-user, non-text, synthetic and ignored, retaining marked mixed text and NUL', async () => {
  const f = fixture();
  try {
    for (const [id, data] of [
      ['synthetic', { type: 'text', text: 'excluded', synthetic: true }],
      ['ignored', { type: 'text', text: 'excluded', ignored: true }],
      ['file', { type: 'file', text: 'excluded' }],
      ['mixed', { type: 'text', text: 'autocontext plus code' }],
    ] as const) f.source.prepare('INSERT INTO part VALUES (?,\'s00000\',\'ms00000\',?)').run(id, JSON.stringify(data));
    f.source.prepare('INSERT INTO message VALUES (\'assistant\',\'s00000\',?)').run(JSON.stringify({ role: 'assistant' }));
    f.source.prepare('INSERT INTO part VALUES (\'assistant\',\'s00000\',\'assistant\',?)').run(JSON.stringify({ type: 'text', text: 'excluded' }));
    f.source.prepare('INSERT INTO message VALUES (\'nul-role\',\'s00000\',?)').run(JSON.stringify({ role: 'user\0assistant' }));
    f.source.prepare('INSERT INTO part VALUES (\'nul-role\',\'s00000\',\'nul-role\',?)').run(JSON.stringify({ type: 'text', text: 'excluded' }));
    assert.equal((await complete(f.engine())).complete, true);
    const db = f.read(f.pointer().published!);
    assert.deepEqual(db.prepare('SELECT id FROM texts ORDER BY id').all().map((row) => row.id), ['mixed', 'ps00000']);
    db.close();
  } finally { await f.close(); }
});

void test('DB09 ambiguity and invalid JSON retain last-good, no partial deletion, recover automatically', async () => {
  const f = fixture();
  try {
    const engine = f.engine();
    const good = await complete(engine);
    f.source.exec("INSERT INTO session_message VALUES ('alternate','s00000','NEVER READ PAYLOAD'); DELETE FROM part");
    const error = await engine.tick(true);
    assert.equal(error.diagnostic, 'source-ambiguous');
    assert.equal(error.complete, false);
    assert.deepEqual(error.folders, good.folders);
    assert.equal(error.generation, good.generation);
    f.source.exec('DELETE FROM session_message');
    assert.equal((await complete(engine, true)).complete, true);
    f.source.exec("UPDATE message SET data='PRIVATE invalid json'");
    const malformed = await complete(engine, true);
    assert.equal(malformed.complete, false);
    assert.doesNotMatch(JSON.stringify(malformed), /PRIVATE|json/);
  } finally { await f.close(); }
});

void test('resource refusal precedes parsing of both JSON columns, preserves cursor and retries the same row', async () => {
  const f = fixture();
  let budget = 1024 * 1024 * 1024;
  try {
    const engine = f.engine(() => budget);
    const good = await complete(engine);
    f.source.prepare('UPDATE part SET data=?').run(JSON.stringify({ type: 'text', text: 'x'.repeat(100_000) }));
    budget = 64 * 1024 * 1024 + 4096;
    const refused = await complete(engine, true);
    assert.equal(refused.diagnostic, 'resource-refused');
    assert.equal(refused.generation, good.generation);
    const generation = f.pointer().published!;
    let db = f.read(generation);
    assert.equal(db.prepare('SELECT id FROM work').get()?.id, 's00000'); db.close();
    budget = 1024 * 1024 * 1024;
    assert.equal((await complete(engine)).complete, true);
    assert.equal(f.pointer().published, generation);
    db = f.read(generation);
    assert.equal(db.prepare('SELECT length(text) n FROM texts').get()?.n, 100_000); db.close();
    f.source.prepare('UPDATE message SET data=?').run('invalid '.repeat(20_000));
    budget = 64 * 1024 * 1024 + 4096;
    assert.equal((await complete(engine, true)).diagnostic, 'resource-refused');
    assert.throws(() => admitField(Number.MAX_SAFE_INTEGER), /resource-refused/);
  } finally { await f.close(); }
});

void test('two owners share OS pipe, follower cannot publish; takeover and corrupt recognized generation rebuild', async () => {
  const f = fixture();
  try {
    const first = f.engine(); const second = f.engine();
    const good = await complete(first);
    f.source.exec("UPDATE session SET title='Changed'");
    assert.equal((await second.tick()).generation, good.generation);
    await first.close();
    assert.equal((await complete(second)).folders[0]?.conversations[0]?.title, 'Changed');
    const old = f.pointer().published!;
    writeFileSync(join(f.options.storagePath, `hub-${old}.sqlite`), 'corrupt recognized synthetic generation');
    const recovered = await complete(second, true);
    assert.equal(recovered.complete, true);
    assert.notEqual(f.pointer().published, old);
    assert.equal(recovered.folders.length, 1);
  } finally { await f.close(); }
});

void test('file identity blocks source/main/sidecar/hardlink aliases before writable opens', async () => {
  const f = fixture();
  try {
    mkdirSync(f.options.storagePath);
    const alias = join(f.options.storagePath, 'alias.sqlite');
    linkSync(f.options.sourcePath, alias);
    assert.throws(() => assertIsolated(f.options.sourcePath, alias), /storage-unsafe/);
    assert.throws(() => assertIsolated(f.options.sourcePath, f.options.sourcePath), /storage-unsafe/);
    assert.throws(() => assertIsolated(f.options.sourcePath, `${f.options.sourcePath}-wal`), /storage-unsafe/);
    const hash = createHash('sha256').update(readFileSync(f.options.sourcePath)).digest('hex');
    const walHash = createHash('sha256').update(readFileSync(`${f.options.sourcePath}-wal`)).digest('hex');
    const engine = f.engine();
    await complete(engine);
    assert.equal(createHash('sha256').update(readFileSync(f.options.sourcePath)).digest('hex'), hash);
    assert.equal(createHash('sha256').update(readFileSync(`${f.options.sourcePath}-wal`)).digest('hex'), walHash);
    const pointer = f.pointer();
    const path = join(f.options.storagePath, `hub-${pointer.published!}.sqlite`);
    rmSync(path); linkSync(f.options.sourcePath, path);
    assert.equal((await engine.tick()).diagnostic, 'storage-unsafe');
  } finally { await f.close(); }
});

void test('worker starts with no view, emits only metadata, releases pipe after process-thread death', async () => {
  const f = fixture();
  const worker = new Worker(resolve(__dirname, '../../src/hubIndexWorker.js'), { workerData: f.options });
  try {
    const snapshot = await new Promise<HubIndexSnapshot>((resolveSnapshot, reject) => {
      const timeout = setTimeout(() => reject(new Error('Synthetic worker deadline')), 10_000);
      worker.on('message', (value: HubIndexSnapshot) => {
        if (value.complete || value.diagnostic) { clearTimeout(timeout); resolveSnapshot(value); }
      });
      worker.on('error', reject);
    });
    assert.equal(snapshot.complete, true);
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE-SYNTHETIC/);
    await worker.terminate();
    const storage = new HubStorage(f.options.storagePath, f.options.sourcePath);
    assert.equal(await storage.claim(), true);
    await storage.close();
    assert.equal((await complete(f.engine())).complete, true);
    assert.ok(existsSync(join(f.options.storagePath, 'hub-pointer.json')));
  } finally { await worker.terminate(); await f.close(); }
});

void test('more than 10000 sessions are indexed without a transport/history cap', async () => {
  const f = fixture(10_001);
  try {
    f.source.exec('DELETE FROM part; DELETE FROM message');
    const snapshot = await complete(f.engine());
    assert.equal(snapshot.complete, true);
    const db = f.read(f.pointer().published!);
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get()?.n, 10_001);
    assert.ok(db.prepare("SELECT id FROM sessions WHERE id='s10000'").get());
    db.close();
  } finally { await f.close(); }
});

void test('top-three/date/path casing metadata exactly matches existing projection', async () => {
  const f = fixture(5);
  try {
    f.source.exec(`UPDATE session SET title=CASE id WHEN 's00000' THEN 'Z' WHEN 's00001' THEN '' ELSE 'A' END,
      directory=CASE id WHEN 's00000' THEN 'c:/SYNTHETIC/Project' ELSE 'C:/synthetic/project' END`);
    const rows = f.source.prepare('SELECT * FROM session').all().map((row) => ({
      id: String(row.id), title: String(row.title), directory: String(row.directory), parentId: null,
      timeCreated: Number(row.time_created), timeUpdated: Number(row.time_updated), timeArchived: null,
    }));
    const baseline = await projectSessions(rows, { isDirectoryAvailable: () => Promise.resolve(false) });
    const snapshot = await complete(f.engine());
    assert.deepEqual(presentFolders(snapshot.folders, { now: new Date(1000), currentFolderId: null }),
      presentFolders(baseline, { now: new Date(1000), currentFolderId: null }));
  } finally { await f.close(); }
});

void test('missing source retains persisted last-good on restart; restored source resumes', async () => {
  const f = fixture();
  try {
    const first = f.engine();
    const good = await complete(first);
    await first.close();
    f.closeSource();
    // Rename is permitted on these synthetic WAL files; no real source is involved.
    const renamed = `${f.options.sourcePath}.absent`;
    renameSync(f.options.sourcePath, renamed);
    const second = f.engine();
    try {
      const missing = await second.tick();
      assert.equal(missing.complete, false);
      assert.equal(missing.health, 'stale');
      assert.equal(missing.generation, good.generation);
    } finally { renameSync(renamed, f.options.sourcePath); }
    assert.equal((await complete(second)).complete, true);
  } finally { await f.close(); }
});

void test('source replacement discards pending generation rather than mixing identities', async () => {
  const f = fixture(101);
  const replacement = fixture(1);
  try {
    const first = f.engine();
    assert.equal((await first.tick()).complete, false);
    const abandoned = f.pointer().building;
    await first.close();
    // A different explicit source path is sufficient to exercise replacement without changing any real file.
    const changed = new HubIndexEngine({ ...f.options, sourcePath: replacement.options.sourcePath });
    try {
      assert.equal((await complete(changed)).complete, true);
      assert.notEqual(f.pointer().published, abandoned);
      const db = f.read(f.pointer().published!);
      assert.equal(db.prepare('SELECT count(*) n FROM sessions').get()?.n, 1); db.close();
    } finally { await changed.close(); }
  } finally { await replacement.close(); await f.close(); }
});

void test('display overflow rolls back candidate metadata and does not expose staged text', async () => {
  const f = fixture();
  try {
    f.source.prepare('UPDATE session SET title=?').run('x'.repeat(5000));
    const snapshot = await complete(f.engine());
    assert.equal(snapshot.diagnostic, 'display-overflow');
    assert.equal(snapshot.complete, false);
    assert.equal(f.pointer().published, null);
    const db = f.read(f.pointer().building!);
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get()?.n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM texts').get()?.n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM staged_texts').get()?.n, 1); db.close();
  } finally { await f.close(); }
});

void test('forced Worker death rolls back an active Hub transaction and permits fenced recovery', async () => {
  const f = fixture(101);
  const worker = new Worker(resolve(__dirname, 'hubCrashWorker.js'), { workerData: f.options });
  try {
    await new Promise<void>((resolveHeld, reject) => {
      const timeout = setTimeout(() => reject(new Error('Synthetic crash deadline')), 15_000);
      worker.once('message', (value) => { clearTimeout(timeout); assert.equal(value, 'transaction-held'); resolveHeld(); });
      worker.once('error', (error) => { clearTimeout(timeout); reject(error); });
    });
    const generation = f.pointer().building!;
    let db = f.read(generation);
    assert.equal(db.prepare('SELECT cursor FROM progress').get()?.cursor, 's00099'); db.close();
    await worker.terminate();
    const recovered = await complete(f.engine());
    assert.equal(recovered.complete, true);
    assert.equal(f.pointer().published, generation);
    db = f.read(generation);
    assert.equal(db.prepare('SELECT count(*) n FROM texts').get()?.n, 101); db.close();
  } finally { await worker.terminate(); await f.close(); }
});

void test('NUL title tails survive source extraction, durable storage and metadata transport', async () => {
  const f = fixture();
  try {
    const title = 'Title\0searchable-tail Ё';
    f.source.prepare('UPDATE session SET title=?').run(title);
    const snapshot = await complete(f.engine());
    assert.equal(snapshot.complete, true);
    assert.equal(snapshot.folders[0]?.conversations[0]?.title, title);
    const db = f.read(f.pointer().published!);
    const stored = db.prepare('SELECT CAST(title_norm AS BLOB) value FROM sessions').get()?.value;
    assert.ok(stored instanceof Uint8Array);
    assert.equal(Buffer.from(stored).toString('utf8'), normalizeIndexText(title)); db.close();
  } finally { await f.close(); }
});

void test('real SQLite disk-full rollback retains published data and retries the unfinished session', async () => {
  const f = fixture();
  const open = Object.getOwnPropertyDescriptor(HubStorage.prototype, 'open')?.value as HubStorage['open'];
  try {
    const engine = f.engine();
    const good = await complete(engine);
    f.source.prepare('UPDATE part SET data=?').run(JSON.stringify({ type: 'text', text: 'large'.repeat(100_000) }));
    // Restrict the actual synthetic SQLite pager, not a mocked exception or the real filesystem.
    HubStorage.prototype.open = function (generation, writable, fresh = false) {
      const db = open.call(this, generation, writable, fresh);
      if (writable && !fresh) {
        const pages = Number(db.prepare('PRAGMA page_count').get()?.page_count);
        db.exec(`PRAGMA max_page_count=${pages}`);
      }
      return db;
    };
    const failed = await complete(engine, true);
    assert.equal(failed.complete, false);
    assert.equal(failed.generation, good.generation);
    assert.equal(failed.diagnostic, 'storage-unavailable');
    const generation = f.pointer().published!;
    const staged = f.read(generation);
    assert.equal(staged.prepare('SELECT id FROM work').get()?.id, 's00000'); staged.close();
    HubStorage.prototype.open = open;
    const recovered = await complete(engine);
    assert.equal(recovered.complete, true);
    assert.equal(f.pointer().published, generation);
  } finally { HubStorage.prototype.open = open; await f.close(); }
});

void test('busy source and ambiguous coordinator never authorize deletions or a second writer', async () => {
  const f = fixture();
  try {
    const engine = f.engine();
    const good = await complete(engine);
    f.source.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
    try {
      const busy = await engine.tick(true);
      assert.equal(busy.complete, false);
      assert.equal(busy.generation, good.generation);
    } finally { f.source.exec('ROLLBACK'); }
    assert.equal((await complete(engine)).complete, true);
    const pointerPath = join(f.options.storagePath, 'hub-pointer.json');
    const saved = readFileSync(pointerPath);
    writeFileSync(pointerPath, 'unrecognized coordination data');
    const follower = f.engine();
    try {
      assert.equal((await follower.tick()).diagnostic, 'storage-unsafe');
      assert.equal(readFileSync(pointerPath, 'utf8'), 'unrecognized coordination data');
    } finally { writeFileSync(pointerPath, saved); }
    assert.equal((await engine.tick()).complete, true);
  } finally { await f.close(); }
});

void test('row-scaled default admission imports a complete 12 MiB field including NUL and combining tail', async () => {
  const f = fixture();
  try {
    const text = 'x'.repeat(12 * 1024 * 1024) + '\0Ё e' + '\u0301'.repeat(30_000) + ' FINAL';
    f.source.prepare('UPDATE part SET data=?').run(JSON.stringify({ type: 'text', text }));
    const snapshot = await complete(f.engine());
    assert.equal(snapshot.complete, true);
    const db = f.read(f.pointer().published!);
    const bytes = db.prepare('SELECT CAST(text AS BLOB) value FROM texts').get()?.value;
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),
      createHash('sha256').update(normalizeIndexText(text)).digest('hex'));
    assert.ok(JSON.stringify(snapshot).length < 4096);
    db.close();
  } finally { await f.close(); }
});

void test('display overflow preserves the durable display-good generation across restart', async () => {
  const f = fixture();
  try {
    const first = f.engine();
    const good = await complete(first);
    const generation = f.pointer().published;
    f.source.prepare('UPDATE session SET title=?').run('oversize'.repeat(1000));
    assert.equal((await complete(first)).diagnostic, 'display-overflow');
    assert.equal(f.pointer().published, generation);
    await first.close();
    const restarted = f.engine();
    const failed = await restarted.tick();
    assert.equal(failed.diagnostic, 'display-overflow');
    assert.equal(failed.generation, good.generation);
    assert.deepEqual(failed.folders, good.folders);
    assert.equal(f.pointer().published, generation);
    assert.ok(existsSync(join(f.options.storagePath, `hub-${generation!}.sqlite`)));
  } finally { await f.close(); }
});

void test('missing entire source directory does not hide recognized read-only last-good after restart', async () => {
  const f = fixture();
  const sourceDirectory = join(f.root, 'source');
  const absent = join(f.root, 'temporarily-away');
  f.closeSource();
  mkdirSync(sourceDirectory);
  const sourcePath = join(sourceDirectory, 'source.sqlite');
  renameSync(f.options.sourcePath, sourcePath);
  const first = new HubIndexEngine({ ...f.options, sourcePath });
  const second = new HubIndexEngine({ ...f.options, sourcePath });
  try {
    const good = await complete(first);
    assert.equal(good.complete, true);
    await first.close();
    renameSync(sourceDirectory, absent);
    try {
      const missing = await second.tick();
      assert.equal(missing.health, 'stale');
      assert.equal(missing.complete, false);
      assert.equal(missing.generation, good.generation);
      assert.deepEqual(missing.folders, good.folders);
    } finally { renameSync(absent, sourceDirectory); }
    assert.equal((await complete(second)).complete, true);
  } finally { await first.close(); await second.close(); await f.close(); }
});

void test('fault during initialization rolls back schema markers; invalid singleton staging is rebuilt', async () => {
  const f = fixture(101);
  const open = Object.getOwnPropertyDescriptor(HubStorage.prototype, 'open')?.value as HubStorage['open'];
  try {
    const engine = f.engine();
    const good = await complete(engine);
    f.source.exec("UPDATE session SET title='Changed'");
    const legacy = new DatabaseSync(join(f.options.storagePath, `hub-${f.pointer().published!}.sqlite`));
    legacy.exec('PRAGMA user_version=2'); legacy.close();
    HubStorage.prototype.open = function (generation, writable, fresh = false) {
      const db = open.call(this, generation, writable, fresh);
      if (fresh) {
        const prepare = db.prepare.bind(db);
        db.prepare = (sql) => {
          if (sql.startsWith('INSERT INTO progress')) throw new Error('Synthetic initialization fault');
          return prepare(sql);
        };
      }
      return db;
    };
    assert.equal((await engine.tick()).generation, good.generation);
    HubStorage.prototype.open = open;
    const interrupted = f.pointer().building!;
    let db = f.read(interrupted);
    assert.equal(db.prepare('PRAGMA application_id').get()?.application_id, 0);
    assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='progress'").get(), undefined); db.close();
    assert.equal((await engine.tick()).complete, false);
    assert.equal(f.pointer().published, good.generation.split(':')[1]);
    const staged = f.pointer().building!;
    db = new DatabaseSync(join(f.options.storagePath, `hub-${staged}.sqlite`));
    db.exec('DELETE FROM progress'); db.close();
    assert.equal((await engine.tick()).complete, false);
    assert.equal((await complete(engine)).complete, true);
    assert.notEqual(f.pointer().published, staged);
  } finally { HubStorage.prototype.open = open; await f.close(); }
});
