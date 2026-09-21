import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { after } from 'node:test';

import {
  KILO_METADATA_LIMITS,
  KILO_METADATA_QUERY,
  KiloDataSourceError,
  readKiloSessions,
  readKiloSessionsInCurrentThread,
  resolveKiloDatabasePath,
} from '../../src/kiloDataSource.js';

const tempDirectories: string[] = [];

const VALID_SCHEMA = `CREATE TABLE session (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  directory TEXT NOT NULL,
  parent_id TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  time_archived INTEGER
)`;

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kilo-hub-data-source-'));
  tempDirectories.push(directory);
  return directory;
}

function createDatabase(schema = VALID_SCHEMA): string {
  const databasePath = join(createTempDirectory(), 'kilo.db');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(schema);
  } finally {
    database.close();
  }
  return databasePath;
}

function insertSessions(
  databasePath: string,
  count: number,
  values: (index: number) => readonly [string, string, string],
): void {
  const database = new DatabaseSync(databasePath);
  try {
    const insert = database.prepare(`INSERT INTO session (
      id, title, directory, parent_id, time_created, time_updated, time_archived
    ) VALUES (?, ?, ?, NULL, 1000, 2000, NULL)`);
    database.exec('BEGIN');
    for (let index = 0; index < count; index += 1) {
      insert.run(...values(index));
    }
    database.exec('COMMIT');
  } finally {
    database.close();
  }
}

function fixedLengthId(index: number, length: number): string {
  const prefix = index.toString().padStart(8, '0');
  return `${prefix}${'i'.repeat(length - prefix.length)}`;
}

function readFixture(databasePath: string, overrides: { kiloVersion?: string; onWarning?: (message: string) => void } = {}) {
  const result = readKiloSessionsInCurrentThread({
    env: { KILO_DB: databasePath },
    platform: 'win32',
    ...overrides,
  });
  result.warnings.forEach((warning) => overrides.onWarning?.(warning));
  return result.sessions;
}

function snapshotFiles(directory: string): Map<string, Buffer> {
  return new Map(readdirSync(directory).sort().map((name) => [
    name,
    readFileSync(join(directory, name)),
  ]));
}

after(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('resolves KILO_DB, XDG_DATA_HOME and the default release path on Windows', () => {
  assert.equal(
    resolveKiloDatabasePath({
      env: { KILO_DB: 'D:\\databases\\current.db', XDG_DATA_HOME: 'relative\\ignored' },
      homeDirectory: 'also-relative',
      platform: 'win32',
    }),
    'D:\\databases\\current.db',
  );
  assert.equal(
    resolveKiloDatabasePath({
      env: { KILO_DB: 'profiles\\test.db', XDG_DATA_HOME: 'D:\\Kilo Data' },
      platform: 'win32',
    }),
    'D:\\Kilo Data\\kilo\\profiles\\test.db',
  );
  assert.equal(
    resolveKiloDatabasePath({
      env: { KILO_DB: '..\\shared.db', XDG_DATA_HOME: 'D:\\Kilo Data' },
      platform: 'win32',
    }),
    'D:\\Kilo Data\\shared.db',
  );
  assert.equal(
    resolveKiloDatabasePath({ env: { XDG_DATA_HOME: 'D:\\Data' }, platform: 'win32' }),
    'D:\\Data\\kilo\\kilo.db',
  );
  assert.equal(
    resolveKiloDatabasePath({ env: {}, homeDirectory: 'C:\\Users\\Tester', platform: 'win32' }),
    'C:\\Users\\Tester\\.local\\share\\kilo\\kilo.db',
  );
});

void test('rejects unsupported platforms, memory databases and invalid relative inputs', () => {
  assert.throws(
    () => resolveKiloDatabasePath({ env: {}, homeDirectory: '/home/test', platform: 'linux' }),
    /только Windows/,
  );
  assert.throws(
    () => resolveKiloDatabasePath({ env: { KILO_DB: ':memory:' }, homeDirectory: 'C:\\Users\\Tester', platform: 'win32' }),
    /:memory:/,
  );
  assert.throws(
    () => resolveKiloDatabasePath({ env: { KILO_DB: 'C:relative.db' }, homeDirectory: 'C:\\Users\\Tester', platform: 'win32' }),
    /относительный путь/,
  );
  assert.throws(
    () => resolveKiloDatabasePath({ env: { XDG_DATA_HOME: 'relative\\data' }, homeDirectory: 'C:\\Users\\Tester', platform: 'win32' }),
    /XDG_DATA_HOME/,
  );
  assert.throws(
    () => resolveKiloDatabasePath({ env: { KILO_DB: 'https://example.invalid/kilo.db' }, homeDirectory: 'C:\\Users\\Tester', platform: 'win32' }),
    /относительный путь/,
  );
});

void test('reads the exact root non-archived metadata projection and skips malformed rows', () => {
  const databasePath = createDatabase(`${VALID_SCHEMA};
    CREATE TABLE message (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    ALTER TABLE session ADD COLUMN future_metadata TEXT;
    INSERT INTO message VALUES ('message-1', 'SECRET BODY');
    INSERT INTO session VALUES
      ('root-new', 'Visible title', 'C:\\repo', NULL, 1000, 3000, NULL, 'ignored'),
      ('root-old', '', 'D:\\repo', NULL, 1000, 2000, NULL, NULL),
      ('child', 'Child title', 'C:\\repo', 'root-new', 1000, 4000, NULL, NULL),
      ('archived', 'Archived title', 'C:\\repo', NULL, 1000, 5000, 5001, NULL),
      ('malformed', 'PRIVATE TITLE', 'C:\\repo', NULL, 1000, 'bad timestamp', NULL, NULL);`);
  const warnings: string[] = [];

  const sessions = readFixture(databasePath, { onWarning: (warning) => warnings.push(warning) });

  assert.deepEqual(sessions, [
    {
      id: 'root-new',
      title: 'Visible title',
      directory: 'C:\\repo',
      timeCreated: 1000,
      timeUpdated: 3000,
      parentId: null,
      timeArchived: null,
    },
    {
      id: 'root-old',
      title: '',
      directory: 'D:\\repo',
      timeCreated: 1000,
      timeUpdated: 2000,
      parentId: null,
      timeArchived: null,
    },
  ]);
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /PRIVATE TITLE|SECRET BODY/);
  assert.match(warnings[0], /metadata-поля/);
});

void test('accepts exact field bounds and isolates rows over id, title or path limits', () => {
  const databasePath = createDatabase();
  const database = new DatabaseSync(databasePath);
  try {
    const insert = database.prepare(`INSERT INTO session (
      id, title, directory, parent_id, time_created, time_updated, time_archived
    ) VALUES (?, ?, ?, NULL, 1000, ?, NULL)`);
    insert.run(
      'i'.repeat(KILO_METADATA_LIMITS.idLength),
      't'.repeat(KILO_METADATA_LIMITS.textLength),
      'D:\\'.padEnd(KILO_METADATA_LIMITS.textLength, 'p'),
      4_000,
    );
    insert.run('i'.repeat(KILO_METADATA_LIMITS.idLength + 1), 'title', 'C:\\id', 3_000);
    insert.run('title-over', 't'.repeat(KILO_METADATA_LIMITS.textLength + 1), 'C:\\title', 2_000);
    insert.run('path-over', 'title', 'D:\\'.padEnd(KILO_METADATA_LIMITS.textLength + 1, 'p'), 1_000);
    database.prepare(`INSERT INTO session (
      id, title, directory, parent_id, time_created, time_updated, time_archived
    ) VALUES (?, ?, ?, NULL, ?, ?, NULL)`).run(
      'timestamp-blob',
      'title',
      'C:\\time',
      new Uint8Array(1024 * 1024),
      5_000,
    );
  } finally {
    database.close();
  }
  const warnings: string[] = [];

  const sessions = readFixture(databasePath, { onWarning: (warning) => warnings.push(warning) });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.id.length, KILO_METADATA_LIMITS.idLength);
  assert.equal(sessions[0]?.title?.length, KILO_METADATA_LIMITS.textLength);
  assert.equal(sessions[0]?.directory?.length, KILO_METADATA_LIMITS.textLength);
  assert.equal(warnings.length, 4);
});

void test('accepts exact row and total text budgets and rejects the first excess row', () => {
  const rowDatabasePath = createDatabase();
  insertSessions(rowDatabasePath, KILO_METADATA_LIMITS.rows, (index) => [
    `session-${index}`,
    't',
    'C:\\rows',
  ]);
  assert.equal(readFixture(rowDatabasePath).length, KILO_METADATA_LIMITS.rows);

  const rowDatabase = new DatabaseSync(rowDatabasePath);
  try {
    rowDatabase.prepare(`INSERT INTO session VALUES (
      'row-over', 't', 'C:\\rows', NULL, 1000, 3000, NULL
    )`).run();
  } finally {
    rowDatabase.close();
  }
  assert.throws(() => readFixture(rowDatabasePath), /лимит 10000 строк/);

  const textDatabasePath = createDatabase();
  insertSessions(textDatabasePath, 247, (index) => [
    fixedLengthId(index, KILO_METADATA_LIMITS.idLength),
    't'.repeat(KILO_METADATA_LIMITS.textLength),
    'D:\\'.padEnd(KILO_METADATA_LIMITS.textLength, 'p'),
  ]);
  insertSessions(textDatabasePath, 1, () => [
    fixedLengthId(247, KILO_METADATA_LIMITS.idLength),
    't'.repeat(KILO_METADATA_LIMITS.textLength),
    'D:\\'.padEnd(832, 'p'),
  ]);
  assert.equal(readFixture(textDatabasePath).length, 248);

  const textDatabase = new DatabaseSync(textDatabasePath);
  try {
    textDatabase.prepare(`INSERT INTO session VALUES (
      'over', 't', 'C:\\x', NULL, 1000, 3000, NULL
    )`).run();
  } finally {
    textDatabase.close();
  }
  assert.throws(() => readFixture(textDatabasePath), /допустимый объём текста/);
});

void test('bounds rows in SQL without materializing a full ORDER BY sort', () => {
  const databasePath = createDatabase();
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const plan = database.prepare(`EXPLAIN QUERY PLAN ${KILO_METADATA_QUERY}`).all() as Array<Record<string, unknown>>;
    const details = plan.map(({ detail }) => String(detail)).join('\n');
    assert.doesNotMatch(details, /TEMP B-TREE|ORDER BY/i);
    assert.match(KILO_METADATA_QUERY, /LIMIT 10001/u);
    assert.match(KILO_METADATA_QUERY, /substr\(id, 1, 513\)/u);
    assert.match(KILO_METADATA_QUERY, /substr\(title, 1, 4097\)/u);
    assert.match(KILO_METADATA_QUERY, /substr\(directory, 1, 4097\)/u);
    assert.match(KILO_METADATA_QUERY, /typeof\(time_created\) = 'integer'/u);
    assert.match(KILO_METADATA_QUERY, /typeof\(time_updated\) = 'integer'/u);
  } finally {
    database.close();
  }
});

void test('rejects known Kilo versions below 7.7.5 before opening SQLite', () => {
  const missingPath = join(createTempDirectory(), 'does-not-exist.db');
  assert.throws(
    () => readFixture(missingPath, { kiloVersion: '7.7.4' }),
    (error: unknown) => error instanceof KiloDataSourceError && /7\.7\.5/.test(error.message),
  );
  assert.throws(
    () => readFixture(missingPath, { kiloVersion: '7.7.5-beta.1' }),
    /7\.7\.5/,
  );

  const databasePath = createDatabase();
  assert.deepEqual(readFixture(databasePath, { kiloVersion: '7.7.5' }), []);
  assert.deepEqual(readFixture(databasePath, { kiloVersion: '8.0.0' }), []);
});

void test('enforces the seven-column structural schema guard', async (context) => {
  const cases = [
    {
      name: 'missing session table',
      schema: 'CREATE TABLE other (id TEXT)',
      expected: /таблица session/,
    },
    {
      name: 'missing required column',
      schema: VALID_SCHEMA.replace(',\n  time_archived INTEGER', ''),
      expected: /time_archived/,
    },
    {
      name: 'wrong declared type',
      schema: VALID_SCHEMA.replace('title TEXT NOT NULL', 'title BLOB NOT NULL'),
      expected: /session\.title/,
    },
    {
      name: 'missing id primary key',
      schema: VALID_SCHEMA.replace('id TEXT PRIMARY KEY', 'id TEXT NOT NULL'),
      expected: /session\.id/,
    },
    {
      name: 'wrong nullability',
      schema: VALID_SCHEMA.replace('directory TEXT NOT NULL', 'directory TEXT'),
      expected: /session\.directory/,
    },
  ];

  for (const fixture of cases) {
    await context.test(fixture.name, () => {
      const databasePath = createDatabase(fixture.schema);
      assert.throws(() => readFixture(databasePath), fixture.expected);
    });
  }
});

void test('uses a 5000 ms query-only read-only connection with extensions disabled', () => {
  const databasePath = createDatabase();
  const beforeBytes = readFileSync(databasePath);
  const beforeFiles = readdirSync(win32.dirname(databasePath)).sort();
  const probe = new DatabaseSync(databasePath, {
    readOnly: true,
    timeout: 5_000,
    allowExtension: false,
  });

  try {
    probe.exec('PRAGMA query_only = ON');
    const queryOnly = probe.prepare('PRAGMA query_only').get() as Record<string, unknown>;
    const busyTimeout = probe.prepare('PRAGMA busy_timeout').get() as Record<string, unknown>;
    assert.equal(queryOnly.query_only, 1);
    assert.equal(busyTimeout.timeout, 5_000);
    assert.throws(() => probe.exec('CREATE TABLE forbidden (id INTEGER)'), /readonly/i);
    assert.throws(() => probe.loadExtension('missing-extension'), /extension loading is not allowed/i);
  } finally {
    probe.close();
  }

  assert.deepEqual(readFixture(databasePath), []);
  assert.deepEqual(readFileSync(databasePath), beforeBytes);
  assert.deepEqual(readdirSync(win32.dirname(databasePath)).sort(), beforeFiles);
});

void test('sees a committed transaction that remains in WAL', () => {
  const databasePath = join(createTempDirectory(), 'kilo.db');
  const writer = new DatabaseSync(databasePath);
  try {
    writer.exec(`PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      ${VALID_SCHEMA};
      INSERT INTO session VALUES ('wal-session', 'WAL title', 'C:\\wal', NULL, 1000, 2000, NULL);`);

    assert.equal(existsSync(`${databasePath}-wal`), true);
    const before = snapshotFiles(win32.dirname(databasePath));
    assert.deepEqual(readFixture(databasePath).map(({ id }) => id), ['wal-session']);
    const after = snapshotFiles(win32.dirname(databasePath));
    assert.deepEqual([...after.keys()], [...before.keys()]);
    assert.deepEqual(after.get('kilo.db'), before.get('kilo.db'));
    assert.deepEqual(after.get('kilo.db-wal'), before.get('kilo.db-wal'));
    assert.equal(after.get('kilo.db-shm')?.length, before.get('kilo.db-shm')?.length);
  } finally {
    writer.close();
  }
});

void test('bounds SQLITE_BUSY waiting under an exclusive lock', () => {
  const databasePath = createDatabase();
  const writer = new DatabaseSync(databasePath);
  try {
    writer.exec('BEGIN EXCLUSIVE');
    const startedAt = performance.now();
    assert.throws(
      () => readFixture(databasePath),
      /busy|locked/i,
    );
    const elapsed = performance.now() - startedAt;
    assert.ok(elapsed >= 4_500, `busy timeout завершился слишком рано: ${elapsed} ms`);
    assert.ok(elapsed < 9_000, `busy timeout превысил допустимую границу: ${elapsed} ms`);
  } finally {
    writer.exec('ROLLBACK');
    writer.close();
  }
});

void test('keeps the event loop responsive while the SQLite worker is busy', async () => {
  const databasePath = createDatabase();
  const writer = new DatabaseSync(databasePath);
  try {
    writer.exec('BEGIN EXCLUSIVE');
    let timerFired = false;
    const timer = setTimeout(() => {
      timerFired = true;
    }, 50);
    const read = readKiloSessions({
      env: { KILO_DB: databasePath },
      platform: 'win32',
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    clearTimeout(timer);
    assert.equal(timerFired, true);
    await assert.rejects(read, /busy|locked/i);
  } finally {
    writer.exec('ROLLBACK');
    writer.close();
  }
});

void test('closes the database after successful reads and schema failures', () => {
  const validPath = createDatabase();
  readFixture(validPath);
  unlinkSync(validPath);
  assert.equal(existsSync(validPath), false);

  const invalidPath = createDatabase('CREATE TABLE other (id TEXT)');
  assert.throws(() => readFixture(invalidPath), /таблица session/);
  unlinkSync(invalidPath);
  assert.equal(existsSync(invalidPath), false);
});
