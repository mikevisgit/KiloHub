import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { win32 } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';

import type { HubIndexOptions, HubIndexSnapshot, HubSearchResult } from './hubIndexProtocol.js';
import { normalizeSearchText, parseSearchQuery } from './searchQuery.js';
import { HubSource, normalizeIndexText, type SourceSession } from './hubSource.js';
import { fileIdentity, HUB_APPLICATION_ID, HubFailure, HubStorage, type HubPointer } from './hubStorage.js';
import { normalizeWindowsDirectory, projectSessions } from './projection.js';
import { presentFolders } from './presentation.js';
import { isHubFolderArray } from './webviewProtocol.js';
import { isAvailableLocalDirectory } from './windowsPathSafety.js';
import type { RawSessionMetadata } from './types.js';

interface Progress {
  fingerprint: string;
  source_identity: string;
  cursor: string;
  complete: number;
  owner: string;
  revision: number;
}

export class HubIndexEngine {
  private readonly storage: HubStorage;
  private readonly owner = randomUUID();
  private owned = false;
  private disposed = false;
  private inFlight: Promise<HubIndexSnapshot> | undefined;
  private lastSnapshot: HubIndexSnapshot = {
    generation: '', indexRevision: 0, complete: false, health: 'preparing', folders: [],
  };

  public constructor(private readonly options: HubIndexOptions, private readonly memoryBudget?: () => number) {
    this.storage = new HubStorage(options.storagePath, options.sourcePath);
  }

  public async close(): Promise<void> {
    this.disposed = true;
    await this.inFlight;
    await this.storage.close();
  }
  public get hasPendingWork(): boolean {
    return this.owned && this.lastSnapshot.health === 'preparing' && !this.lastSnapshot.diagnostic;
  }

  private check(): void {
    if (this.disposed) throw new HubFailure('worker-unavailable');
    this.storage.assertOwner();
  }

  private begin(db: DatabaseSync): void {
    this.check();
    this.storage.assertWritable(db);
    db.exec('BEGIN IMMEDIATE');
    if (db.prepare('SELECT owner FROM progress').get()?.owner !== this.owner) {
      db.exec('ROLLBACK');
      throw new HubFailure('storage-unsafe');
    }
  }

  private verifyPublication(db: DatabaseSync, generation: string): void {
    this.storage.invalidateIntegrity(generation);
    const verified = this.storage.open(generation, false); verified.close();
    this.begin(db);
    db.prepare("INSERT INTO search_fields(search_fields) VALUES ('integrity-check')").run();
    db.exec('COMMIT');
  }

  private fresh(generation: string, fingerprint: string, sourceIdentity: string, revision: number): void {
    const db = this.storage.open(generation, true, true);
    try {
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;
        PRAGMA application_id=${HUB_APPLICATION_ID}; PRAGMA user_version=3;
        CREATE TABLE progress(fingerprint TEXT NOT NULL,source_identity TEXT NOT NULL,cursor TEXT NOT NULL,complete INTEGER NOT NULL,
          owner TEXT NOT NULL,revision INTEGER NOT NULL);
        CREATE TABLE sessions(id TEXT PRIMARY KEY, title TEXT NOT NULL,title_fold TEXT NOT NULL,title_norm TEXT NOT NULL,
          directory TEXT NOT NULL,folder TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,
          id_fold TEXT NOT NULL,sequence TEXT NOT NULL);
        CREATE INDEX session_folder ON sessions(folder);
        CREATE TABLE texts(id TEXT NOT NULL,session_id TEXT NOT NULL,message_id TEXT NOT NULL,text TEXT NOT NULL,
          PRIMARY KEY(session_id,id));
        CREATE INDEX text_session ON texts(session_id);
        CREATE TABLE versions(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,content TEXT NOT NULL);
        CREATE TABLE work(order_id INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,full INTEGER NOT NULL);
        CREATE TABLE sync_state(last_full INTEGER NOT NULL,full_scan INTEGER NOT NULL);
        INSERT INTO sync_state VALUES (0,0);
        CREATE TABLE census(id TEXT PRIMARY KEY,metadata TEXT NOT NULL);
        CREATE TABLE staged_texts(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,message_id TEXT NOT NULL,text TEXT NOT NULL);
        CREATE TABLE search_rows(row_id INTEGER PRIMARY KEY,session_id TEXT NOT NULL,has_nul INTEGER NOT NULL);
        CREATE INDEX search_session ON search_rows(session_id);
        CREATE INDEX search_nul ON search_rows(has_nul);
        CREATE VIRTUAL TABLE search_fields USING fts5(text,folder UNINDEXED,field_rank UNINDEXED,session_id UNINDEXED,has_nul UNINDEXED,tokenize='trigram');`);
      db.prepare('INSERT INTO progress VALUES (?,?,\'\',0,?,?)').run(fingerprint, sourceIdentity, this.owner, revision);
      db.exec('COMMIT');
    } finally {
      try { db.exec('ROLLBACK'); } catch { /* Successful initialization already committed. */ }
      db.close();
    }
  }

  /** One bounded batch. No text or raw source error leaves this engine. */
  public tick(forceFull = false): Promise<HubIndexSnapshot> {
    if (this.inFlight) return this.inFlight;
    const operation = this.performTick(forceFull);
    this.inFlight = operation;
    void operation.finally(() => { if (this.inFlight === operation) this.inFlight = undefined; });
    return operation;
  }

  private async performTick(forceFull: boolean): Promise<HubIndexSnapshot> {
    let source: HubSource | undefined;
    let db: DatabaseSync | undefined;
    try {
      if (this.disposed) return this.lastSnapshot;
      if (!this.owned) this.owned = await this.storage.claim();
      let pointer = this.storage.readPointer();
      if (!this.owned) {
        if (pointer?.published) return await this.snapshot(pointer, pointer.building !== null);
        return this.lastSnapshot;
      }
      this.check();
      if (!pointer) {
        pointer = { format: 1, incarnation: randomUUID(), published: null, building: null, identities: {}, retired: [] };
        this.storage.writePointer(pointer);
      }
      pointer = this.storage.collect(pointer);
      this.storage.writePointer(pointer);
      source = new HubSource(this.options, this.memoryBudget);
      let generation = pointer.building ?? pointer.published;
      let revision = 1;
      if (generation) {
        try {
          db = this.storage.open(generation, true);
          const saved = db.prepare('SELECT * FROM progress').get() as unknown as Progress;
          revision = saved.revision + 1;
          if (db.prepare('PRAGMA user_version').get()?.user_version !== 3 || saved.source_identity !== source.identity) {
            db.close(); db = undefined;
          }
        } catch (error) {
          this.storage.invalidateIntegrity(generation);
          if (error instanceof HubFailure && error.code === 'storage-unsafe') throw error;
          if (db) { db.close(); db = undefined; }
        }
      }
      if (!db) {
        if (!Number.isSafeInteger(revision)) throw new HubFailure('storage-unavailable');
        const retired = pointer.building && pointer.building !== pointer.published
          ? [...pointer.retired, pointer.building] : pointer.retired;
        generation = randomUUID();
        const identity = this.storage.reserve(generation);
        pointer = { ...pointer, building: generation, retired,
          identities: { ...pointer.identities, [generation]: identity } };
        this.storage.writePointer(pointer);
        this.fresh(generation, createHash('sha256').update(source.identity).digest('hex'), source.identity, revision);
        db = this.storage.open(generation, true);
      }
      if (!generation) throw new HubFailure('storage-unavailable');
      // A new pipe owner adopts durable progress only after opening its recognized database.
      this.check();
      this.storage.assertWritable(db);
      db.prepare('UPDATE progress SET owner=?').run(this.owner);
      // Recover the commit-to-pointer crash window before a later bad session can block publication.
      if (pointer.published === null && db.prepare('SELECT 1 FROM sessions LIMIT 1').get()) {
        const recovered = await this.snapshot({ ...pointer, published: generation, diagnostic: undefined }, true, false);
        const verification = new HubSource(this.options, this.memoryBudget);
        try { verification.assertIdentity(); if (verification.identity !== source.identity) throw new HubFailure('source-unavailable'); }
        finally { verification.close(); }
        this.verifyPublication(db, generation);
        source.assertIdentity();
        pointer = { ...pointer, published: generation, building: generation, diagnostic: undefined };
        this.storage.writePointer(pointer);
        this.lastSnapshot = recovered;
      }
      const state = db.prepare('SELECT * FROM sync_state').get()!;
      const full = state.full_scan === 0 && (forceFull || Date.now() - Number(state.last_full) >= 300_000);
      // A partial census is only scratch space. It cannot enqueue removals or advance coverage.
      this.begin(db); db.exec('DELETE FROM census'); db.exec('COMMIT');
      let censusRows = 0, censusBytes = 0;
      for await (const session of source.sessions()) {
        const metadata = JSON.stringify(session);
        const bytes = Buffer.byteLength(session.id) + Buffer.byteLength(metadata);
        if (censusRows > 0 && censusBytes + bytes > 256 * 1024) {
          this.check(); this.storage.assertWritable(db); source.assertIdentity();
          db.exec('COMMIT'); censusRows = 0; censusBytes = 0;
        }
        if (censusRows === 0) this.begin(db);
        this.check(); this.storage.assertWritable(db);
        db.prepare('INSERT INTO census VALUES (?,?)').run(session.id, metadata);
        censusRows++; censusBytes += bytes;
        // A separately admitted oversized field remains whole, in its own transaction.
        if (censusRows === 100 || censusBytes >= 256 * 1024) {
          this.check(); this.storage.assertWritable(db); source.assertIdentity();
          db.exec('COMMIT'); censusRows = 0; censusBytes = 0;
        }
      }
      source.assertIdentity();
      if (censusRows > 0) { this.check(); this.storage.assertWritable(db); db.exec('COMMIT'); }
      this.begin(db);
      db.prepare(`INSERT INTO work(id,full) SELECT c.id,? FROM census c LEFT JOIN versions v ON v.id=c.id
        WHERE ?=1 OR v.id IS NULL OR v.metadata!=c.metadata
        ON CONFLICT(id) DO UPDATE SET full=max(work.full,excluded.full)`).run(Number(full), Number(full));
      db.exec(`INSERT OR IGNORE INTO work(id,full) SELECT id,0 FROM versions WHERE id NOT IN (SELECT id FROM census)`);
      if (full) db.exec('UPDATE sync_state SET full_scan=1');
      if (db.prepare('SELECT 1 FROM work LIMIT 1').get()) db.exec('UPDATE progress SET complete=0');
      db.exec('COMMIT');

      // FIFO survives restarts and new IDs before any previous cursor. A busy dialog cannot reset other work.
      const work = db.prepare('SELECT id FROM work ORDER BY order_id LIMIT 100').all();
      for (const item of work) {
        const id = String(item.id);
        const metadata = db.prepare('SELECT metadata FROM census WHERE id=?').get(id)?.metadata;
        const session = typeof metadata === 'string' ? JSON.parse(metadata) as SourceSession : undefined;
        const directory = session && normalizeWindowsDirectory(session.directory);
        const previous = db.prepare('SELECT metadata,content FROM versions WHERE id=?').get(id);
        const hash = createHash('sha256');
        if (directory) for await (const part of source.texts(id)) hash.update(JSON.stringify(part));
        const content = hash.digest('hex');
        const changed = session ? previous?.metadata !== metadata || previous?.content !== content : previous !== undefined;
        const replaceTexts = previous?.content !== content || !directory;
        const replaceFields = replaceTexts || db.prepare('SELECT folder FROM sessions WHERE id=?').get(id)?.folder !== directory?.key;
        if (changed && directory && replaceTexts) {
          this.begin(db); db.exec('DELETE FROM staged_texts'); db.exec('COMMIT');
          for await (const part of source.texts(id)) {
            this.begin(db);
            db.prepare('INSERT INTO staged_texts VALUES (?,?,?,?)').run(part.id, id, part.messageId, part.text);
            db.exec('COMMIT');
          }
        }
        source.assertIdentity();
        this.begin(db);
        let committedSnapshot: HubIndexSnapshot | undefined;
        if (changed) {
          if (replaceTexts) db.prepare('DELETE FROM texts WHERE session_id=?').run(id);
          if (replaceFields) {
            db.prepare('DELETE FROM search_fields WHERE rowid IN (SELECT row_id FROM search_rows WHERE session_id=?)').run(id);
            db.prepare('DELETE FROM search_rows WHERE session_id=?').run(id);
          } else {
            const fields = db.prepare(`SELECT row_id FROM search_rows r JOIN search_fields f ON f.rowid=r.row_id
              WHERE r.session_id=? AND f.field_rank!=2`).all(id);
            for (const field of fields) {
              db.prepare('DELETE FROM search_fields WHERE rowid=?').run(field.row_id);
              db.prepare('DELETE FROM search_rows WHERE row_id=?').run(field.row_id);
            }
          }
          db.prepare('DELETE FROM sessions WHERE id=?').run(id);
          if (session && directory) {
            db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)')
              .run(id, session.title, (session.title.trim() ? session.title : 'Без названия').toLowerCase(),
                normalizeIndexText(session.title), directory.path, directory.key, session.created, session.updated,
                id.toLowerCase(), session.sequence);
            if (replaceTexts) db.exec('INSERT INTO texts SELECT * FROM staged_texts');
            if (replaceFields) {
              const inserted = db.prepare(`INSERT INTO search_fields(text,folder,field_rank,session_id,has_nul)
                SELECT text,?,2,session_id,instr(text,char(0))>0 FROM texts WHERE session_id=?`).run(directory.key, id);
              db.prepare(`INSERT INTO search_rows SELECT rowid,session_id,has_nul FROM search_fields
                WHERE rowid>? AND rowid<=?`).run(BigInt(inserted.lastInsertRowid) - BigInt(inserted.changes), inserted.lastInsertRowid);
            }
            this.insertSearchField(db, normalizeSearchText(win32.basename(directory.path)), directory.key, 0, id);
            this.insertSearchField(db, normalizeSearchText(session.title), directory.key, 1, id);
          }
          if (session) db.prepare('INSERT OR REPLACE INTO versions VALUES (?,?,?)').run(id, metadata!, content);
          else db.prepare('DELETE FROM versions WHERE id=?').run(id);
          const next = Number(db.prepare('SELECT revision FROM progress').get()?.revision) + 1;
          if (!Number.isSafeInteger(next)) throw new HubFailure('storage-unavailable');
          db.prepare('UPDATE progress SET revision=?').run(next);
          // Validate the candidate in this transaction. A display/resource failure rolls back to last-good.
          committedSnapshot = await this.snapshot({ ...pointer, published: generation, diagnostic: undefined }, true, false, db);
        }
        db.prepare('UPDATE progress SET cursor=?').run(id);
        db.prepare('DELETE FROM work WHERE id=?').run(id);
        this.check(); this.storage.assertWritable(db); source.assertIdentity();
        db.exec('COMMIT');
        if (pointer.published === null && committedSnapshot) {
          const verification = new HubSource(this.options, this.memoryBudget);
          try { verification.assertIdentity(); if (verification.identity !== source.identity) throw new HubFailure('source-unavailable'); }
          finally { verification.close(); }
          this.verifyPublication(db, generation);
          source.assertIdentity();
          pointer = { ...pointer, published: generation, building: generation, diagnostic: undefined };
          this.storage.writePointer(pointer);
          this.lastSnapshot = committedSnapshot;
        }
      }
      const pending = db.prepare('SELECT 1 FROM work LIMIT 1').get() !== undefined;
      this.begin(db);
      db.prepare('UPDATE progress SET complete=?').run(Number(!pending));
      if (!pending && (full || state.full_scan === 1)) {
        db.prepare('UPDATE sync_state SET last_full=?,full_scan=0').run(Date.now());
      }
      db.exec('COMMIT');
      // Recheck structural/identity/DB-09 safety, not global quietness, before publishing completed versions.
      const verification = new HubSource(this.options, this.memoryBudget);
      try { verification.assertIdentity(); if (verification.identity !== source.identity) throw new HubFailure('source-unavailable'); }
      finally { verification.close(); }
      pointer = { ...pointer, diagnostic: undefined, building: pending ? generation : null };
      if (pointer.published === generation || pointer.published === null || !pending) {
        if (pointer.published !== generation) {
          this.verifyPublication(db, generation);
          pointer = { ...pointer, published: generation,
            retired: pointer.published ? [...pointer.retired, pointer.published] : pointer.retired };
        }
      } else pointer = { ...pointer, building: generation };
      const candidate = await this.snapshot(pointer, pending, false);
      source.assertIdentity();
      this.storage.writePointer(pointer);
      this.lastSnapshot = candidate;
      return candidate;
    } catch (error) {
      if (!(error instanceof HubFailure) || error.code === 'storage-unavailable') this.storage.invalidateIntegrity();
      if (db) { try { db.exec('ROLLBACK'); } catch { /* Keep completed transactions only. */ } }
      const diagnostic = error instanceof HubFailure ? error.code : 'storage-unavailable';
      // Best effort last-good read on startup too; errors never synthesize empty successful results.
      try {
        const pointer = this.storage.readPointer();
        if (pointer?.published) await this.snapshot(pointer, true);
        if (pointer && this.owned) this.storage.writePointer({ ...pointer, diagnostic });
      } catch { /* Retain the last safe metadata snapshot. */ }
      this.lastSnapshot = { ...this.lastSnapshot, complete: false,
        health: this.lastSnapshot.generation ? 'stale' : 'unavailable', diagnostic };
      return this.lastSnapshot;
    } finally {
      source?.close();
      if (db) { try { db.exec('ROLLBACK'); } catch { /* No active transaction. */ } db.close(); }
    }
  }

  private insertSearchField(db: DatabaseSync, text: string, folder: string, rank: number, session: string): void {
    const nul = Number(text.includes('\0'));
    const inserted = db.prepare('INSERT INTO search_fields VALUES (?,?,?,?,?)').run(text, folder, rank, session, nul);
    db.prepare('INSERT INTO search_rows VALUES (?,?,?)').run(inserted.lastInsertRowid, session, nul);
  }

  private sourceStatus(identity: string): 'matching' | 'missing' | 'different' {
    try {
      return identity === `${realpathSync.native(this.options.sourcePath).toLowerCase()}:${fileIdentity(this.options.sourcePath)}`
        ? 'matching' : 'different';
    } catch {
      const savedPath = /^(.*):\d+:\d+$/.exec(identity)?.[1];
      return savedPath === win32.normalize(this.options.sourcePath).toLowerCase() ? 'missing' : 'different';
    }
  }

  public async search(raw: string, queryGeneration: number, cancelled: () => boolean = () => false): Promise<HubSearchResult> {
    const query = parseSearchQuery(raw);
    if (query.kind === 'invalid' || !Number.isSafeInteger(queryGeneration) || queryGeneration < 0) throw new Error('invalid-query');
    const check = (): void => {
      if (this.disposed || cancelled()) throw new Error('search-cancelled');
    };
    check();
    let db: DatabaseSync | undefined;
    try {
      const pointer = this.storage.readPointer();
      if (!pointer?.published) return { generation: '', indexRevision: 0, queryGeneration, matches: [] };
      db = this.storage.open(pointer.published, false);
      db.exec('BEGIN');
      const progress = db.prepare('SELECT revision,complete,source_identity FROM progress').get();
      const schema = Number(db.prepare('PRAGMA user_version').get()?.user_version);
      if (!progress || (schema < 3 && progress.complete !== 1)) throw new Error('search-unavailable');
      if (this.sourceStatus(String(progress.source_identity)) === 'different') throw new HubFailure('source-unavailable');
      const generation = `${pointer.incarnation}:${pointer.published}`;
      const indexRevision = Number(progress.revision);
      const ranks = new Map<string, 0 | 1 | 2>();
      if (query.kind === 'reset') {
        for (const row of db.prepare('SELECT DISTINCT folder FROM sessions').iterate()) ranks.set(String(row.folder), 0);
      } else {
        const modern = schema >= 2;
        if (!modern) db.function('hub_name', { deterministic: true }, (path) => normalizeSearchText(win32.basename(String(path))));
        for (const [index, token] of query.tokens.entries()) {
          check();
          // NUL terminates FTS tokenization, not instr. Always union those fields before exact verification.
          const candidates = modern
            ? token.includes('\0') ? 'SELECT folder,field_rank AS rank,text FROM search_fields'
              : `SELECT folder,field_rank AS rank,text FROM search_fields WHERE search_fields MATCH ?
                 UNION ALL SELECT folder,field_rank AS rank,text FROM search_fields
                 WHERE rowid IN (SELECT row_id FROM search_rows WHERE has_nul=1)`
            : `SELECT folder,0 AS rank,hub_name(directory) AS text FROM sessions
               UNION ALL SELECT folder,1,title_norm FROM sessions
               UNION ALL SELECT s.folder,2,t.text FROM texts t JOIN sessions s ON s.id=t.session_id`;
          const statement = db.prepare(`SELECT folder,min(rank) AS rank FROM (${candidates}) WHERE instr(text,?)>0 GROUP BY folder`);
          const rows = modern && !token.includes('\0')
            ? statement.iterate(`"${token.replace(/"/g, '""')}"`, token) : statement.iterate(token);
          const found = new Set<string>();
          let count = 0;
          for (const row of rows) {
            const folder = String(row.folder), rank = Number(row.rank) as 0 | 1 | 2;
            found.add(folder);
            if (index === 0) ranks.set(folder, rank);
            else if (ranks.has(folder)) ranks.set(folder, Math.max(ranks.get(folder) ?? 0, rank) as 0 | 1 | 2);
            if (++count % 100 === 0) { await yieldTurn(); check(); }
          }
          for (const folder of ranks.keys()) if (!found.has(folder)) ranks.delete(folder);
          await yieldTurn(); check();
          if (ranks.size === 0) break;
        }
      }
      check();
      const current = this.storage.readPointer();
      if (current?.incarnation !== pointer.incarnation || current.published !== pointer.published) throw new Error('index-changed');
      // End the WAL read snapshot before checking an in-place publication's revision.
      db.exec('ROLLBACK');
      if (db.prepare('SELECT revision FROM progress').get()?.revision !== indexRevision) throw new Error('index-changed');
      if (this.sourceStatus(String(progress.source_identity)) === 'different') throw new HubFailure('source-unavailable');
      return { generation, indexRevision, queryGeneration,
        matches: [...ranks].map(([folderId, rank]) => ({ folderId, rank })) };
    } catch (error) {
      // Native causes can contain SQL or corpus text; only allowlisted codes cross this API.
      // eslint-disable-next-line preserve-caught-error
      if (error instanceof Error && ['search-cancelled', 'index-changed'].includes(error.message)) throw new Error(error.message);
      if (!(error instanceof HubFailure) || error.code === 'storage-unavailable') this.storage.invalidateIntegrity();
      // eslint-disable-next-line preserve-caught-error
      throw new Error('search-unavailable');
    } finally {
      if (db) {
        try { db.exec('ROLLBACK'); } catch { /* Never relay native cleanup diagnostics. */ }
        try { db.close(); } catch { /* Never relay native cleanup diagnostics. */ }
      }
    }
  }

  private async snapshot(pointer: HubPointer, preparing: boolean, publish = true, transaction?: DatabaseSync): Promise<HubIndexSnapshot> {
    if (pointer.published === null) {
      this.lastSnapshot = { generation: '', indexRevision: 0, folders: [], complete: false, health: 'preparing' };
      return this.lastSnapshot;
    }
    const db = transaction ?? this.storage.open(pointer.published, false);
    try {
      if (!transaction) db.exec('BEGIN');
      const progress = db.prepare('SELECT * FROM progress').get() as unknown as Progress;
      preparing ||= progress.complete !== 1;
      const sourceStatus = this.sourceStatus(progress.source_identity);
      if (sourceStatus === 'different') {
        const snapshot: HubIndexSnapshot = { generation: '', indexRevision: 0, complete: false, folders: [],
          health: preparing ? 'preparing' : 'unavailable', ...(!preparing ? { diagnostic: 'source-unavailable' as const } : {}) };
        if (publish) this.lastSnapshot = snapshot;
        return snapshot;
      }
      const sourceMatches = sourceStatus === 'matching';
      const sessions: RawSessionMetadata[] = [];
      // Include the path-display winner separately: title ordering must not change path casing.
      const rows = db.prepare(`WITH ranked AS (SELECT *,
        row_number() OVER(PARTITION BY folder ORDER BY updated DESC,title_fold,title,id_fold,id) AS title_rank,
        row_number() OVER(PARTITION BY folder ORDER BY updated DESC,id_fold,id,directory) AS path_rank
        FROM sessions) SELECT *,CAST(title AS BLOB) AS title_bytes FROM ranked WHERE title_rank<=3 OR path_rank=1`).iterate();
      let characters = 0;
      for (const row of rows) {
        if (!(row.title_bytes instanceof Uint8Array)) throw new HubFailure('storage-unavailable');
        const id = String(row.id), title = Buffer.from(row.title_bytes).toString('utf8'), directory = String(row.directory);
        characters += id.length + title.length + directory.length * 4;
        if (sessions.length >= 40_000 || characters > 4 * 1024 * 1024
          || title.length > 4096 || directory.length > 4096) throw new HubFailure('display-overflow');
        sessions.push({ id, title, directory, timeCreated: Number(row.created), timeUpdated: Number(row.updated),
          parentId: null, timeArchived: null });
      }
      const folders = await projectSessions(sessions, { isDirectoryAvailable: isAvailableLocalDirectory });
      for (const folder of folders) folder.conversations.splice(3);
      if (!isHubFolderArray(presentFolders(folders, { now: new Date(), currentFolderId: null }))) throw new HubFailure('display-overflow');
      const snapshot: HubIndexSnapshot = { generation: `${pointer.incarnation}:${pointer.published}`, indexRevision: progress.revision,
        complete: !preparing && sourceMatches && !pointer.diagnostic && progress.complete === 1,
        health: pointer.diagnostic ? 'stale' : preparing ? 'preparing' : sourceMatches ? 'ready' : 'stale', folders,
        ...(pointer.diagnostic ? { diagnostic: pointer.diagnostic }
          : !preparing && !sourceMatches ? { diagnostic: 'source-unavailable' as const } : {}) };
      if (this.sourceStatus(progress.source_identity) === 'different') {
        const empty: HubIndexSnapshot = { generation: '', indexRevision: 0, complete: false, folders: [],
          health: preparing ? 'preparing' : 'unavailable', ...(!preparing ? { diagnostic: 'source-unavailable' as const } : {}) };
        if (publish) this.lastSnapshot = empty;
        return empty;
      }
      if (publish) this.lastSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      if (!(error instanceof HubFailure) || error.code === 'storage-unavailable') this.storage.invalidateIntegrity(pointer.published);
      throw error;
    } finally { if (!transaction) db.close(); }
  }
}
