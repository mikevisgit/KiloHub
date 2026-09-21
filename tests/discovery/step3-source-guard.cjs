'use strict';
const assert = require('node:assert/strict');
const console = require('node:console');
const process = require('node:process');
const { DatabaseSync } = require('node:sqlite');

// Metadata-only compatibility experiment, never connects to real source files.
const db = new DatabaseSync(':memory:');
let checks = 0;
const check = (expected) => {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  let ambiguous = false;
  for (const name of ['session_message', 'session_input']) {
    if (!tables.has(name)) continue;
    ambiguous ||= db.prepare(`SELECT EXISTS(SELECT 1 FROM ${name} x JOIN session s ON s.id=x.session_id
      WHERE s.parent_id IS NULL AND s.time_archived IS NULL LIMIT 1) AS found`).get().found === 1;
  }
  assert.equal(ambiguous, expected);
  checks++;
};
try {
  db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, time_archived INTEGER);
    INSERT INTO session VALUES ('root',NULL,NULL),('child','root',NULL),('archive',NULL,1);`);
  check(false);
  db.exec(`CREATE TABLE session_message(id TEXT PRIMARY KEY,session_id TEXT,seq INTEGER,data TEXT);
    CREATE TABLE session_input(id TEXT PRIMARY KEY,session_id TEXT,prompt TEXT);`);
  check(false);
  db.exec("INSERT INTO session_message VALUES ('c','child',1,'not parsed'),('a','archive',1,'not parsed')");
  check(false);
  db.exec("INSERT INTO session_message VALUES ('r','root',NULL,'not parsed')");
  check(true); // NULL sequence is not proof of a complete legacy mirror.
  db.exec("UPDATE session_message SET seq=1 WHERE id='r'");
  check(true);
  db.exec("DELETE FROM session_message WHERE id='r'; INSERT INTO session_input VALUES ('i','root','not parsed')");
  check(true);
  db.exec("DELETE FROM session_input; BEGIN; INSERT INTO session_message VALUES ('rollback','root',2,'not parsed')");
  check(true);
  db.exec('ROLLBACK');
  check(false);
  console.log(JSON.stringify({ checks, node: process.versions.node, electron: process.versions.electron,
    sqlite: db.prepare('SELECT sqlite_version() AS v').get().v,
    limits: 'conservative ambiguity detection only; no new-format importer or completeness proof' }));
} finally { db.close(); }
