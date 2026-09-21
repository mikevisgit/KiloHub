'use strict';
const assert = require('node:assert/strict');
const console = require('node:console');
const process = require('node:process');
const { Buffer } = require('node:buffer');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const MB = 1024 * 1024;
function admit(bytes, freeBytes, heapHeadroom, stringLimit) {
  return bytes >= 0 && Number.isSafeInteger(bytes)
    && bytes <= Math.floor(stringLimit / 3)
    && 64 * MB + bytes * 16 <= Math.min(freeBytes / 4, heapHeadroom / 2);
}
const source = new DatabaseSync(':memory:');
const hub = new DatabaseSync(':memory:');
const text = `Начало\0${'я'.repeat(MB)}Е\u0308 ΣА хвост`;
const normalized = text.normalize('NFC').toLowerCase().replaceAll('ё', 'е').normalize('NFC');
source.exec('CREATE TABLE part(id TEXT PRIMARY KEY, data TEXT)');
source.prepare('INSERT INTO part VALUES (?,?)').run('p', JSON.stringify({ type: 'text', text }));
source.exec('PRAGMA query_only=ON');
hub.exec("CREATE TABLE state(cursor TEXT, hash TEXT); INSERT INTO state VALUES ('old','last-good')");
let extractions = 0;
function attempt(freeBytes) {
  source.exec('BEGIN');
  hub.exec('BEGIN');
  try {
    const size = source.prepare('SELECT octet_length(data) AS n FROM part WHERE id=?').get('p').n;
    if (!admit(size, freeBytes, 2048 * MB, 536870888)) throw new Error('resources');
    extractions++;
    const bytes = source.prepare("SELECT CAST(json_extract(data,'$.text') AS BLOB) AS value FROM part WHERE id=?").get('p').value;
    const value = Buffer.from(bytes).toString('utf8').normalize('NFC').toLowerCase().replaceAll('ё', 'е').normalize('NFC');
    assert.equal(value, normalized);
    hub.prepare('UPDATE state SET cursor=?,hash=?').run('p', createHash('sha256').update(value).digest('hex'));
    hub.exec('COMMIT');
    return true;
  } catch (error) {
    hub.exec('ROLLBACK');
    if (error.message !== 'resources') throw error;
    return false;
  } finally { source.exec('ROLLBACK'); }
}
try {
  assert.equal(attempt(128 * MB), false);
  assert.equal(extractions, 0);
  assert.deepEqual({ ...hub.prepare('SELECT * FROM state').get() }, { cursor: 'old', hash: 'last-good' });
  assert.equal(attempt(4096 * MB), true);
  assert.equal(extractions, 1);
  assert.equal(hub.prepare('SELECT cursor FROM state').get().cursor, 'p');
  assert.equal(admit(200 * MB, 8192 * MB, 8192 * MB, 100 * MB), false);
  console.log(JSON.stringify({ checks: 7, node: process.versions.node,
    result: 'resource refusal before parsing; same field succeeds after resource recovery; NUL and normalization preserved',
    limits: 'admission heuristic and injected availability, not native memory reservation or hard OOM isolation' }));
} finally { source.close(); hub.close(); }
