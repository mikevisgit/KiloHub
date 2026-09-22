import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { test } from 'node:test';

import { HubIndexEngine } from '../../src/hubIndexEngine.js';
import { HubSource } from '../../src/hubSource.js';
import { HubStorage, type HubPointer } from '../../src/hubStorage.js';

function fixture(count = 2) {
  const root = mkdtempSync(join(tmpdir(), 'hub-sync08-synthetic-'));
  const options = { sourcePath: join(root, 'source.sqlite'), storagePath: join(root, 'hub') };
  const source = new DatabaseSync(options.sourcePath);
  source.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE session(id TEXT PRIMARY KEY,title TEXT NOT NULL,directory TEXT NOT NULL,parent_id TEXT,
      time_created INTEGER NOT NULL,time_updated INTEGER NOT NULL,time_archived INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,message_id TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE event_sequence(aggregate_id TEXT PRIMARY KEY,seq INTEGER,owner_id TEXT);`);
  function add(id: string) {
    source.prepare('INSERT INTO session VALUES (?,?,?,NULL,1,2,NULL)').run(id, 'title', `C:\\Synthetic\\${id}`);
    source.prepare('INSERT INTO message VALUES (?,?,?)').run(id, id, JSON.stringify({ role: 'user' }));
    source.prepare('INSERT INTO part VALUES (?,?,?,?)').run(id, id, id, JSON.stringify({ type: 'text', text: 'oldneedle' }));
    source.prepare("INSERT INTO event_sequence VALUES (?,1,'owner')").run(id);
  }
  source.exec('BEGIN');
  for (let index = 0; index < count; index++) add(`s${String(index).padStart(4, '0')}`);
  source.exec('COMMIT');
  const engines: HubIndexEngine[] = [];
  const pointer = () => JSON.parse(readFileSync(join(options.storagePath, 'hub-pointer.json'), 'utf8')) as HubPointer;
  return { source, options, add, pointer,
    engine() { const engine = new HubIndexEngine(options, () => 1024 * 1024 * 1024); engines.push(engine); return engine; },
    database() { return new DatabaseSync(join(options.storagePath, `hub-${pointer().published!}.sqlite`)); },
    edit(id: string, text: string, signal = true) {
      source.prepare('UPDATE part SET data=? WHERE id=?').run(JSON.stringify({ type: 'text', text }), id);
      if (signal) source.prepare('UPDATE event_sequence SET seq=seq+1 WHERE aggregate_id=?').run(id);
    },
    async close() { for (const engine of engines) await engine.close(); source.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

async function drain(engine: HubIndexEngine) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const snapshot = await engine.tick();
    assert.equal(snapshot.diagnostic, undefined);
    if (snapshot.complete) return snapshot;
  }
  throw new Error('Synthetic work did not drain');
}

void test('SYNC08 repeated source changes preserve partial publication, FIFO progress and restart; earlier ID is queued', async () => {
  const f = fixture(201);
  const texts = Object.getOwnPropertyDescriptor(HubSource.prototype, 'texts')?.value as HubSource['texts'];
  try {
    let churn = 0;
    HubSource.prototype.texts = async function* (id) {
      if (churn < 3) { f.edit('s0000', `versionneedle${++churn}`); }
      yield* texts.call(this, id);
    };
    const first = f.engine();
    const partial = await first.tick();
    assert.equal(partial.complete, false);
    assert.equal(partial.health, 'preparing');
    assert.equal((await first.search('oldneedle', 1)).matches.length, 100);
    const generation = partial.generation;
    f.add('a-before-cursor');
    await first.close();
    const restarted = f.engine();
    churn = 0;
    const next = await restarted.tick();
    assert.equal(next.generation, generation);
    assert.equal(next.complete, false);
    let db = f.database();
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get()?.n, 200); db.close();
    HubSource.prototype.texts = texts;
    const final = await drain(restarted);
    assert.equal(final.generation, generation);
    assert.ok(final.indexRevision > partial.indexRevision);
    db = f.database();
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get()?.n, 202);
    assert.ok(db.prepare("SELECT id FROM sessions WHERE id='a-before-cursor'").get()); db.close();
    assert.equal((await restarted.search('versionneedle3', 2)).matches.length, 1);
  } finally { HubSource.prototype.texts = texts; await f.close(); }
});

void test('SYNC08 ordinary poll touches only changed payload; no-work and full unchanged reconciliation do not rewrite or revise', async () => {
  const f = fixture(3);
  const texts = Object.getOwnPropertyDescriptor(HubSource.prototype, 'texts')?.value as HubSource['texts'];
  try {
    const engine = f.engine();
    await drain(engine);
    const db = f.database();
    db.exec(`CREATE TABLE audit(id TEXT);
      CREATE TABLE body_audit(id TEXT);
      CREATE TRIGGER audit_text_insert AFTER INSERT ON texts BEGIN INSERT INTO audit VALUES(new.session_id); END;
      CREATE TRIGGER audit_text_delete AFTER DELETE ON texts BEGIN INSERT INTO audit VALUES(old.session_id); END;
      CREATE TRIGGER audit_body_insert AFTER INSERT ON texts BEGIN INSERT INTO body_audit VALUES(new.session_id); END;
      CREATE TRIGGER audit_body_delete AFTER DELETE ON texts BEGIN INSERT INTO body_audit VALUES(old.session_id); END;
      CREATE TRIGGER audit_session_update AFTER INSERT ON sessions BEGIN INSERT INTO audit VALUES(new.id); END;`);
    const reads: string[] = [];
    HubSource.prototype.texts = async function* (id) { reads.push(id); yield* texts.call(this, id); };
    f.edit('s0001', 'newneedle');
    const changed = await drain(engine);
    assert.deepEqual([...new Set(reads)], ['s0001']);
    assert.deepEqual(db.prepare('SELECT DISTINCT id FROM audit').all().map((row) => row.id), ['s0001']);
    reads.length = 0; db.exec('DELETE FROM audit');
    const idle = await engine.tick();
    assert.equal(idle.indexRevision, changed.indexRevision);
    assert.deepEqual(reads, []);
    const full = await engine.tick(true);
    assert.equal(full.complete, true);
    assert.equal(full.indexRevision, idle.indexRevision);
    assert.deepEqual([...new Set(reads)].sort(), ['s0000', 's0001', 's0002']);
    assert.equal(db.prepare('SELECT count(*) n FROM audit').get()?.n, 0);
    reads.length = 0;
    f.edit('s0002', 'unloggedneedle', false);
    const reconciled = await engine.tick(true);
    assert.equal(reconciled.complete, true);
    assert.deepEqual(db.prepare('SELECT DISTINCT id FROM audit').all().map((row) => row.id), ['s0002']);
    assert.equal((await engine.search('unloggedneedle', 1)).matches.length, 1);
    db.exec('DELETE FROM body_audit');
    f.source.exec("UPDATE session SET title='renamedneedle',directory='C:\\Synthetic\\moved' WHERE id='s0001'");
    await drain(engine);
    assert.equal(db.prepare('SELECT count(*) n FROM body_audit').get()?.n, 0);
    assert.deepEqual((await engine.search('newneedle renamedneedle', 2)).matches,
      [{ folderId: 'c:\\synthetic\\moved', rank: 2 }]);
    db.close();
    const beforeRestart = await engine.tick();
    await engine.close();
    reads.length = 0;
    const afterRestart = await drain(f.engine());
    assert.equal(afterRestart.indexRevision, beforeRestart.indexRevision);
    assert.deepEqual(reads, []);
  } finally { HubSource.prototype.texts = texts; await f.close(); }
});

void test('SYNC08 failed membership census cannot delete; successful census removes archive and delete', async () => {
  const f = fixture(3);
  const sessions = Object.getOwnPropertyDescriptor(HubSource.prototype, 'sessions')?.value as HubSource['sessions'];
  try {
    const engine = f.engine();
    const good = await drain(engine);
    f.source.exec("DELETE FROM session WHERE id='s0000'; UPDATE session SET time_archived=3 WHERE id='s0001'");
    HubSource.prototype.sessions = async function* (after) {
      for await (const session of sessions.call(this, after)) { yield session; throw new Error('Synthetic census failure'); }
    };
    const failed = await engine.tick();
    assert.equal(failed.complete, false);
    assert.equal(failed.indexRevision, good.indexRevision);
    assert.equal((await engine.search('oldneedle', 1)).matches.length, 3);
    HubSource.prototype.sessions = sessions;
    assert.equal((await drain(engine)).complete, true);
    assert.equal((await engine.search('oldneedle', 2)).matches.length, 1);
    f.source.exec("UPDATE session SET time_archived=NULL WHERE id='s0001'");
    await drain(engine);
    assert.equal((await engine.search('oldneedle', 3)).matches.length, 2);
  } finally { HubSource.prototype.sessions = sessions; await f.close(); }
});

void test('SYNC08 interrupted session staging never leaks; completed versions remain searchable with revision fencing', async () => {
  const f = fixture(2);
  const texts = Object.getOwnPropertyDescriptor(HubSource.prototype, 'texts')?.value as HubSource['texts'];
  try {
    const engine = f.engine();
    const good = await drain(engine);
    f.edit('s0000', 'newneedle');
    let calls = 0;
    let during = false;
    HubSource.prototype.texts = async function* (id) {
      for await (const part of texts.call(this, id)) {
        yield part;
        if (++calls === 2) {
          const old = await engine.search('oldneedle', 1);
          assert.equal(old.indexRevision, good.indexRevision);
          assert.equal(old.matches.length, 2);
          assert.equal((await engine.search('newneedle', 2)).matches.length, 0);
          during = true;
          throw new Error('Synthetic staging fault');
        }
      }
    };
    const failed = await engine.tick();
    assert.equal(during, true);
    assert.equal(failed.complete, false);
    assert.equal(failed.indexRevision, good.indexRevision);
    assert.equal((await engine.search('oldneedle', 3)).matches.length, 2);
    HubSource.prototype.texts = texts;
    const recovered = await drain(engine);
    assert.ok(recovered.indexRevision > good.indexRevision);
    assert.equal((await engine.search('newneedle', 4)).matches.length, 1);
    // Simulate an in-place writer commit while search owns an older WAL snapshot.
    let checks = 0;
    await assert.rejects(engine.search('oldneedle', 5, () => {
      if (++checks === 3) { const db = f.database(); db.exec('UPDATE progress SET revision=revision+1'); db.close(); }
      return false;
    }), /^Error: index-changed$/);
  } finally { HubSource.prototype.texts = texts; await f.close(); }
});

void test('SYNC08 initial completed session survives a later failure in the same batch and remains searchable after restart', async () => {
  const f = fixture(3);
  try {
    f.source.exec("UPDATE message SET data='invalid synthetic JSON' WHERE id='s0001'");
    const first = f.engine();
    const failed = await first.tick();
    assert.equal(failed.complete, false);
    assert.equal(failed.diagnostic, 'source-unavailable');
    assert.equal((await first.search('oldneedle', 1)).matches.length, 1);
    await first.close();
    const restarted = f.engine();
    const stillFailed = await restarted.tick();
    assert.equal(stillFailed.generation, failed.generation);
    assert.equal(stillFailed.indexRevision, failed.indexRevision);
    assert.equal((await restarted.search('oldneedle', 2)).matches.length, 1);
    f.source.prepare('UPDATE message SET data=? WHERE id=?').run(JSON.stringify({ role: 'user' }), 's0001');
    assert.equal((await drain(restarted)).complete, true);
    assert.equal((await restarted.search('oldneedle', 3)).matches.length, 3);
  } finally { await f.close(); }
});

void test('SYNC08 moving a part between sessions cannot block an earlier queued replacement on a stale global part ID', async () => {
  const f = fixture(2);
  try {
    const engine = f.engine();
    f.edit('s0001', 'movingneedle');
    await drain(engine);
    f.source.exec("UPDATE part SET session_id='s0000',message_id='s0000' WHERE id='s0001'; UPDATE event_sequence SET seq=seq+1");
    assert.equal((await drain(engine)).complete, true);
    assert.deepEqual((await engine.search('movingneedle', 1)).matches,
      [{ folderId: 'c:\\synthetic\\s0000', rank: 2 }]);
    const db = f.database();
    assert.equal(db.prepare('SELECT count(*) n FROM texts').get()?.n, 2); db.close();
  } finally { await f.close(); }
});

void test('SYNC08 shared storage never displays or searches another source, including during replacement preparation', async () => {
  const first = fixture(1);
  const second = fixture(101);
  const reader = new HubIndexEngine({ ...second.options, storagePath: first.options.storagePath }, () => 1024 * 1024 * 1024);
  const absent = new HubIndexEngine({ ...second.options, storagePath: first.options.storagePath,
    sourcePath: `${second.options.sourcePath}.absent` });
  try {
    const writer = first.engine();
    await drain(writer);
    assert.deepEqual((await reader.tick()).folders, []);
    await assert.rejects(reader.search('oldneedle', 1), /^Error: search-unavailable$/);
    assert.deepEqual((await absent.tick()).folders, []);
    await assert.rejects(absent.search('oldneedle', 1), /^Error: search-unavailable$/);
    await writer.close();
    const partial = await reader.tick();
    assert.equal(partial.complete, false);
    assert.equal(partial.health, 'preparing');
    assert.deepEqual(partial.folders, []);
    await assert.rejects(reader.search('oldneedle', 2), /^Error: search-unavailable$/);
    const ready = await drain(reader);
    assert.equal(ready.folders.length, 101);
    assert.equal((await reader.search('oldneedle', 3)).matches.length, 101);
  } finally { await reader.close(); await absent.close(); await first.close(); await second.close(); }
});

void test('SYNC08 scratch census commits bounded 100-row/256-KiB chunks, not one transaction per metadata row', async () => {
  const f = fixture(201);
  const open = Object.getOwnPropertyDescriptor(HubStorage.prototype, 'open')?.value as HubStorage['open'];
  const sessions = Object.getOwnPropertyDescriptor(HubSource.prototype, 'sessions')?.value as HubSource['sessions'];
  const chunks: { rows: number; bytes: number }[] = [];
  try {
    f.source.exec("UPDATE session SET directory='C:\\Synthetic\\Shared'");
    const engine = f.engine();
    const good = await drain(engine);
    HubStorage.prototype.open = function (generation, writable, fresh = false) {
      const db = open.call(this, generation, writable, fresh);
      if (!writable) return db;
      const prepare = db.prepare.bind(db), exec = db.exec.bind(db);
      let rows = 0, bytes = 0;
      db.prepare = (sql) => {
        const statement = prepare(sql);
        if (sql === 'INSERT INTO census VALUES (?,?)') {
          const run = statement.run.bind(statement);
          statement.run = (...args: (SQLInputValue | Record<string, SQLInputValue>)[]) => {
            const result = Reflect.apply(run, statement, args) as ReturnType<typeof run>;
            assert.equal(typeof args[0], 'string'); assert.equal(typeof args[1], 'string');
            rows++; bytes += Buffer.byteLength(args[0] as string) + Buffer.byteLength(args[1] as string);
            return result;
          };
        }
        return statement;
      };
      db.exec = (sql) => {
        exec(sql);
        if (sql === 'COMMIT' && rows > 0) chunks.push({ rows, bytes });
        if (sql === 'COMMIT' || sql === 'ROLLBACK') { rows = 0; bytes = 0; }
      };
      return db;
    };
    const idle = await engine.tick();
    assert.equal(idle.indexRevision, good.indexRevision);
    assert.deepEqual(chunks.map((chunk) => chunk.rows), [100, 100, 1]);
    assert.ok(chunks.every((chunk) => chunk.bytes <= 256 * 1024));

    chunks.length = 0;
    f.source.exec("DELETE FROM session WHERE id='s0200'");
    HubSource.prototype.sessions = async function* (after) {
      let count = 0;
      for await (const session of sessions.call(this, after)) {
        yield session;
        if (++count === 125) throw new Error('Synthetic census failure inside second chunk');
      }
    };
    const failed = await engine.tick();
    assert.equal(failed.complete, false);
    assert.equal(failed.indexRevision, good.indexRevision);
    assert.deepEqual(chunks.map((chunk) => chunk.rows), [100]);
    const db = f.database();
    assert.equal(db.prepare('SELECT count(*) n FROM census').get()?.n, 100);
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get()?.n, 201);
    assert.equal(db.prepare('SELECT count(*) n FROM work').get()?.n, 0);
    db.close();
    HubSource.prototype.sessions = sessions;

    chunks.length = 0;
    f.source.prepare('UPDATE session SET title=?').run('\u754c'.repeat(1000));
    const partial = await engine.tick();
    assert.equal(partial.diagnostic, undefined);
    assert.equal(chunks.reduce((sum, chunk) => sum + chunk.rows, 0), 200);
    assert.ok(chunks.length > 2);
    assert.ok(chunks.every((chunk) => chunk.rows < 100 && chunk.bytes <= 256 * 1024));
  } finally { HubStorage.prototype.open = open; HubSource.prototype.sessions = sessions; await f.close(); }
});

void test('SYNC08 restart publishes committed initial rows after a commit-to-pointer fault before retrying a bad session', async () => {
  const f = fixture(2);
  const writePointer = Object.getOwnPropertyDescriptor(HubStorage.prototype, 'writePointer')?.value as HubStorage['writePointer'];
  try {
    f.source.exec("UPDATE message SET data='invalid synthetic JSON' WHERE id='s0001'");
    let interrupted = false;
    HubStorage.prototype.writePointer = function (pointer) {
      if (pointer.published !== null && !interrupted) {
        interrupted = true;
        throw new Error('Synthetic failure after session commit before initial publication');
      }
      writePointer.call(this, pointer);
    };
    const first = f.engine();
    assert.equal((await first.tick()).complete, false);
    assert.equal(interrupted, true);
    assert.equal(f.pointer().published, null);
    const building = f.pointer().building!;
    const db = new DatabaseSync(join(f.options.storagePath, `hub-${building}.sqlite`), { readOnly: true });
    const revision = db.prepare('SELECT revision FROM progress').get()?.revision;
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get()?.n, 1);
    assert.equal(db.prepare("SELECT id FROM work WHERE id='s0000'").get(), undefined);
    assert.ok(db.prepare("SELECT id FROM work WHERE id='s0001'").get()); db.close();
    await first.close();
    HubStorage.prototype.writePointer = writePointer;
    const restarted = f.engine();
    const failedNext = await restarted.tick();
    assert.equal(failedNext.complete, false);
    assert.equal(failedNext.diagnostic, 'source-unavailable');
    assert.equal(failedNext.indexRevision, revision);
    assert.equal(f.pointer().published, building);
    assert.equal((await restarted.search('oldneedle', 1)).matches.length, 1);
  } finally { HubStorage.prototype.writePointer = writePointer; await f.close(); }
});
