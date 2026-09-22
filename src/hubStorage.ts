import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { dirname, join, resolve, win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { HUB_DIAGNOSTICS, type HubDiagnostic } from './hubIndexProtocol.js';

export class HubFailure extends Error {
  public constructor(public readonly code: HubDiagnostic) { super(code); }
}

export function fileIdentity(path: string): string {
  const stat = statSync(path, { bigint: true });
  if (stat.ino === 0n) throw new HubFailure('storage-unsafe');
  return `${stat.dev}:${stat.ino}`;
}

function canonical(path: string): string {
  const result = existsSync(path) ? realpathSync.native(path)
    : join(realpathSync.native(dirname(path)), path.slice(dirname(path).length + 1));
  if (process.platform !== 'win32' || !/^[a-z]:\\/i.test(result)) {
    throw new HubFailure('storage-unsafe');
  }
  return result.toLowerCase();
}

/** Check main files and every SQLite sidecar before any writable open. */
export function assertIsolated(source: string, target: string, readOnly = false): void {
  const suffixes = ['', '-wal', '-shm', '-journal'];
  const sources = suffixes.map((suffix) => source + suffix);
  for (const candidate of suffixes.map((suffix) => target + suffix)) {
    for (const origin of sources) {
      let originPath: string;
      try { originPath = canonical(origin); }
      catch {
        // Reading a recognized Hub generation cannot damage an unavailable source volume.
        // Writable opens still require the complete physical-source guard, without this fallback.
        if (!readOnly || !/^[a-z]:[\\/]/i.test(origin)) throw new HubFailure('storage-unsafe');
        originPath = win32.normalize(origin).toLowerCase();
      }
      if (canonical(candidate) === originPath
        || (existsSync(candidate) && existsSync(origin)
          && fileIdentity(candidate) === fileIdentity(origin))) {
        throw new HubFailure('storage-unsafe');
      }
    }
  }
}

export interface HubPointer {
  readonly format: 1;
  readonly incarnation: string;
  readonly published: string | null;
  readonly building: string | null;
  readonly identities: Readonly<Record<string, string>>;
  readonly retired: readonly string[];
  readonly diagnostic?: HubDiagnostic;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const HUB_APPLICATION_ID = 0x4b484233;

export class HubStorage {
  private server: Server | undefined;
  private storeIdentity = '';
  private readonly connections = new WeakMap<DatabaseSync, { path: string; identity: string }>();
  private readonly integrity = new Map<string, string>();
  private readonly pointerPath: string;
  public constructor(public readonly directory: string, private readonly source: string) {
    this.pointerPath = join(directory, 'hub-pointer.json');
  }

  public async claim(): Promise<boolean> {
    // globalStorageUri's parent is created by VS Code; recursive creation never touches source files.
    if (process.platform !== 'win32' || resolve(this.directory) !== this.directory) {
      throw new HubFailure('storage-unsafe');
    }
    mkdirSync(this.directory, { recursive: true });
    canonical(this.directory);
    this.storeIdentity = fileIdentity(this.directory);
    const name = `\\\\.\\pipe\\kilo-hub-${createHash('sha256').update(this.storeIdentity).digest('hex')}`;
    const server = createServer((socket) => socket.destroy());
    const acquired = await new Promise<boolean>((resolveClaim, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') resolveClaim(false);
        else reject(new HubFailure('storage-unavailable'));
      });
      server.listen({ path: name, exclusive: true }, () => resolveClaim(true));
    });
    if (acquired) this.server = server;
    return acquired;
  }

  public assertOwner(): void {
    if (!this.server?.listening || fileIdentity(this.directory) !== this.storeIdentity) {
      throw new HubFailure('storage-unsafe');
    }
  }

  public assertWritable(database: DatabaseSync): void {
    this.assertOwner();
    const opened = this.connections.get(database);
    if (!opened || fileIdentity(opened.path) !== opened.identity) throw new HubFailure('storage-unsafe');
  }

  public readPointer(): HubPointer | undefined {
    if (!existsSync(this.pointerPath)) return undefined;
    assertIsolated(this.source, this.pointerPath, true);
    if (statSync(this.pointerPath).size > 1024 * 1024) throw new HubFailure('storage-unsafe');
    let value: HubPointer;
    try { value = JSON.parse(readFileSync(this.pointerPath, 'utf8')) as HubPointer; }
    catch { throw new HubFailure('storage-unsafe'); }
    if (value?.format !== 1 || !UUID.test(value.incarnation)
      || !(value.published === null || UUID.test(value.published))
      || !(value.building === null || UUID.test(value.building))
      || !Array.isArray(value.retired) || value.retired.some((id: unknown) => typeof id !== 'string' || !UUID.test(id))
      || (value.diagnostic !== undefined && !HUB_DIAGNOSTICS.includes(value.diagnostic))
      || typeof value.identities !== 'object' || value.identities === null
      || Object.entries(value.identities).some(([id, identity]) => !UUID.test(id) || !/^\d+:\d+$/.test(identity))) {
      throw new HubFailure('storage-unsafe');
    }
    return value;
  }

  public writePointer(pointer: HubPointer): void {
    this.assertOwner();
    assertIsolated(this.source, this.pointerPath);
    const temporary = join(this.directory, `pointer-${randomUUID()}.tmp`);
    assertIsolated(this.source, temporary);
    writeFileSync(temporary, JSON.stringify(pointer), { flag: 'wx', flush: true });
    this.assertOwner();
    renameSync(temporary, this.pointerPath);
  }

  public path(generation: string): string {
    if (!UUID.test(generation)) throw new HubFailure('storage-unsafe');
    return join(this.directory, `hub-${generation}.sqlite`);
  }

  public reserve(generation: string): string {
    this.assertOwner();
    const path = this.path(generation);
    assertIsolated(this.source, path);
    // Register the empty file's physical identity before SQLite can write any corpus to it.
    writeFileSync(path, '', { flag: 'wx', flush: true });
    return fileIdentity(path);
  }

  public collect(pointer: HubPointer): HubPointer {
    const retired: string[] = [];
    const identities = { ...pointer.identities };
    for (const generation of pointer.retired) {
      this.assertOwner();
      const path = this.path(generation);
      assertIsolated(this.source, path);
      if (generation === pointer.published || generation === pointer.building) throw new HubFailure('storage-unsafe');
      if (existsSync(path) && fileIdentity(path) !== identities[generation]) throw new HubFailure('storage-unsafe');
      try {
        // Existing readers can keep this generation open on Windows; retry next cycle.
        for (const suffix of ['', '-wal', '-shm', '-journal']) {
          if (existsSync(path + suffix)) unlinkSync(path + suffix);
        }
        delete identities[generation];
        this.invalidateIntegrity(generation);
      } catch { retired.push(generation); }
    }
    return { ...pointer, retired, identities };
  }

  public open(generation: string, writable: boolean, fresh = false): DatabaseSync {
    try { return this.openChecked(generation, writable, fresh); }
    catch (error) {
      this.invalidateIntegrity(generation);
      throw error;
    }
  }

  /** Native read/write failures and publication require a new integrity check. */
  public invalidateIntegrity(generation?: string): void {
    if (generation === undefined) this.integrity.clear();
    else this.integrity.delete(generation);
  }

  private openChecked(generation: string, writable: boolean, fresh: boolean): DatabaseSync {
    const path = this.path(generation);
    assertIsolated(this.source, path, !writable);
    if (writable) this.assertOwner();
    const identity = fileIdentity(path);
    if (fresh) this.invalidateIntegrity(generation);
    if (fresh && (statSync(path).size !== 0 || this.readPointer()?.identities[generation] !== fileIdentity(path))) {
      throw new HubFailure('storage-unsafe');
    }
    if (!fresh) {
      const pointer = this.readPointer();
      if (!pointer || pointer.identities[generation] !== fileIdentity(path)) throw new HubFailure('storage-unsafe');
      const probe = new DatabaseSync(path, { readOnly: true, allowExtension: false, timeout: 80 });
      try {
        probe.exec('BEGIN');
        const application = probe.prepare('PRAGMA application_id').get()?.application_id;
        const version = probe.prepare('PRAGMA user_version').get()?.user_version;
        const schemaVersion = probe.prepare('PRAGMA schema_version').get()?.schema_version;
        const integrityKey = `${identity}:${String(application)}:${String(version)}:${String(schemaVersion)}`;
        if (application !== HUB_APPLICATION_ID || ![1, 2, 3].includes(Number(version))) {
          throw new HubFailure('storage-unavailable');
        }
        if (this.integrity.get(generation) !== integrityKey
          && probe.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') {
          throw new HubFailure('storage-unavailable');
        }
        if (version === 2 || version === 3) {
          const schema = probe.prepare("SELECT sql FROM sqlite_schema WHERE name='search_fields'").get()?.sql;
          if (typeof schema !== 'string' || !schema.includes("USING fts5(text,folder UNINDEXED,field_rank UNINDEXED,session_id UNINDEXED,has_nul UNINDEXED,tokenize='trigram')")) {
            throw new HubFailure('storage-unavailable');
          }
          probe.prepare('SELECT text,folder,field_rank,session_id,has_nul FROM search_fields LIMIT 0');
          probe.prepare('SELECT row_id,session_id,has_nul FROM search_rows LIMIT 0');
        }
        for (const [table, names] of Object.entries({
          progress: ['fingerprint', 'source_identity', 'cursor', 'complete', 'owner', 'revision'],
          sessions: ['id', 'title', 'title_fold', 'title_norm', 'directory', 'folder', 'created', 'updated', 'id_fold', 'sequence'],
          texts: ['id', 'session_id', 'message_id', 'text'],
          ...(version === 3 ? {
            versions: ['id', 'metadata', 'content'],
            work: ['order_id', 'id', 'full'],
            sync_state: ['last_full', 'full_scan'],
            census: ['id', 'metadata'],
            staged_texts: ['id', 'session_id', 'message_id', 'text'],
          } : {}),
        })) {
          if (probe.prepare('SELECT type FROM sqlite_schema WHERE name=?').get(table)?.type !== 'table') {
            throw new HubFailure('storage-unavailable');
          }
          const columns = probe.prepare(`PRAGMA table_info(${table})`).all();
          if (columns.length !== names.length || names.some((name) => !columns.some((column) => column.name === name))) {
            throw new HubFailure('storage-unavailable');
          }
        }
        const progress = probe.prepare('SELECT * FROM progress').all();
        const row = progress[0];
        if (progress.length !== 1 || !row || typeof row.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(row.fingerprint)
          || typeof row.source_identity !== 'string' || row.source_identity.length === 0
          || typeof row.cursor !== 'string' || typeof row.owner !== 'string' || !UUID.test(row.owner)
          || (row.complete !== 0 && row.complete !== 1)
          || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1) {
          throw new HubFailure('storage-unavailable');
        }
        if (version === 3) {
          const states = probe.prepare('SELECT * FROM sync_state').all();
          const state = states[0];
          if (states.length !== 1 || !state || typeof state.last_full !== 'number'
            || !Number.isSafeInteger(state.last_full) || state.last_full < 0
            || (state.full_scan !== 0 && state.full_scan !== 1)) {
            throw new HubFailure('storage-unavailable');
          }
        }
        this.integrity.set(generation, integrityKey);
      } finally { probe.close(); }
    }
    assertIsolated(this.source, path, !writable);
    const database = new DatabaseSync(path, { readOnly: !writable, allowExtension: false, timeout: 80 });
    try {
      if (fileIdentity(path) !== identity) throw new HubFailure('storage-unsafe');
      if (writable) this.connections.set(database, { path, identity });
      if (!writable) database.exec('PRAGMA query_only=ON');
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  public async close(): Promise<void> {
    this.invalidateIntegrity();
    const server = this.server;
    this.server = undefined;
    if (server?.listening) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}
