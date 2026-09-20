import assert from 'node:assert/strict';
import test from 'node:test';

import {
  colorContrast,
  createAdaptiveFolderPalette,
  createFolderMonogram,
  FOLDER_COLOR_SLOT_ORDER,
  fnv1aUtf16,
  folderColorSlot,
  formatRelativeActivity,
  normalizeFolderColorPath,
  presentFolders,
  reliableIsoTimestamp,
} from '../../src/presentation.js';
import type { KiloConversation, KiloFolder } from '../../src/types.js';

const NOW = Date.parse('2026-09-20T12:00:00.000Z');

function isoDaysAgo(days: number, hour = 10, minute = 5): string {
  return new Date(Date.UTC(2026, 8, 20 - days, hour, minute)).toISOString();
}

function folder(
  id: string,
  name: string,
  path: string,
  conversations: readonly KiloConversation[],
  available = true,
): KiloFolder {
  return {
    id,
    path,
    uri: `file:///${path.replaceAll('\\', '/')}`,
    name,
    available,
    conversations: [...conversations],
  };
}

void test('formats every relative-date boundary and Russian plural form', () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [0, 'Сегодня, 10:05'],
    [1, 'Вчера'],
    [2, '2 дня назад'],
    [6, '6 дней назад'],
    [7, 'Неделю назад'],
    [13, 'Неделю назад'],
    [14, '2 недели назад'],
    [20, '2 недели назад'],
    [21, '3 недели назад'],
    [29, '3 недели назад'],
    [30, 'Месяц назад'],
    [59, 'Месяц назад'],
    [60, '2 месяца назад'],
    [330, '11 месяцев назад'],
    [364, '12 месяцев назад'],
    [365, 'Год назад'],
    [730, '2 года назад'],
    [1_825, '5 лет назад'],
  ];

  for (const [days, expected] of cases) {
    assert.equal(
      formatRelativeActivity(isoDaysAgo(days), { now: NOW, timeZone: 'UTC' }),
      expected,
      `${days} calendar days`,
    );
  }
});

void test('rejects future-today, invalid, missing and non-explicit ISO dates', () => {
  const cases: ReadonlyArray<readonly [unknown, string]> = [
    ['2026-09-20T12:00:00.001Z', 'future today'],
    ['2026-02-29T10:00:00Z', 'invalid calendar date'],
    ['2026-09-20T24:00:00Z', 'invalid hour'],
    ['2026-09-20T10:00:60Z', 'invalid second'],
    ['2026-09-20T10:00:00', 'missing explicit zone'],
    ['not-a-date', 'malformed'],
    [undefined, 'missing'],
  ];

  for (const [value, label] of cases) {
    assert.equal(
      formatRelativeActivity(value, { now: NOW, timeZone: 'UTC' }),
      'Дата неизвестна',
      label,
    );
  }
  assert.equal(reliableIsoTimestamp('2026-09-20T12:00:00.000Z', NOW), NOW);
});

void test('uses calendar dates across DST and leap day', () => {
  assert.equal(
    formatRelativeActivity('2024-03-10T06:30:00.000Z', {
      now: Date.parse('2024-03-11T04:30:00.000Z'),
      timeZone: 'America/New_York',
    }),
    'Вчера',
  );
  assert.equal(
    formatRelativeActivity('2024-11-03T04:30:00.000Z', {
      now: Date.parse('2024-11-04T05:30:00.000Z'),
      timeZone: 'America/New_York',
    }),
    'Вчера',
  );
  assert.equal(
    formatRelativeActivity('2024-02-29T23:30:00.000Z', {
      now: Date.parse('2024-03-01T12:00:00.000Z'),
      timeZone: 'UTC',
    }),
    'Вчера',
  );
});

void test('sorts folders and conversations deterministically and limits display to three', () => {
  const equalActivity = '2026-09-19T10:00:00.000Z';
  const source = [
    folder('c:\\z-current', 'Current', 'C:\\z-current', [
      { id: 'old', title: 'Old', updatedAt: '2020-01-01T00:00:00.000Z' },
    ]),
    folder('c:\\b\\same', 'Дубликат', 'C:\\b\\same', [
      { id: 'z', title: 'Same', updatedAt: equalActivity },
    ]),
    folder('c:\\a\\same', 'Дубликат', 'C:\\a\\same', [
      { id: 'a', title: 'Same', updatedAt: equalActivity },
    ]),
    folder('c:\\recent', 'Recent', 'C:\\recent', [
      { id: 'future', title: 'Future', updatedAt: '2026-09-20T12:00:00.001Z' },
      { id: 'invalid', title: 'Invalid', updatedAt: 'bad' },
      { id: 'third', title: 'Third', updatedAt: '2026-09-17T00:00:00Z' },
      { id: 'first-z', title: 'Same', updatedAt: '2026-09-19T11:00:00Z' },
      { id: 'first-a', title: 'Same', updatedAt: '2026-09-19T11:00:00Z' },
      { id: 'second', title: '', updatedAt: '2026-09-18T00:00:00Z' },
    ]),
    folder('c:\\unknown-z', 'Zulu', 'C:\\unknown-z', [
      { id: 'unknown', title: 'Unknown' },
    ]),
    folder('c:\\unknown-a', 'Alpha', 'C:\\unknown-a', [
      { id: 'unknown', title: 'Unknown', updatedAt: '2027-01-01T00:00:00Z' },
    ]),
  ];
  const unchanged = structuredClone(source);

  const presented = presentFolders(source, {
    currentFolderId: 'c:\\z-current',
    now: NOW,
  });
  const reordered = presentFolders([...source].reverse(), {
    currentFolderId: 'c:\\z-current',
    now: NOW,
  });

  assert.deepEqual(presented, reordered);
  assert.deepEqual(source, unchanged);
  assert.deepEqual(presented.map(({ id }) => id), [
    'c:\\z-current',
    'c:\\recent',
    'c:\\a\\same',
    'c:\\b\\same',
    'c:\\unknown-a',
    'c:\\unknown-z',
  ]);
  const recent = presented.find(({ id }) => id === 'c:\\recent');
  assert.equal(recent?.activity, '2026-09-19T11:00:00.000Z');
  assert.deepEqual(recent?.conversations, [
    { id: 'first-a', title: 'Same' },
    { id: 'first-z', title: 'Same' },
    { id: 'second', title: 'Без названия' },
  ]);
  assert.equal(presented[0].current, true);
  assert.equal(presented.slice(1).every(({ current }) => !current), true);
});

void test('derives monograms from NFC Unicode graphemes, digits and safe basename fallback', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['Альфа Бета', 'C:\\x', 'АБ'],
    ['е\u0308лка', 'C:\\x', 'ЁЛ'],
    ['東京', 'C:\\x', '東京'],
    ['123 архив', 'C:\\x', '1А'],
    ['👩‍💻 project', 'C:\\x', 'PR'],
    ['A', 'C:\\x', 'A'],
    ['---', 'C:\\Проекты\\Работа', 'РА'],
    ['📁', 'C:\\123', '12'],
    ['📁', 'not-local', '?'],
  ];
  for (const [name, path, expected] of cases) {
    const monogram = createFolderMonogram(name, path);
    assert.equal(monogram, expected, `${name} at ${path}`);
    assert.equal(monogram, monogram.normalize('NFC'));
    assert.ok([...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(monogram)].length <= 2);
  }
});

void test('matches color normalization, FNV-1a and all sixteen reference slots', () => {
  const equivalent = [
    'D:/Примеры/Папка/',
    'd:\\ПРИМЕРЫ\\папка',
    'D:\\Примеры\\.\\Папка',
    'D:\\Примеры\\другая\\..\\Папка',
  ];
  assert.ok(equivalent.every((path) => folderColorSlot(path) === folderColorSlot(equivalent[0])));
  assert.equal(normalizeFolderColorPath('D:/Примеры/Папка/'), 'd:\\примеры\\папка');
  assert.equal(fnv1aUtf16('hello'), 1_335_831_723);

  const references: ReadonlyArray<readonly [string, number]> = [
    ['D:\\Reference\\Folder-5', 0],
    ['D:\\Reference\\Folder-17', 1],
    ['D:\\Reference\\Folder-3', 2],
    ['D:\\Reference\\Folder-4', 3],
    ['D:\\Reference\\Folder-9', 4],
    ['D:\\Reference\\Folder-2', 5],
    ['D:\\Reference\\Folder-7', 6],
    ['D:\\Reference\\Folder-8', 7],
    ['D:\\Reference\\Folder-14', 8],
    ['D:\\Reference\\Folder-6', 9],
    ['D:\\Reference\\Folder-12', 10],
    ['D:\\Reference\\Folder-15', 11],
    ['D:\\Reference\\Folder-1', 12],
    ['D:\\Reference\\Folder-13', 13],
    ['D:\\Reference\\Folder-16', 14],
    ['D:\\Reference\\Folder-0', 15],
  ];
  for (const [path, expected] of references) {
    assert.equal(folderColorSlot(path), expected, path);
  }
  assert.deepEqual([...FOLDER_COLOR_SLOT_ORDER].sort((left, right) => left - right),
    Array.from({ length: 16 }, (_, index) => index));

  const invalid = [
    '', 'relative', 'D:relative', 'D:\\..\\x', '\\\\server\\share',
    'D:\\bad?', 'D:\\folder.', 'file:///D:/folder', 'D:\\NUL',
  ];
  for (const path of invalid) assert.equal(folderColorSlot(path), null, path);
});

void test('computes adaptive palettes and readable high-contrast borders as a pure helper', () => {
  assert.deepEqual(createAdaptiveFolderPalette(0, [255, 255, 255]), {
    background: [244, 222, 202],
    foreground: [82, 58, 46],
    border: null,
  });
  assert.deepEqual(createAdaptiveFolderPalette(0, [37, 37, 38]), {
    background: [89, 66, 54],
    foreground: [237, 227, 222],
    border: null,
  });
  assert.deepEqual(createAdaptiveFolderPalette(15, [0, 0, 0], { highContrast: true }), {
    background: [79, 89, 54],
    foreground: [233, 237, 222],
    border: [255, 255, 255],
  });

  for (let slot = 0; slot < 16; slot += 1) {
    const palette = createAdaptiveFolderPalette(slot, [243, 243, 243]);
    assert.ok(colorContrast(palette.foreground, palette.background) >= 4.5);
  }
});

void test('presents 1000 conversations without losing domain data or display limits', () => {
  const conversations = Array.from({ length: 1_000 }, (_, index): KiloConversation => ({
    id: `session-${index.toString().padStart(4, '0')}`,
    title: `Conversation ${index}`,
    updatedAt: new Date(NOW - index * 1_000).toISOString(),
  }));
  const source = folder('c:\\bulk', 'Bulk', 'C:\\bulk', conversations);
  const [presented] = presentFolders([source], { currentFolderId: null, now: NOW });

  assert.equal(source.conversations.length, 1_000);
  assert.equal(presented.conversations.length, 3);
  assert.deepEqual(presented.conversations.map(({ id }) => id), [
    'session-0000', 'session-0001', 'session-0002',
  ]);
  assert.equal(presented.activity, new Date(NOW).toISOString());
});
