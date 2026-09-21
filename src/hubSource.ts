import { constants } from 'node:buffer';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { freemem } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { getHeapStatistics } from 'node:v8';
import { setImmediate as yieldTurn } from 'node:timers/promises';

import { assertCompatibleSchema, assertSupportedKiloVersion } from './kiloDataSource.js';
import { fileIdentity, HubFailure } from './hubStorage.js';
import type { HubIndexOptions } from './hubIndexProtocol.js';

export function admitField(bytes: unknown, available?: number): void {
  const heap = getHeapStatistics();
  const budget = available ?? Math.min(freemem() / 4, (heap.heap_size_limit - heap.used_heap_size) / 2);
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0
    || bytes > Math.min(constants.MAX_LENGTH, constants.MAX_STRING_LENGTH / 3)
    || 64 * 1024 * 1024 + 16 * bytes > budget) throw new HubFailure('resource-refused');
}

export function normalizeIndexText(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/ё/g, 'е').normalize('NFC');
}

export interface SourceSession {
  id: string;
  title: string;
  directory: string;
  created: number;
  updated: number;
  sequence: string;
}

export class HubSource {
  private readonly database: DatabaseSync;
  public readonly identity: string;
  private sequence = false;
  public constructor(private readonly options: HubIndexOptions, private readonly budget?: () => number) {
    try {
      assertSupportedKiloVersion(options.kiloVersion);
      this.identity = `${realpathSync.native(options.sourcePath).toLowerCase()}:${fileIdentity(options.sourcePath)}`;
      this.database = new DatabaseSync(options.sourcePath, { readOnly: true, allowExtension: false, timeout: 80 });
    } catch { throw new HubFailure('source-unavailable'); }
    try {
      this.database.exec('PRAGMA query_only=ON; BEGIN');
      assertCompatibleSchema(this.database);
      for (const table of ['session', 'message', 'part']) {
        // Reject ambiguous/truncated IDs before keyset pagination, including minimum's NUL conversion.
        if (this.database.prepare(`SELECT 1 FROM ${table} WHERE typeof(id)!='text' OR id=''
          OR octet_length(id)>2048 OR instr(id,char(0))>0 LIMIT 1`).get()) {
          throw new HubFailure('source-incompatible');
        }
      }
      for (const [table, columns] of [['message', ['id', 'session_id', 'data']],
        ['part', ['id', 'session_id', 'message_id', 'data']]] as const) {
        if (this.database.prepare('SELECT type FROM sqlite_schema WHERE name=?').get(table)?.type !== 'table') {
          throw new HubFailure('source-incompatible');
        }
        const actual = new Map(this.database.prepare(`PRAGMA table_info(${table})`).all()
          .map((row) => [row.name, row]));
        for (const name of columns) {
          const column = actual.get(name);
          if (column?.type !== 'TEXT' || (name === 'id' && column.pk !== 1)) {
            throw new HubFailure('source-incompatible');
          }
        }
      }
      this.sequence = this.database.prepare("SELECT type FROM sqlite_schema WHERE name='event_sequence'")
        .get()?.type === 'table';
      if (this.sequence) this.database.prepare('SELECT aggregate_id,seq,owner_id FROM event_sequence LIMIT 0');
      for (const table of ['session_message', 'session_input']) {
        const object = this.database.prepare('SELECT type FROM sqlite_schema WHERE name=?').get(table);
        if (object === undefined) continue;
        if (object.type !== 'table') throw new HubFailure('source-incompatible');
        if (this.database.prepare(`SELECT 1 FROM ${table} a JOIN session s ON s.id=a.session_id
          WHERE s.parent_id IS NULL AND s.time_archived IS NULL LIMIT 1`).get()) {
          throw new HubFailure('source-ambiguous');
        }
      }
    } catch (error) {
      this.database.close();
      throw error instanceof HubFailure ? error : new HubFailure('source-incompatible');
    }
  }

  public assertIdentity(): void {
    if (this.identity !== `${realpathSync.native(this.options.sourcePath).toLowerCase()}:${fileIdentity(this.options.sourcePath)}`) {
      throw new HubFailure('source-unavailable');
    }
  }

  public async *sessions(after = ''): AsyncGenerator<SourceSession> {
    let cursor = after;
    while (true) {
      const rows = this.database.prepare(`SELECT id,octet_length(title) AS title_bytes,
        octet_length(directory) AS directory_bytes,time_created,time_updated
        FROM session WHERE parent_id IS NULL AND time_archived IS NULL AND id>? ORDER BY id LIMIT 100`).all(cursor);
      if (rows.length === 0) return;
      for (const row of rows) {
        if (typeof row.id !== 'string' || row.id.length === 0 || row.id.length > 512 || row.id.includes('\0')
          || typeof row.time_created !== 'number' || !Number.isSafeInteger(row.time_created)
          || typeof row.time_updated !== 'number' || !Number.isSafeInteger(row.time_updated)) {
          throw new HubFailure('source-incompatible');
        }
        admitField(row.title_bytes, this.budget?.());
        admitField(row.directory_bytes, this.budget?.());
        const metadata = this.database.prepare('SELECT CAST(title AS BLOB) AS title,CAST(directory AS BLOB) AS directory FROM session WHERE id=?').get(row.id);
        if (!(metadata?.title instanceof Uint8Array) || !(metadata.directory instanceof Uint8Array)) {
          throw new HubFailure('source-incompatible');
        }
        const seq = this.sequence ? this.database.prepare('SELECT seq,owner_id FROM event_sequence WHERE aggregate_id=?').get(row.id) : undefined;
        cursor = row.id;
        yield { id: row.id, title: Buffer.from(metadata.title).toString('utf8'),
          directory: Buffer.from(metadata.directory).toString('utf8'), created: row.time_created,
          updated: row.time_updated, sequence: JSON.stringify(seq ?? null) };
        await yieldTurn();
      }
    }
  }

  public async fingerprint(): Promise<string> {
    const hash = createHash('sha256').update(this.identity);
    for await (const session of this.sessions()) hash.update(JSON.stringify(session));
    this.assertIdentity();
    return hash.digest('hex');
  }

  public async *texts(session: string): AsyncGenerator<{ id: string; messageId: string; text: string }> {
    // Both JSON columns are admitted before even json_valid/type/role touches either value.
    let messageCursor = '';
    while (true) {
      const messages = this.database.prepare('SELECT id,octet_length(data) AS bytes FROM message WHERE session_id=? AND id>? ORDER BY id LIMIT 100')
        .all(session, messageCursor);
      if (messages.length === 0) return;
      for (const message of messages) {
        if (typeof message.id !== 'string' || message.id.length === 0 || message.id.includes('\0')) throw new HubFailure('source-incompatible');
        admitField(message.bytes, this.budget?.());
        const role = this.database.prepare("SELECT json_extract(data,'$.role')='user' AS eligible FROM message WHERE id=?").get(message.id)?.eligible;
        messageCursor = message.id;
        if (role !== 1) { await yieldTurn(); continue; }
        let partCursor = '';
        while (true) {
          const parts = this.database.prepare('SELECT id,octet_length(data) AS bytes FROM part WHERE session_id=? AND message_id=? AND id>? ORDER BY id LIMIT 100')
            .all(session, message.id, partCursor);
          if (parts.length === 0) break;
          for (const part of parts) {
            if (typeof part.id !== 'string' || part.id.length === 0 || part.id.includes('\0')) throw new HubFailure('source-incompatible');
            admitField(part.bytes, this.budget?.());
            const value = this.database.prepare(`SELECT CAST(json_extract(data,'$.text') AS BLOB) AS text
              FROM part WHERE id=? AND json_extract(data,'$.type')='text'
              AND json_type(data,'$.text')='text'
              AND coalesce(json_extract(data,'$.synthetic'),0) != 1
              AND coalesce(json_extract(data,'$.ignored'),0) != 1`).get(part.id);
            if (value?.text instanceof Uint8Array) yield { id: part.id, messageId: message.id,
              text: normalizeIndexText(Buffer.from(value.text).toString('utf8')) };
            partCursor = part.id;
            await yieldTurn();
          }
        }
      }
    }
  }

  public close(): void { this.database.close(); }
}
