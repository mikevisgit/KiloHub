'use strict';

// Synthetic discovery only. No source database, filesystem corpus or production imports.
// Run with bundled Code.exe and ELECTRON_RUN_AS_NODE=1, not an Extension Host.
const assert = require('node:assert/strict');
const process = require('node:process');
const console = require('node:console');
const { Buffer } = require('node:buffer');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');

assert.equal(process.argv.length, 2, 'This probe accepts no paths or arguments');
assert.ok(process.versions.electron, 'Use the bundled VS Code Electron runtime');
const started = performance.now();
const normalize = (text) => text.normalize('NFC').toLowerCase().replace(/\u0451/g, '\u0435').normalize('NFC');
const tokenize = (text) => [...new Set(normalize(text).trim().split(/\s+/u).filter(Boolean))];
const folders = 1000;
const rows = [];
const special = new Map([
  ['0:0:0', '\u0421\u0410\u0419\u0422 nameonly'],
  ['0:1:0', '\u041a\u043e\u0440\u0437\u0438\u043d\u0430 \u0437\u0430\u043a\u0430\u0437 titleonly'],
  ['0:1:9', '\u0432\u043e\u0437\u0432\u0440\u0430\u0442 oldtitle'],
  ['0:2:0', '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043e\u043f\u043b\u0430\u0442\u0443 \u0401\u0436\u0438\u043a Cafe\u0301 %_* "quoted" a"b O\'Reilly'],
  ['0:2:1', 'separatepart crossalpha'],
  ['0:2:99', 'crossbeta oldmessage'],
  ['1:2:0', 'leftunique boundaryleft'],
  ['1:2:1', 'boundaryright'],
  ['2:2:0', 'rightunique'],
  ['3:2:0', 'abXbcXcd'],
  ['4:2:0', '\ud83d\ude80\ud83d\ude80\ud83d\ude80 \u0130stanbul'],
  ['5:0:0', 'rankneedle'],
  ['6:1:0', 'rankneedle'],
  ['7:2:0', 'rankneedle'],
]);
let sourceBytes = 0;
let longestField = 0;
for (let folder = 0; folder < folders; folder++) {
  for (const [kind, count] of [[0, 1], [1, 10], [2, 100]]) {
    for (let part = 0; part < count; part++) {
      let raw = special.get(`${folder}:${kind}:${part}`);
      if (raw === undefined) {
        raw = `Synthetic ${['folder', 'title', 'user'][kind]} ${folder} item ${part} group${folder % 31} common `;
        if (kind === 2) raw += `Generated payload segment${part % 17} stable reproducible text for substring testing. `.repeat(2);
        if (kind === 2 && part === 98 && folder % 10 === 0) raw += 'long synthetic content '.repeat(800) + 'longtailmarker';
      }
      const text = normalize(raw);
      const bytes = Buffer.byteLength(text);
      sourceBytes += bytes;
      longestField = Math.max(longestField, bytes);
      rows.push({ id: rows.length + 1, folder, kind, text });
    }
  }
}

const db = new DatabaseSync(':memory:');
const round = (number) => Math.round(number * 100) / 100;
const databaseBytes = () => db.prepare('PRAGMA page_count').get().page_count * db.prepare('PRAGMA page_size').get().page_size;
function combine(maps) {
  if (maps.length === 0) return Array.from({ length: folders }, (_, id) => [id, 0]);
  return [...maps[0]].filter(([id]) => maps.every((map) => map.has(id)))
    .map(([id]) => [id, Math.max(...maps.map((map) => map.get(id)))])
    .sort((a, b) => a[0] - b[0]);
}
function oracle(tokens) {
  return combine(tokens.map((token) => {
    const matches = new Map();
    for (const row of rows) {
      if (row.text.includes(token)) matches.set(row.folder, Math.min(matches.get(row.folder) ?? 2, row.kind));
    }
    return matches;
  }));
}
try {
  db.exec('PRAGMA temp_store=MEMORY; CREATE TABLE fields(id INTEGER PRIMARY KEY, folder INTEGER NOT NULL, kind INTEGER NOT NULL, text TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO fields VALUES (?, ?, ?, ?)');
  const loadStart = performance.now();
  db.exec('BEGIN');
  for (const row of rows) insert.run(row.id, row.folder, row.kind, row.text);
  db.exec('COMMIT');
  const loadMs = performance.now() - loadStart;
  const baseBytes = databaseBytes();
  const indexStart = performance.now();
  // Explicit case sensitivity avoids a second, different Unicode folding in FTS.
  db.exec("CREATE VIRTUAL TABLE grams USING fts5(text, content='fields', content_rowid='id', tokenize='trigram case_sensitive 1'); INSERT INTO grams(grams) VALUES ('rebuild')");
  const indexMs = performance.now() - indexStart;
  const indexedBytes = databaseBytes();
  const literal = db.prepare('SELECT folder, min(kind) AS kind FROM fields WHERE instr(text, ?) > 0 GROUP BY folder');
  const trigram = db.prepare('SELECT f.folder, min(f.kind) AS kind FROM grams JOIN fields f ON f.id = grams.rowid WHERE grams MATCH ? AND instr(f.text, ?) > 0 GROUP BY f.folder');
  const phrase = (token) => `"${token.replace(/"/g, '""')}"`;
  const search = (tokens, useFts) => combine(tokens.map((token) => {
    const result = useFts && [...token].length >= 3 && !token.includes('\0')
      ? trigram.all(phrase(token), token) : literal.all(token);
    return new Map(result.map((row) => [row.folder, row.kind]));
  }));
  const cases = [
    ['empty', ''], ['empty', ' \t\n '],
    ['short', 'a'], ['short', 'sy'], ['short', '\u0435'], ['short', '\u0451\u0436'],
    ['short', '%'], ['short', '_'], ['short', '*'], ['short', '"'],
    ['short', '\ud83d\ude80'], ['short', '\ud83d\ude80\ud83d\ude80'],
    ['punctuation', '%_*'], ['punctuation', '"quoted"'], ['punctuation', 'a"b'],
    ['punctuation', "O'Reilly"], ['punctuation', '" OR *'], ['punctuation', "';DROP"],
    ['unicode', '\u0401\u0416\u0418\u041a'], ['unicode', 'CAF\u00c9'], ['unicode', 'CAFE\u0301'],
    ['unicode', '\ud83d\ude80\ud83d\ude80\ud83d\ude80'], ['unicode', '\u0130STANBUL'],
    ['and', '\u0421\u0410\u0419\u0422 \u043e\u043f\u043b\u0430\u0442'],
    ['and', '\u0437\u0430\u043a\u0430\u0437 \u0432\u043e\u0437\u0432\u0440\u0430\u0442'],
    ['and', 'crossalpha crossbeta'], ['and', 'nameonly titleonly oldmessage'],
    ['and', '  NAMEONLY\tnameonly\noldtitle '], ['and', 'leftunique rightunique'],
    ['and', 'nameonly %'], ['negative', 'boundaryleftboundaryright'],
    ['negative', 'abcd'], ['negative', 'pathonlynotindexed'], ['negative', 'absentneedle'],
    ['selective', 'rankneedle'], ['selective', 'group17 segment13'], ['selective', 'oldmessage'],
    ['broad', 'common'], ['broad', 'synthetic'], ['broad', 'synthetic common text'],
    ['long', 'longtailmarker'], ['long', 'content'.repeat(1000)],
  ];
  let checks = 0;
  const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  check(tokenize(' \u0401 \u0415 \u0435 '), ['\u0435']);
  check(tokenize('CAFE\u0301 CAF\u00c9'), ['caf\u00e9']);
  check(oracle(tokenize('nameonly titleonly oldmessage')), [[0, 2]]);
  check(oracle(tokenize('rankneedle')), [[5, 0], [6, 1], [7, 2]]);
  check(oracle(tokenize('leftunique rightunique')), []);
  check(oracle(tokenize('boundaryleftboundaryright')), []);
  check(oracle(tokenize('abcd')), []);
  check(db.prepare('SELECT count(*) AS n FROM grams WHERE grams MATCH ?').get(phrase('sy')).n, 0);
  assert.ok(literal.all('sy').length > 0); checks++;
  const expected = cases.map(([, query]) => oracle(tokenize(query)));
  const samples = new Map();
  const record = (category, mode, ms) => {
    const key = `${category}/${mode}`;
    if (!samples.has(key)) samples.set(key, []);
    samples.get(key).push(ms);
  };
  // One warmup plus three measured rounds; alternate method order to reduce bias.
  for (let repeat = -1; repeat < 3; repeat++) {
    for (let i = 0; i < cases.length; i++) {
      const [category, query] = cases[i];
      const tokens = tokenize(query);
      for (const useFts of repeat % 2 === 0 ? [true, false] : [false, true]) {
        const begin = performance.now();
        const result = search(tokens, useFts);
        const elapsed = performance.now() - begin;
        check(result, expected[i]);
        if (repeat >= 0) record(category, useFts ? 'trigram+instr/short-fallback' : 'instr', elapsed);
      }
    }
  }
  const timings = [...samples].map(([categoryMode, values]) => {
    values.sort((a, b) => a - b);
    return { categoryMode, n: values.length, medianMs: round(values[Math.floor(values.length / 2)]),
      p95Ms: round(values[Math.ceil(values.length * 0.95) - 1]), maxMs: round(values.at(-1)) };
  });
  console.log(JSON.stringify({
    evidence: 'synthetic in-memory bundled Electron Node probe; NOT Extension Host or installed VSIX proof',
    runtime: { node: process.versions.node, electron: process.versions.electron, v8: process.versions.v8,
      sqlite: db.prepare('SELECT sqlite_version() AS version').get().version, platform: process.platform, arch: process.arch },
    corpus: { folders, titleRows: 10000, userTextRows: 100000, totalFields: rows.length, normalizedUtf8Bytes: sourceBytes, longestFieldBytes: longestField },
    setup: { loadMs: round(loadMs), ftsBuildMs: round(indexMs), baseBytes, indexedBytes, ftsAdditionalBytes: indexedBytes - baseBytes },
    validation: { cases: cases.length, checksPassed: checks, measuredRounds: 3, warmupRounds: 1, shortMatchUnsupportedConfirmed: true },
    timings, elapsedMs: round(performance.now() - started), rssMiB: round(process.memoryUsage().rss / 1024 / 1024),
    limits: ['Warm in-memory only; no disk/WAL/concurrent writer or cancellation evidence',
      'Full scan for 1-2 Unicode code points; FTS phrase escaping plus exact instr for longer tokens',
      'Each token stays inside one field; folder AND and field-tier coverage checked, not UI ordering',
      'Fixed synthetic scale is not a history cap; RSS includes JS oracle and corpus',
      'Embedded NUL in stored fields and malformed Unicode require separate discovery before production'],
  }, null, 2));
} finally {
  db.close();
}
