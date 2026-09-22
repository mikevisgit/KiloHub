import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, linkSync, mkdtempSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { fileIdentity, HUB_APPLICATION_ID, HubStorage, type HubPointer } from '../../src/hubStorage.js';

async function fixture(version = 1) {
  const root = mkdtempSync(join(tmpdir(), 'hub-integrity-synthetic-'));
  const source = join(root, 'source.sqlite');
  new DatabaseSync(source).close();
  const storage = new HubStorage(join(root, 'hub'), source);
  assert.equal(await storage.claim(), true);
  const generation = randomUUID();
  const identity = storage.reserve(generation);
  const pointer: HubPointer = { format: 1, incarnation: randomUUID(), published: generation,
    building: null, retired: [], identities: { [generation]: identity } };
  storage.writePointer(pointer);
  const database = storage.open(generation, true, true);
  database.exec(`PRAGMA application_id=${HUB_APPLICATION_ID}; PRAGMA user_version=${version};
    CREATE TABLE progress(fingerprint TEXT,source_identity TEXT,cursor TEXT,complete INTEGER,owner TEXT,revision INTEGER);
    CREATE TABLE sessions(id TEXT,title TEXT,title_fold TEXT,title_norm TEXT,directory TEXT,folder TEXT,
      created INTEGER,updated INTEGER,id_fold TEXT,sequence INTEGER);
    CREATE TABLE texts(id TEXT,session_id TEXT,message_id TEXT,text TEXT);`);
  database.prepare('INSERT INTO progress VALUES (?,?,?,1,?,1)').run('a'.repeat(64), 'synthetic', '', randomUUID());
  if (version >= 2) database.exec(`CREATE VIRTUAL TABLE search_fields USING fts5(text,folder UNINDEXED,field_rank UNINDEXED,session_id UNINDEXED,has_nul UNINDEXED,tokenize='trigram');
    CREATE TABLE search_rows(row_id INTEGER,session_id TEXT,has_nul INTEGER);`);
  if (version === 3) database.exec(`
    CREATE TABLE versions(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,content TEXT NOT NULL);
    CREATE TABLE work(order_id INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,full INTEGER NOT NULL);
    CREATE TABLE sync_state(last_full INTEGER NOT NULL,full_scan INTEGER NOT NULL);
    INSERT INTO sync_state VALUES (0,0);
    CREATE TABLE census(id TEXT PRIMARY KEY,metadata TEXT NOT NULL);
    CREATE TABLE staged_texts(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,message_id TEXT NOT NULL,text TEXT NOT NULL);`);
  database.close();
  // Preserve the native method and invoke it with its original receiver below.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const prepare = DatabaseSync.prototype.prepare;
  let checks = 0;
  let failRead = false;
  DatabaseSync.prototype.prepare = function (sql: string) {
    if (sql === 'PRAGMA quick_check') checks += 1;
    if (failRead && sql === 'SELECT * FROM progress') { failRead = false; throw new Error('synthetic read failure'); }
    return prepare.call(this, sql);
  };
  return { root, source, storage, generation, pointer, path: storage.path(generation),
    checks: () => checks,
    failRead: () => { failRead = true; },
    read: () => { storage.open(generation, false).close(); },
    async close() {
      DatabaseSync.prototype.prepare = prepare;
      await storage.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

void test('first open checks integrity once; repeated read-only opens retain guards for schemas 1/2/3', async () => {
  for (const version of [1, 2, 3]) {
    const f = await fixture(version);
    try {
      assert.equal(f.checks(), 0);
      f.read(); f.read(); f.read();
      assert.equal(f.checks(), 1);
      const reader = f.storage.open(f.generation, false);
      try { assert.throws(() => reader.exec('DELETE FROM texts'), /readonly/i); }
      finally { reader.close(); }
      const second = new HubStorage(f.storage.directory, f.source);
      try { second.open(f.generation, false).close(); assert.equal(f.checks(), 2); }
      finally { await second.close(); }
    } finally { await f.close(); }
  }
});

void test('schema3 cache hits validate sync singleton and accept incomplete valid progress', async () => {
  const f = await fixture(3);
  try {
    f.read();
    const db = f.storage.open(f.generation, true);
    try {
      db.exec('UPDATE progress SET complete=0');
      f.read(); assert.equal(f.checks(), 1);
      db.exec('INSERT INTO sync_state VALUES (0,0)');
      assert.throws(f.read, /storage-unavailable/);
      db.exec('DELETE FROM sync_state WHERE rowid=2');
      f.read(); assert.equal(f.checks(), 2);
      db.exec('UPDATE sync_state SET full_scan=2');
      assert.throws(f.read, /storage-unavailable/);
    } finally { db.close(); }
  } finally { await f.close(); }
});

void test('explicit generation/all invalidation and schema changes require a new actual quick_check', async () => {
  const f = await fixture();
  try {
    f.read();
    f.storage.invalidateIntegrity(randomUUID()); f.read();
    assert.equal(f.checks(), 1);
    f.storage.invalidateIntegrity(f.generation); f.read(); f.read();
    assert.equal(f.checks(), 2);
    f.storage.invalidateIntegrity(); f.read();
    assert.equal(f.checks(), 3);
    const db = f.storage.open(f.generation, true);
    db.exec('CREATE INDEX synthetic_index ON texts(session_id)'); db.close();
    f.read(); f.read();
    assert.equal(f.checks(), 4);
  } finally { await f.close(); }
});

void test('read failures invalidate cached integrity; singleton progress is validated on cache hits', async () => {
  const f = await fixture();
  try {
    f.read(); f.failRead();
    assert.throws(f.read, /synthetic read failure/);
    f.read(); assert.equal(f.checks(), 2);
    const db = f.storage.open(f.generation, true);
    try {
      db.exec('INSERT INTO progress SELECT * FROM progress');
      assert.throws(f.read, /storage-unavailable/);
      db.exec('DELETE FROM progress WHERE rowid=(SELECT max(rowid) FROM progress)');
      f.read(); assert.equal(f.checks(), 3);
      db.exec('ALTER TABLE texts RENAME COLUMN text TO unexpected');
      assert.throws(f.read, /storage-unavailable/);
    } finally { db.close(); }
  } finally { await f.close(); }
});

void test('replaced generation is refused until its physical identity is registered and checked again', async () => {
  const f = await fixture();
  try {
    f.read();
    const previous = join(f.root, 'previous.sqlite');
    renameSync(f.path, previous); copyFileSync(previous, f.path);
    assert.throws(f.read, /storage-unsafe/);
    assert.equal(f.checks(), 1);
    f.storage.writePointer({ ...f.pointer, identities: { [f.generation]: fileIdentity(f.path) } });
    f.read(); f.read(); assert.equal(f.checks(), 2);
  } finally { await f.close(); }
});

void test('cached opens still deny source main/sidecar hardlinks, path aliases and unowned writes', async () => {
  const f = await fixture();
  try {
    f.read();
    const unowned = new HubStorage(f.storage.directory, f.source);
    try { assert.throws(() => unowned.open(f.generation, true), /storage-unsafe/); }
    finally { await unowned.close(); }
    const alias = new HubStorage(f.storage.directory, f.path);
    try { assert.throws(() => alias.open(f.generation, false), /storage-unsafe/); }
    finally { await alias.close(); }
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const origin = f.source + suffix;
      if (!suffix) unlinkSync(origin);
      linkSync(f.path, origin);
      assert.throws(f.read, /storage-unsafe/);
      unlinkSync(origin);
    }
    new DatabaseSync(f.source).close();
    linkSync(f.source, f.path + '-wal');
    assert.throws(f.read, /storage-unsafe/);
    unlinkSync(f.path + '-wal');
    f.read(); assert.equal(f.checks(), 2);
  } finally { await f.close(); }
});

void test('a registered replacement invalidates integrity by identity without a preceding failed open', async () => {
  const f = await fixture();
  try {
    f.read();
    const identity = fileIdentity(f.path);
    const previous = join(f.root, 'registered-previous.sqlite');
    renameSync(f.path, previous);
    copyFileSync(previous, f.path);
    const replacement = fileIdentity(f.path);
    assert.notEqual(replacement, identity);
    f.storage.writePointer({ ...f.pointer, identities: { [f.generation]: replacement } });
    assert.equal(f.checks(), 1);
    f.read();
    assert.equal(f.checks(), 2, 'physical replacement alone must invalidate the successful cache');
    f.read();
    assert.equal(f.checks(), 2, 'unchanged replacement is cached after its first check');
  } finally { await f.close(); }
});
