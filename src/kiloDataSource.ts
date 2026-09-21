import { homedir } from 'node:os';
import { win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

import type { RawSessionMetadata } from './types.js';

const MINIMUM_KILO_VERSION = [7, 7, 5] as const;
const DATABASE_TIMEOUT_MS = 5_000;
const WORKER_TIMEOUT_MS = 10_000;
const MAX_WARNING_COUNT = 100;

export const KILO_METADATA_LIMITS = Object.freeze({
  idLength: 512,
  textLength: 4_096,
  rows: 10_000,
  characters: 4 * 1_024 * 1_024,
});

export const KILO_METADATA_QUERY = `SELECT
  CASE WHEN typeof(id) = 'text' THEN substr(id, 1, ${KILO_METADATA_LIMITS.idLength + 1}) END AS id,
  CASE WHEN typeof(title) = 'text' THEN substr(title, 1, ${KILO_METADATA_LIMITS.textLength + 1}) END AS title,
  CASE WHEN typeof(directory) = 'text' THEN substr(directory, 1, ${KILO_METADATA_LIMITS.textLength + 1}) END AS directory,
  CASE WHEN typeof(time_created) = 'integer'
    AND time_created BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER} THEN time_created END AS time_created,
  CASE WHEN typeof(time_updated) = 'integer'
    AND time_updated BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER} THEN time_updated END AS time_updated,
  NULL AS parent_id,
  NULL AS time_archived
FROM session
WHERE parent_id IS NULL
  AND time_archived IS NULL
LIMIT ${KILO_METADATA_LIMITS.rows + 1}`;

const REQUIRED_SESSION_COLUMNS = new Map<string, {
  type: string;
  constraint: 'primaryKey' | 'notNull' | 'nullable';
}>([
  ['id', { type: 'TEXT', constraint: 'primaryKey' }],
  ['title', { type: 'TEXT', constraint: 'notNull' }],
  ['directory', { type: 'TEXT', constraint: 'notNull' }],
  ['parent_id', { type: 'TEXT', constraint: 'nullable' }],
  ['time_created', { type: 'INTEGER', constraint: 'notNull' }],
  ['time_updated', { type: 'INTEGER', constraint: 'notNull' }],
  ['time_archived', { type: 'INTEGER', constraint: 'nullable' }],
]);

export interface KiloDatabaseResolverOptions {
  env?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}

export interface ReadKiloSessionsOptions extends KiloDatabaseResolverOptions {
  kiloVersion?: string;
  onWarning?: (message: string) => void;
}

export interface KiloDataWorkerResult {
  sessions: RawSessionMetadata[];
  warnings: string[];
}

export interface KiloDataWorkerResponse {
  result?: KiloDataWorkerResult;
  error?: {
    message: string;
    stack?: string;
  };
}

interface SessionColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}

export class KiloDataSourceError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KiloDataSourceError';
  }
}

function isLocalAbsoluteWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) && win32.isAbsolute(value);
}

function hasInvalidPathInput(value: string): boolean {
  return value.length === 0
    || value.trim().length === 0
    || value.includes('\0')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/^[A-Za-z]:[\\/]/.test(value);
}

function normalizeLocalAbsolutePath(value: string, source: string): string {
  if (hasInvalidPathInput(value) || !isLocalAbsoluteWindowsPath(value)) {
    throw new KiloDataSourceError(`${source} должен содержать абсолютный локальный путь Windows.`);
  }

  return win32.normalize(value);
}

function resolveRelativeDatabasePath(value: string, kiloDataDirectory: string): string {
  if (
    hasInvalidPathInput(value)
    || value === '.'
    || value === '..'
    || /^[\\/]/.test(value)
    || /^[A-Za-z]:/.test(value)
  ) {
    throw new KiloDataSourceError('KILO_DB содержит некорректный относительный путь.');
  }

  return win32.resolve(kiloDataDirectory, value);
}

/** Resolves the single supported Kilo release database on Windows. */
export function resolveKiloDatabasePath(options: KiloDatabaseResolverOptions = {}): string {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new KiloDataSourceError('Kilo Hub Step 1 поддерживает только Windows.');
  }

  const env = options.env ?? process.env;
  const override = env.KILO_DB;
  if (override === ':memory:') {
    throw new KiloDataSourceError('KILO_DB=:memory: не поддерживается отдельным Extension Host.');
  }
  if (override !== undefined && isLocalAbsoluteWindowsPath(override)) {
    return normalizeLocalAbsolutePath(override, 'KILO_DB');
  }

  const dataRoot = env.XDG_DATA_HOME === undefined
    ? normalizeLocalAbsolutePath(options.homeDirectory ?? env.USERPROFILE ?? homedir(), 'Домашний каталог')
    : normalizeLocalAbsolutePath(env.XDG_DATA_HOME, 'XDG_DATA_HOME');
  const kiloDataDirectory = win32.join(dataRoot, ...(env.XDG_DATA_HOME === undefined
    ? ['.local', 'share', 'kilo']
    : ['kilo']));

  if (override === undefined) {
    return win32.join(kiloDataDirectory, 'kilo.db');
  }

  return resolveRelativeDatabasePath(override, kiloDataDirectory);
}

function assertSupportedKiloVersion(version: string | undefined): void {
  if (version === undefined) {
    return;
  }

  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) {
    throw new KiloDataSourceError('Не удалось проверить известную версию Kilo Code.');
  }

  const current = match.slice(1, 4).map(Number);
  for (let index = 0; index < MINIMUM_KILO_VERSION.length; index += 1) {
    if (current[index] > MINIMUM_KILO_VERSION[index]) return;
    if (current[index] < MINIMUM_KILO_VERSION[index]) {
      throw new KiloDataSourceError('Требуется Kilo Code версии 7.7.5 или новее.');
    }
  }

  if (match[4] !== undefined) {
    throw new KiloDataSourceError('Требуется Kilo Code версии 7.7.5 или новее.');
  }
}

function withReadOnlyDatabase<T>(databasePath: string, operation: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(databasePath, {
    readOnly: true,
    timeout: DATABASE_TIMEOUT_MS,
    allowExtension: false,
  });

  try {
    database.exec('PRAGMA query_only = ON');
    return operation(database);
  } finally {
    database.close();
  }
}

function readSessionColumns(database: DatabaseSync): SessionColumnInfo[] {
  const rows = database.prepare('PRAGMA table_info(session)').all() as Array<Record<string, unknown>>;
  return rows.flatMap((row) => (
    typeof row.name === 'string'
    && typeof row.type === 'string'
    && (row.notnull === 0 || row.notnull === 1)
    && typeof row.pk === 'number'
      ? [{
        name: row.name,
        type: row.type.trim().toUpperCase(),
        notNull: row.notnull === 1,
        primaryKey: row.pk > 0,
      }]
      : []
  ));
}

function assertCompatibleSchema(database: DatabaseSync): void {
  const objects = database.prepare(
    "SELECT type FROM sqlite_schema WHERE name = 'session' COLLATE BINARY",
  ).all() as Array<Record<string, unknown>>;
  if (objects.length !== 1 || objects[0].type !== 'table') {
    throw new KiloDataSourceError('Несовместимая schema Kilo: таблица session не найдена.');
  }

  const actualColumns = new Map(readSessionColumns(database).map((column) => [column.name, column]));
  for (const [name, expected] of REQUIRED_SESSION_COLUMNS) {
    const actual = actualColumns.get(name);
    if (!actual) {
      throw new KiloDataSourceError(`Несовместимая schema Kilo: отсутствует колонка session.${name}.`);
    }
    const constraintMatches = expected.constraint === 'primaryKey'
      ? actual.primaryKey
      : expected.constraint === 'notNull'
        ? actual.notNull
        : !actual.notNull && !actual.primaryKey;
    if (actual.type !== expected.type || !constraintMatches) {
      throw new KiloDataSourceError(`Несовместимая schema Kilo: неверная структура session.${name}.`);
    }
  }

  // Preparing the production query is the final compatibility check.
  database.prepare(KILO_METADATA_QUERY);
}

function readTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function validateSessionRow(row: Record<string, unknown>): RawSessionMetadata | undefined {
  const timeCreated = readTimestamp(row.time_created);
  const timeUpdated = readTimestamp(row.time_updated);
  const timeArchived = row.time_archived === null ? null : readTimestamp(row.time_archived);
  if (
    typeof row.id !== 'string'
    || row.id.trim() === ''
    || row.id.length > KILO_METADATA_LIMITS.idLength
    || typeof row.title !== 'string'
    || row.title.length > KILO_METADATA_LIMITS.textLength
    || typeof row.directory !== 'string'
    || row.directory.length === 0
    || row.directory.length > KILO_METADATA_LIMITS.textLength
    || timeCreated === undefined
    || timeUpdated === undefined
    || !(row.parent_id === null || typeof row.parent_id === 'string')
    || timeArchived === undefined
  ) {
    return undefined;
  }

  return {
    id: row.id,
    title: row.title,
    directory: row.directory,
    timeCreated,
    timeUpdated,
    parentId: row.parent_id,
    timeArchived,
  };
}

function metadataCharacterCount(row: Record<string, unknown>): number {
  const id = typeof row.id === 'string' ? row.id.length : 0;
  const title = typeof row.title === 'string' ? row.title.length : 0;
  const directory = typeof row.directory === 'string' ? row.directory.length : 0;
  const parentId = typeof row.parent_id === 'string' ? row.parent_id.length : 0;
  // A unique folder repeats directory as DTO id/path/name and adds monogram/activity text.
  return id + title + parentId + directory * 3 + 56;
}

/** Runs inside the dedicated SQLite worker. */
export function readKiloSessionsInCurrentThread(
  options: ReadKiloSessionsOptions = {},
): KiloDataWorkerResult {
  assertSupportedKiloVersion(options.kiloVersion);
  const databasePath = resolveKiloDatabasePath(options);

  return withReadOnlyDatabase(databasePath, (database) => {
    assertCompatibleSchema(database);
    const sessions: RawSessionMetadata[] = [];
    const warnings: string[] = [];
    let rowCount = 0;
    let characterCount = 0;
    const rows = database.prepare(KILO_METADATA_QUERY).iterate() as Iterable<Record<string, unknown>>;
    for (const row of rows) {
      rowCount += 1;
      if (rowCount > KILO_METADATA_LIMITS.rows) {
        throw new KiloDataSourceError(
          `Kilo metadata превышают лимит ${KILO_METADATA_LIMITS.rows} строк.`,
        );
      }
      characterCount += metadataCharacterCount(row);
      if (characterCount > KILO_METADATA_LIMITS.characters) {
        throw new KiloDataSourceError('Kilo metadata превышают допустимый объём текста.');
      }

      const session = validateSessionRow(row);
      if (session) {
        sessions.push(session);
      } else {
        if (warnings.length < MAX_WARNING_COUNT) {
          warnings.push(`Строка session #${rowCount} пропущена: некорректные metadata-поля.`);
        } else if (warnings.length === MAX_WARNING_COUNT) {
          warnings.push('Дополнительные предупреждения о повреждённых session подавлены.');
        }
      }
    }
    return { sessions, warnings };
  });
}

/** Reads root, non-archived metadata without blocking the Extension Host event loop. */
export function readKiloSessions(
  options: ReadKiloSessionsOptions = {},
): Promise<RawSessionMetadata[]> {
  const workerOptions: Omit<ReadKiloSessionsOptions, 'onWarning'> = {
    env: options.env ?? process.env,
    homeDirectory: options.homeDirectory,
    platform: options.platform ?? process.platform,
    kiloVersion: options.kiloVersion,
  };

  return new Promise((resolve, reject) => {
    const worker = new Worker(win32.join(__dirname, 'kiloDataWorker.js'), {
      workerData: workerOptions,
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
      },
    });
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      worker.removeListener('message', onMessage);
      worker.removeListener('error', onError);
      worker.removeListener('exit', onExit);
      worker.unref();
    };
    const settle = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      action();
    };

    const onMessage = (response: KiloDataWorkerResponse): void => {
      settle(() => {
        if (response.error !== undefined) {
          const error = new KiloDataSourceError(response.error.message);
          error.stack = response.error.stack ?? error.stack;
          reject(error);
          return;
        }
        if (response.result === undefined) {
          reject(new KiloDataSourceError('SQLite worker вернул некорректный ответ.'));
          return;
        }
        response.result.warnings.forEach((warning) => options.onWarning?.(warning));
        resolve(response.result.sessions);
      });
    };
    const onError = (error: Error): void => settle(() => reject(error));
    const onExit = (code: number): void => {
      settle(() => reject(new KiloDataSourceError(
        code === 0
          ? 'SQLite worker завершился без ответа.'
          : `SQLite worker завершился с кодом ${code}.`,
      )));
    };

    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      const timeoutError = new KiloDataSourceError(
        `SQLite worker превысил лимит ${WORKER_TIMEOUT_MS} ms.`,
      );
      void worker.terminate().then(
        () => reject(timeoutError),
        (terminationError: unknown) => reject(new KiloDataSourceError(
          timeoutError.message,
          { cause: terminationError },
        )),
      );
    }, WORKER_TIMEOUT_MS);
  });
}
