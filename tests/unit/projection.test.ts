import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeWindowsDirectory, projectSessions } from '../../src/projection.js';
import type { RawSessionMetadata } from '../../src/types.js';

function session(
  id: string,
  directory: string | null,
  overrides: Partial<RawSessionMetadata> = {},
): RawSessionMetadata {
  return {
    id,
    title: `Title ${id}`,
    directory,
    parentId: null,
    timeCreated: null,
    timeArchived: null,
    timeUpdated: null,
    ...overrides,
  };
}

const available = (): Promise<boolean> => Promise.resolve(true);

void test('normalizes absolute Windows paths and local file URIs', () => {
  assert.deepEqual(normalizeWindowsDirectory('c:/Work//Kilo/./Project/'), {
    path: 'C:\\Work\\Kilo\\Project',
    key: 'c:\\work\\kilo\\project',
    uri: 'file:///C:/Work/Kilo/Project',
    name: 'Project',
  });
  assert.deepEqual(normalizeWindowsDirectory('file:///d:/My%20Projects/%D0%A2%D0%B5%D1%81%D1%82'), {
    path: 'D:\\My Projects\\Тест',
    key: 'd:\\my projects\\тест',
    uri: 'file:///D:/My%20Projects/%D0%A2%D0%B5%D1%81%D1%82',
    name: 'Тест',
  });
  assert.equal(normalizeWindowsDirectory('file://localhost/C:/repo')?.path, 'C:\\repo');
  assert.equal(normalizeWindowsDirectory('C:\\repo\\child\\..')?.path, 'C:\\repo');
  assert.equal(normalizeWindowsDirectory('C:\\')?.uri, 'file:///C:/');
});

void test('rejects UNC, remote, workspace-file, relative and malformed paths', () => {
  const unsupported = [
    '\\\\server\\share\\repo',
    '//server/share/repo',
    'file://server/share/repo',
    'vscode-remote://ssh-remote+host/home/repo',
    'vscode-remote://wsl+Ubuntu/home/repo',
    'vscode-remote://dev-container+abc/workspaces/repo',
    'C:\\work\\project.code-workspace',
    'c:/work/PROJECT.CODE-WORKSPACE/',
    'relative\\repo',
    'C:relative',
    'C:\\..\\repo',
    'C:\\repo\\bad?.txt',
    'C:\\repo\\NUL',
    'file:///C:/bad%ZZ',
    'file:///C:/repo?query=1',
  ];

  for (const path of unsupported) {
    assert.equal(normalizeWindowsDirectory(path), undefined, path);
  }
});

void test('filters non-root and archived sessions and groups paths case-insensitively', async () => {
  const checked: string[] = [];
  const folders = await projectSessions([
    session('one', 'C:\\Work\\Project', { timeUpdated: 1_700_000_000_000 }),
    session('two', 'c:/work/project/', { timeUpdated: 1_700_000_001_000 }),
    session('child', 'C:\\Other', { parentId: 'one' }),
    session('archived', 'C:\\Other', { timeArchived: 1_700_000_002_000 }),
    session('no-directory', null),
  ], {
    isDirectoryAvailable: (path) => {
      checked.push(path);
      return Promise.resolve(true);
    },
  });

  assert.equal(folders.length, 1);
  assert.equal(folders[0].id, 'c:\\work\\project');
  assert.equal(folders[0].path, 'C:\\work\\project');
  assert.equal(folders[0].uri, 'file:///C:/work/project');
  assert.deepEqual(folders[0].conversations.map(({ id }) => id), ['two', 'one']);
  assert.deepEqual(checked, ['C:\\work\\project']);
});

void test('chooses a deterministic display path for equivalent case variants', async () => {
  const firstOrder = await projectSessions([
    session('lower', 'C:\\repo', { timeUpdated: 100 }),
    session('upper', 'c:\\Repo', { timeUpdated: 100 }),
  ], { isDirectoryAvailable: available });
  const reversedOrder = await projectSessions([
    session('upper', 'c:\\Repo', { timeUpdated: 100 }),
    session('lower', 'C:\\repo', { timeUpdated: 100 }),
  ], { isDirectoryAvailable: available });

  assert.equal(firstOrder[0].uri, 'file:///C:/repo');
  assert.equal(firstOrder[0].path, 'C:\\repo');
  assert.equal(reversedOrder[0].uri, firstOrder[0].uri);
  assert.equal(reversedOrder[0].path, firstOrder[0].path);
  assert.equal(reversedOrder[0].name, firstOrder[0].name);
});

void test('uses untitled fallback and invokes the warning callback once', async () => {
  const warnings: string[] = [];
  const folders = await projectSessions([
    session('empty', 'C:\\repo', { title: '   ' }),
    session('empty', 'c:/REPO', { title: '   ' }),
    session('null', 'C:\\repo', { title: null }),
  ], { isDirectoryAvailable: available, onWarning: (warning) => warnings.push(warning) });

  assert.deepEqual(
    folders[0].conversations.map(({ id, title }) => ({ id, title })),
    [
      { id: 'empty', title: 'Без названия' },
      { id: 'null', title: 'Без названия' },
    ],
  );
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /empty.*Без названия/);
  assert.match(warnings[1], /null.*Без названия/);
});

void test('deduplicates by session id and excludes an ambiguous cross-folder id', async () => {
  const warnings: string[] = [];
  const folders = await projectSessions([
    session('duplicate', 'C:\\repo', { title: 'Old', timeUpdated: 100 }),
    session('duplicate', 'c:/REPO', { title: 'New', timeUpdated: 200 }),
    session('ambiguous', 'C:\\repo'),
    session('ambiguous', 'D:\\repo'),
    session('kept', 'D:\\repo'),
  ], {
    isDirectoryAvailable: available,
    onWarning: (warning) => warnings.push(warning),
  });

  assert.deepEqual(folders.flatMap(({ conversations }) => conversations.map(({ id }) => id)), [
    'duplicate',
    'kept',
  ]);
  assert.equal(folders[0].conversations[0].title, 'New');
  assert.deepEqual(warnings, [
    'Session "ambiguous" имеет конфликтующие directory; запись пропущена.',
  ]);
});

void test('sorts known timestamps first, then names and ids deterministically', async () => {
  const folders = await projectSessions([
    session('z-id', 'C:\\Zulu', { title: 'same', timeUpdated: '2025-01-01T00:00:00Z' }),
    session('a-id', 'C:\\Zulu', { title: 'same', timeUpdated: '2025-01-01T00:00:00Z' }),
    session('older', 'C:\\Zulu', { title: 'Older', timeUpdated: '2024-01-01T00:00:00Z' }),
    session('unknown-z', 'C:\\Zulu', { title: 'zeta' }),
    session('unknown-a', 'C:\\Zulu', { title: 'Alpha' }),
    session('folder-beta', 'C:\\beta', { title: 'No timestamp' }),
    session('folder-alpha', 'C:\\Alpha', { title: 'No timestamp' }),
  ], { isDirectoryAvailable: available });

  assert.deepEqual(folders.map(({ name }) => name), ['Zulu', 'Alpha', 'beta']);
  assert.deepEqual(folders[0].conversations.map(({ id }) => id), [
    'a-id',
    'z-id',
    'older',
    'unknown-a',
    'unknown-z',
  ]);
  assert.equal(folders[0].lastKiloActivityAt, '2025-01-01T00:00:00.000Z');
  assert.equal(folders[1].lastKiloActivityAt, undefined);
});

void test('checks availability asynchronously once per folder and contains checker failures', async () => {
  const folders = await projectSessions([
    session('available', 'C:\\available'),
    session('missing-one', 'C:\\missing'),
    session('missing-two', 'c:/MISSING'),
    session('error', 'C:\\error'),
  ], {
    isDirectoryAvailable: async (path) => {
      await Promise.resolve();
      if (path === 'C:\\error') throw new Error('unavailable');
      return path === 'C:\\available';
    },
  });

  assert.deepEqual(
    Object.fromEntries(folders.map(({ name, available: isAvailable }) => [name, isAvailable])),
    { available: true, error: false, missing: false },
  );
  assert.equal(folders.find(({ name }) => name === 'missing')?.conversations.length, 2);
});

void test('skips malformed runtime records without losing valid records', async () => {
  const warnings: string[] = [];
  const malformed = [
    session('', 'C:\\repo'),
    { ...session('bad-title', 'C:\\repo'), title: 42 },
    { ...session('missing-parent', 'C:\\repo'), parentId: undefined },
    { ...session('missing-archive', 'C:\\repo'), timeArchived: undefined },
  ] as unknown as RawSessionMetadata[];
  const folders = await projectSessions([
    ...malformed,
    session('valid', 'C:\\repo'),
    session('line\nbreak', '\\\\server\\share'),
  ], {
    isDirectoryAvailable: available,
    onWarning: (warning) => warnings.push(warning),
  });

  assert.deepEqual(folders[0].conversations.map(({ id }) => id), ['valid']);
  assert.ok(warnings.length >= malformed.length + 1);
  assert.ok(warnings.every((warning) => !warning.includes('\n')));
});

void test('projects 1000 sessions and checks each grouped directory only once', async () => {
  const checks = new Map<string, number>();
  let activeChecks = 0;
  let maximumActiveChecks = 0;
  const sessions = Array.from({ length: 1_000 }, (_, index) => session(
    `session-${index.toString().padStart(4, '0')}`,
    `C:\\projects\\project-${index % 100}`,
    { timeUpdated: 1_700_000_000_000 + index },
  ));

  const folders = await projectSessions(sessions, {
    isDirectoryAvailable: async (path) => {
      checks.set(path, (checks.get(path) ?? 0) + 1);
      activeChecks += 1;
      maximumActiveChecks = Math.max(maximumActiveChecks, activeChecks);
      await new Promise((resolve) => setImmediate(resolve));
      activeChecks -= 1;
      return true;
    },
  });

  assert.equal(folders.length, 100);
  assert.equal(folders.reduce((total, folder) => total + folder.conversations.length, 0), 1_000);
  assert.equal(checks.size, 100);
  assert.ok([...checks.values()].every((count) => count === 1));
  assert.ok(maximumActiveChecks <= 16);
});
