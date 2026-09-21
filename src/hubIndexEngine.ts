import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type { HubIndexOptions, HubIndexSnapshot } from './hubIndexProtocol.js';
import { HubSource, normalizeIndexText } from './hubSource.js';
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
  private lastFull = 0;
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

  private fresh(generation: string, fingerprint: string, sourceIdentity: string, revision: number): void {
    const db = this.storage.open(generation, true, true);
    try {
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;
        PRAGMA application_id=${HUB_APPLICATION_ID}; PRAGMA user_version=1;
        CREATE TABLE progress(fingerprint TEXT NOT NULL,source_identity TEXT NOT NULL,cursor TEXT NOT NULL,complete INTEGER NOT NULL,
          owner TEXT NOT NULL,revision INTEGER NOT NULL);
        CREATE TABLE sessions(id TEXT PRIMARY KEY, title TEXT NOT NULL,title_fold TEXT NOT NULL,title_norm TEXT NOT NULL,
          directory TEXT NOT NULL,folder TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,
          id_fold TEXT NOT NULL,sequence TEXT NOT NULL);
        CREATE INDEX session_folder ON sessions(folder);
        CREATE TABLE texts(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,message_id TEXT NOT NULL,text TEXT NOT NULL);
        CREATE INDEX text_session ON texts(session_id);`);
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
      if (pointer.building === null) {
        const fingerprint = await source.fingerprint();
        pointer = { ...pointer, diagnostic: undefined };
        this.storage.writePointer(pointer);
        let revision = 1;
        if (pointer.published !== null) {
          try {
            const published = this.storage.open(pointer.published, false);
            try {
              const progress = published.prepare('SELECT * FROM progress').get() as unknown as Progress;
              revision = progress.revision + 1;
              if (!Number.isSafeInteger(revision)) throw new HubFailure('storage-unavailable');
              if (!forceFull && Date.now() - this.lastFull < 300_000 && progress.fingerprint === fingerprint) {
                return await this.snapshot(pointer, false);
              }
            } finally { published.close(); }
          } catch (error) {
            if (error instanceof HubFailure && error.code === 'storage-unsafe') throw error;
            // Only the manifest-recognized generation is abandoned, never overwritten or deleted.
          }
        }
        const generation = randomUUID();
        const identity = this.storage.reserve(generation);
        pointer = { ...pointer, building: generation, diagnostic: undefined,
          identities: { ...pointer.identities, [generation]: identity } };
        this.storage.writePointer(pointer);
        this.fresh(generation, fingerprint, source.identity, revision);
      }
      const generation = pointer.building;
      if (generation === null) throw new HubFailure('storage-unavailable');
      try { db = this.storage.open(generation, true); }
      catch (error) {
        if (error instanceof HubFailure && error.code === 'storage-unsafe') throw error;
        this.storage.writePointer({ ...pointer, building: null, retired: [...pointer.retired, generation] });
        throw new HubFailure('storage-unavailable');
      }
      // A new pipe owner adopts durable progress only after opening its recognized database.
      this.check();
      this.storage.assertWritable(db);
      db.prepare('UPDATE progress SET owner=?').run(this.owner);
      const progress = db.prepare('SELECT * FROM progress').get() as unknown as Progress;
      let count = 0;
      let exhausted = true;
      for await (const session of source.sessions(progress.cursor)) {
        this.check();
        if (count >= 100) { exhausted = false; break; }
        // Interrupted sessions are retried from their beginning, never treated as complete.
        this.begin(db);
        db.prepare('DELETE FROM texts WHERE session_id=?').run(session.id);
        db.exec('COMMIT');
        const directory = normalizeWindowsDirectory(session.directory);
        if (directory) {
          for await (const part of source.texts(session.id)) {
            this.begin(db);
            db.prepare('INSERT OR REPLACE INTO texts VALUES (?,?,?,?)')
              .run(part.id, session.id, part.messageId, part.text);
            db.exec('COMMIT');
          }
        }
        source.assertIdentity();
        this.begin(db);
        if (directory) db.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(session.id, session.title, (session.title.trim() ? session.title : 'Без названия').toLowerCase(),
            normalizeIndexText(session.title), directory.path, directory.key, session.created, session.updated,
            session.id.toLowerCase(), session.sequence);
        db.prepare('UPDATE progress SET cursor=?').run(session.id);
        db.exec('COMMIT');
        count += 1;
      }
      source.close(); source = undefined;
      pointer = { ...pointer, diagnostic: undefined };
      this.storage.writePointer(pointer);
      if (exhausted) {
        // A fresh metadata-only census also rechecks DB-09 before deleting/publishing anything.
        source = new HubSource(this.options, this.memoryBudget);
        if (await source.fingerprint() !== progress.fingerprint) {
          this.storage.writePointer({ ...pointer, building: null, retired: [...pointer.retired, generation] });
          return await this.snapshot({ ...pointer, building: null }, true);
        }
        this.begin(db);
        db.prepare('UPDATE progress SET complete=1').run();
        db.exec('COMMIT');
        if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new HubFailure('storage-unavailable');
        source.assertIdentity();
        const candidate = { ...pointer, published: generation, building: null, diagnostic: undefined,
          retired: pointer.published ? [...pointer.retired, pointer.published] : pointer.retired };
        // A complete index is not permission to discard the last displayable generation.
        const candidateSnapshot = await this.snapshot(candidate, false, false);
        source.assertIdentity();
        pointer = candidate;
        this.storage.writePointer(pointer);
        this.lastSnapshot = candidateSnapshot;
        this.lastFull = Date.now();
      }
      return await this.snapshot(pointer, !exhausted);
    } catch (error) {
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

  private async snapshot(pointer: HubPointer, preparing: boolean, publish = true): Promise<HubIndexSnapshot> {
    if (pointer.published === null) {
      this.lastSnapshot = { generation: '', indexRevision: 0, folders: [], complete: false, health: 'preparing' };
      return this.lastSnapshot;
    }
    const db = this.storage.open(pointer.published, false);
    try {
      const progress = db.prepare('SELECT * FROM progress').get() as unknown as Progress;
      let sourceMatches = false;
      try {
        sourceMatches = progress.source_identity === `${realpathSync.native(this.options.sourcePath).toLowerCase()}:${fileIdentity(this.options.sourcePath)}`;
      } catch { /* Last-good metadata is still useful when the source disappears. */ }
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
      if (publish) this.lastSnapshot = snapshot;
      return snapshot;
    } finally { db.close(); }
  }
}
