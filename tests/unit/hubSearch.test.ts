import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { Worker } from 'node:worker_threads';

import { HubIndexEngine } from '../../src/hubIndexEngine.js';
import { isHubIndexSnapshot, type HubIndexSnapshot } from '../../src/hubIndexProtocol.js';
import { HubIndexService } from '../../src/hubIndexService.js';
import { HubStorage, type HubPointer } from '../../src/hubStorage.js';
import { normalizeSearchText, parseSearchQuery } from '../../src/searchQuery.js';

function fixture(budget?: () => number) {
  const root = mkdtempSync(join(tmpdir(), 'hub-search-synthetic-'));
  const options = { sourcePath: join(root, 'source.sqlite'), storagePath: join(root, 'hub') };
  const source = new DatabaseSync(options.sourcePath);
  source.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE session(id TEXT PRIMARY KEY,title TEXT NOT NULL,directory TEXT NOT NULL,parent_id TEXT,
      time_created INTEGER NOT NULL,time_updated INTEGER NOT NULL,time_archived INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,message_id TEXT NOT NULL,data TEXT NOT NULL);`);
  const engine = new HubIndexEngine(options, budget);
  let id = 0;
  return { source, engine, options,
    add(folder: string, title: string, texts: readonly string[] = []) {
      const session = `s${String(++id).padStart(6, '0')}`;
      source.prepare('INSERT INTO session VALUES (?,?,?,NULL,1,?,NULL)').run(session, title, `C:\\pathonlymarker\\${folder}`, id);
      source.prepare('INSERT INTO message VALUES (?,?,?)').run(session, session, JSON.stringify({ role: 'user' }));
      for (const [index, text] of texts.entries()) source.prepare('INSERT INTO part VALUES (?,?,?,?)')
        .run(`${session}-${index}`, session, session, JSON.stringify({ type: 'text', text }));
    },
    pointer() { return JSON.parse(readFileSync(join(options.storagePath, 'hub-pointer.json'), 'utf8')) as HubPointer; },
    pointerPath: join(options.storagePath, 'hub-pointer.json'),
    hash() { return ['', '-wal'].map((suffix) => createHash('sha256').update(readFileSync(options.sourcePath + suffix)).digest('hex')); },
    async close() { await engine.close(); source.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

async function complete(engine: HubIndexEngine, force = false): Promise<HubIndexSnapshot> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const snapshot = await engine.tick(force && attempt === 0);
    assert.equal(snapshot.diagnostic, undefined);
    if (snapshot.complete) return snapshot;
  }
  throw new Error('Synthetic import deadline');
}

void test('shared parsing uses NFC/codepoints, literal punctuation, dedupe, and bounded raw input', () => {
  assert.equal(normalizeSearchText('\u0401 e\u0301'), '\u0435 \u00e9');
  for (const raw of ['ab', '\ud83d\ude00\ud83d\ude00', 'e\u0301xy ab', 'one x']) assert.deepEqual(parseSearchQuery(raw), { kind: 'invalid', reason: 'short-token' });
  assert.deepEqual(parseSearchQuery(' \t\n '), { kind: 'reset', normalized: '', tokens: [] });
  assert.deepEqual(parseSearchQuery(' ALPHA\nalpha\tbeta '), { kind: 'query', normalized: 'alpha beta', tokens: ['alpha', 'beta'] });
  for (const raw of ['\ud83d\ude00\ud83d\ude00\ud83d\ude00', 'e\u0301xy', '"%_', '*_*', 'a\0b']) assert.equal(parseSearchQuery(raw).kind, 'query');
  assert.deepEqual(parseSearchQuery(' '.repeat(4097)), { kind: 'invalid', reason: 'too-long' });
});

void test('FTS exact folder AND/ranks includes all titles, Unicode and literals but not paths or boundaries', async () => {
  const f = fixture();
  try {
    f.add('alpha-beta', 'neutral');
    f.add('alpha', 'beta');
    f.add('other', 'alpha', ['beta']);
    f.add('split', 'alpha'); f.add('split', 'beta');
    f.add('alone', 'alpha'); f.add('different', 'beta');
    f.add('old', 'ancientneedle');
    for (let index = 0; index < 4; index++) f.add('old', `latest ${index}`);
    f.add('literal', 'prefix\0titletail', ['prefix\0suffixneedle a\0b', '"quoted" 100% underscore_value star*value %_* """', '\u0401\u0436\u0438\u043a e\u0301xy \ud83d\ude00\ud83d\ude00\ud83d\ude00', 'bound', 'ary']);
    const before = f.hash();
    const snapshot = await complete(f.engine);
    const result = await f.engine.search('alpha beta', 7);
    assert.equal(result.generation, snapshot.generation); assert.equal(result.indexRevision, snapshot.indexRevision);
    assert.equal(result.queryGeneration, 7);
    assert.deepEqual(new Map(result.matches.map((match) => [match.folderId.split('\\').pop(), match.rank])),
      new Map([['alpha-beta', 0], ['alpha', 1], ['other', 2], ['split', 1]]));
    for (const query of ['ancientneedle', 'titletail', 'suffixneedle', 'a\0b', '"quoted"', '100%', 'underscore_', 'star*', '%_*', '"""', '\u0435\u0436\u0438\u043a', '\u00e9xy', '\ud83d\ude00\ud83d\ude00\ud83d\ude00']) {
      assert.equal((await f.engine.search(query, 1)).matches.length, 1, `Synthetic case ${JSON.stringify(query)}`);
    }
    for (const query of ['pathonlymarker', 'boundary', 'OR*']) assert.equal((await f.engine.search(query, 1)).matches.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /prefix|suffixneedle|quoted|texts|title/);
    assert.deepEqual(f.hash(), before);
    const reset = await f.engine.search('', 2); assert.equal(reset.matches.length, snapshot.folders.length);
    const read = new HubStorage(f.options.storagePath, f.options.sourcePath).open(f.pointer().published!, false);
    try { assert.throws(() => read.exec('DELETE FROM sessions'), /readonly|read.only/i); } finally { read.close(); }
  } finally { await f.close(); }
});

void test('completed partial sessions are searchable; stale last-good survives source ambiguity', async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 101; index++) f.add(`folder${index}`, 'oldneedle');
    assert.equal((await f.engine.tick()).complete, false);
    assert.equal((await f.engine.search('oldneedle', 1)).matches.length, 100);
    const good = await complete(f.engine);
    f.source.exec("UPDATE session SET title='newneedle'");
    assert.equal((await f.engine.tick(true)).complete, false);
    assert.equal((await f.engine.search('oldneedle', 2)).matches.length, 1);
    assert.equal((await f.engine.search('newneedle', 3)).matches.length, 100);
    const newer = await complete(f.engine);
    assert.equal(newer.generation, good.generation);
    assert.ok(newer.indexRevision > good.indexRevision);
    f.source.exec("CREATE TABLE session_message(session_id TEXT); INSERT INTO session_message SELECT id FROM session LIMIT 1");
    assert.equal((await f.engine.tick(true)).health, 'stale');
    assert.equal((await f.engine.search('newneedle', 4)).matches.length, 101);
    assert.equal((await f.engine.search('newneedle', 4)).generation, newer.generation);
  } finally { await f.close(); }
});

void test('legacy known own schema remains searchable while writer safely rebuilds FTS', async () => {
  const f = fixture();
  try {
    f.add('legacyname', 'legacytitle', ['legacytext\0tailneedle']);
    const good = await complete(f.engine);
    const old = f.pointer().published!;
    const db = new DatabaseSync(join(f.options.storagePath, `hub-${old}.sqlite`));
    db.exec('DROP TABLE search_fields; DROP TABLE search_rows; PRAGMA user_version=1'); db.close();
    for (const query of ['legacyname', 'legacytitle', 'tailneedle']) assert.equal((await f.engine.search(query, 1)).matches.length, 1);
    const rebuilt = await complete(f.engine);
    assert.notEqual(rebuilt.generation, good.generation);
    assert.equal((await f.engine.search('tailneedle', 2)).matches.length, 1);
  } finally { await f.close(); }
});

void test('row admission refusal retains last-good search and retries without skipping the source field', async () => {
  let budget = 1024 * 1024 * 1024;
  const f = fixture(() => budget);
  try {
    f.add('folder', 'title', ['oldneedle']);
    const good = await complete(f.engine);
    f.source.prepare('UPDATE part SET data=?').run(JSON.stringify({ type: 'text', text: 'newneedle'.repeat(20_000) }));
    budget = 64 * 1024 * 1024 + 4096;
    const failed = await f.engine.tick(true);
    assert.equal(failed.diagnostic, 'resource-refused');
    const retained = await f.engine.search('oldneedle', 1);
    assert.equal(retained.generation, good.generation); assert.equal(retained.matches.length, 1);
    assert.deepEqual((await f.engine.search('newneedle', 2)).matches, []);
    budget = 1024 * 1024 * 1024;
    await complete(f.engine);
    assert.equal((await f.engine.search('newneedle', 3)).matches.length, 1);
    assert.deepEqual((await f.engine.search('oldneedle', 4)).matches, []);
  } finally { await f.close(); }
});

void test('service rejects untrusted result/error payloads and obsolete revisions without relaying corpus', async () => {
  const service = new HubIndexService('unused-synthetic-storage', undefined, undefined, true);
  const messages: { requestId?: number; type?: string }[] = [];
  Object.defineProperty(service, 'worker', { writable: true, value: { postMessage: (message: { requestId?: number; type?: string }) => messages.push(message) } });
  const transport = service as unknown as { searchMessage(message: unknown): void };
  try {
    assert.deepEqual(await service.search(' \n ', 0), { generation: '', indexRevision: 0, queryGeneration: 0, matches: [] });
    assert.equal(messages.length, 0);
    const first = service.search('needle', 1);
    transport.searchMessage({ type: 'search-error', requestId: messages.at(-1)?.requestId, code: 'PRIVATE SQL STACK' });
    await assert.rejects(first, /^Error: search-unavailable$/);
    const second = service.search('needle', 1);
    transport.searchMessage({ type: 'search-result', requestId: messages.at(-1)?.requestId,
      result: { generation: 'obsolete', indexRevision: 1, queryGeneration: 1, matches: [] } });
    await assert.rejects(second, /^Error: index-changed$/);
    const third = service.search('needle', 1);
    transport.searchMessage({ type: 'search-result', requestId: messages.at(-1)?.requestId,
      result: { generation: '', indexRevision: 0, queryGeneration: 1, matches: [{ folderId: 'unsupported', rank: 0 }] } });
    await assert.rejects(third, /^Error: search-unavailable$/);
  } finally { Object.defineProperty(service, 'worker', { value: undefined }); await service.stop(); }
});

void test('invalid requests never open storage; cooperative cancellation and revision change discard results', async () => {
  const f = fixture();
  const open = Object.getOwnPropertyDescriptor(HubStorage.prototype, 'open')?.value as HubStorage['open'];
  try {
    HubStorage.prototype.open = () => { throw new Error('Must not open'); };
    await assert.rejects(f.engine.search('ab', 1), /^Error: invalid-query$/);
    await assert.rejects(f.engine.search('x'.repeat(4097), 1), /^Error: invalid-query$/);
    HubStorage.prototype.open = open;
    f.add('folder', 'needle');
    await complete(f.engine);
    let checks = 0;
    await assert.rejects(f.engine.search('needle', 1, () => ++checks > 2), /^Error: search-cancelled$/);
    const pointer = f.pointer(); checks = 0;
    try {
      await assert.rejects(f.engine.search('needle', 1, () => {
        if (++checks === 3) writeFileSync(f.pointerPath, JSON.stringify({ ...pointer, published: null }));
        return false;
      }), /^Error: index-changed$/);
    } finally { writeFileSync(f.pointerPath, JSON.stringify(pointer)); }
    assert.equal((await f.engine.search('needle', 1)).matches.length, 1);
  } finally { HubStorage.prototype.open = open; await f.close(); }
});

void test('Windows GC retains a retired generation while read-only search owns a snapshot and retries after close', async () => {
  const f = fixture();
  try {
    f.add('folder', 'firstneedle');
    await complete(f.engine);
    const old = f.pointer().published!;
    const path = join(f.options.storagePath, `hub-${old}.sqlite`);
    const legacy = new DatabaseSync(path);
    legacy.exec('PRAGMA user_version=2'); legacy.close();
    const read = new HubStorage(f.options.storagePath, f.options.sourcePath).open(old, false);
    try {
      read.exec('BEGIN');
      assert.equal(read.prepare('SELECT count(*) n FROM sessions').get()?.n, 1);
      f.source.exec("UPDATE session SET title='secondneedle'");
      await complete(f.engine, true);
      await f.engine.tick();
      assert.equal(existsSync(path), true);
      assert.ok(f.pointer().retired.includes(old));
      assert.equal(read.prepare('SELECT title FROM sessions').get()?.title, 'firstneedle');
    } finally { read.close(); }
    await f.engine.tick();
    assert.equal(existsSync(path), false);
    assert.equal((await f.engine.search('secondneedle', 1)).matches.length, 1);
  } finally { await f.close(); }
});

void test('service separates request IDs from reload generation, validates messages, cancels and cleans pending stop', async () => {
  const f = fixture();
  const previousDb = process.env.KILO_DB, previousSynthetic = process.env.KILO_HUB_SYNTHETIC_TEST;
  const service = new HubIndexService(f.options.storagePath, undefined, undefined, true);
  try {
    f.add('folder', 'needle', ['PRIVATE-SYNTHETIC-CORPUS']);
    process.env.KILO_DB = f.options.sourcePath; process.env.KILO_HUB_SYNTHETIC_TEST = '1';
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Synthetic worker deadline')), 15_000);
      service.subscribe((snapshot) => {
        if (snapshot.complete) { clearTimeout(timeout); resolve(); }
        if (snapshot.diagnostic) { clearTimeout(timeout); reject(new Error(snapshot.diagnostic)); }
      });
      service.start();
    });
    assert.equal(isHubIndexSnapshot(service.snapshot), true);
    assert.equal(isHubIndexSnapshot({ type: 'search-result', result: {} }), false);
    assert.equal(isHubIndexSnapshot({ ...service.snapshot, texts: 'forbidden' }), false);
    const first = service.search('needle', 9);
    const rejected = assert.rejects(first, /^Error: search-cancelled$/);
    const next = service.search('needle', 1);
    await rejected;
    const result = await next;
    assert.equal(result.queryGeneration, 1); assert.equal(result.matches.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|CORPUS/);
    await assert.rejects(service.search('ab', 2), /^Error: invalid-query$/);
    const dying = service.search('needle', 2);
    const exited = assert.rejects(dying, /^Error: search-unavailable$/);
    const worker = Object.getOwnPropertyDescriptor(service, 'worker')?.value as Worker;
    await worker.terminate(); await exited;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Synthetic restart deadline')), 15_000);
      const subscription = service.subscribe((snapshot) => {
        if (snapshot.complete) { clearTimeout(timeout); subscription.dispose(); resolve(); }
      });
      service.start();
    });
    const pending = service.search('needle', 3);
    const stopped = assert.rejects(pending, /^Error: search-cancelled$/);
    await service.stop(); await stopped;
  } finally {
    await service.stop();
    if (previousDb === undefined) delete process.env.KILO_DB; else process.env.KILO_DB = previousDb;
    if (previousSynthetic === undefined) delete process.env.KILO_HUB_SYNTHETIC_TEST; else process.env.KILO_HUB_SYNTHETIC_TEST = previousSynthetic;
    await f.close();
  }
});
