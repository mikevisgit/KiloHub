import { homedir } from 'node:os';
import { win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { RawSessionMetadata } from './types.js';

const MINIMUM_KILO_VERSION = [7, 7, 5] as const;
const DATABASE_TIMEOUT_MS = 5_000;

const METADATA_QUERY = `SELECT
  id,
  title,
  directory,
  time_created,
  time_updated,
  parent_id,
  time_archived
FROM session
WHERE parent_id IS NULL
  AND time_archived IS NULL
ORDER BY time_updated DESC`;

const REQUIRED_SESSION_COLUMNS = new Map<string, { type: string; notNull: boolean }>([
  ['id', { type: 'TEXT', notNull: true }],
  ['title', { type: 'TEXT', notNull: true }],
  ['directory', { type: 'TEXT', notNull: true }],
  ['parent_id', { type: 'TEXT', notNull: false }],
  ['time_created', { type: 'INTEGER', notNull: true }],
  ['time_updated', { type: 'INTEGER', notNull: true }],
  ['time_archived', { type: 'INTEGER', notNull: false }],
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

interface SessionColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
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
      ? [{ name: row.name, type: row.type.trim().toUpperCase(), notNull: row.notnull === 1 }]
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
    if (actual.type !== expected.type || actual.notNull !== expected.notNull) {
      throw new KiloDataSourceError(`Несовместимая schema Kilo: неверная структура session.${name}.`);
    }
  }

  // Preparing the production query is the final compatibility check.
  database.prepare(METADATA_QUERY);
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
    || typeof row.title !== 'string'
    || typeof row.directory !== 'string'
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

/** Reads only root, non-archived Kilo session metadata. */
export function readKiloSessions(options: ReadKiloSessionsOptions = {}): RawSessionMetadata[] {
  assertSupportedKiloVersion(options.kiloVersion);
  const databasePath = resolveKiloDatabasePath(options);

  return withReadOnlyDatabase(databasePath, (database) => {
    assertCompatibleSchema(database);
    const rows = database.prepare(METADATA_QUERY).all() as Array<Record<string, unknown>>;
    const sessions: RawSessionMetadata[] = [];
    rows.forEach((row, index) => {
      const session = validateSessionRow(row);
      if (session) {
        sessions.push(session);
      } else {
        options.onWarning?.(`Строка session #${index + 1} пропущена: некорректные metadata-поля.`);
      }
    });
    return sessions;
  });
}
