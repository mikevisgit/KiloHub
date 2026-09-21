'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const process = require('node:process');
const { setTimeout } = require('node:timers/promises');
const vscode = require('vscode');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');

exports.run = async () => {
  const extension = vscode.extensions.getExtension('synthetic-discovery.hub-storage-probe');
  assert.ok(extension);
  // Never call activate(): that would mask a broken onStartupFinished trigger.
  const deadline = Date.now() + 45000;
  while ((!extension.isActive || !extension.exports?.storage) && Date.now() < deadline) {
    await setTimeout(100);
  }
  assert.equal(extension.isActive, true, 'startup activation without commands or views');
  assert.ok(extension.exports?.storage);
  assert.equal(extension.exports.kind, vscode.ExtensionKind.UI);
  if (process.env.HUB_PROBE_NO_NODE === '1') {
    for (const executable of ['node', 'npm', 'sqlite3', 'kilo']) {
      const result = spawnSync(path.join(process.env.SystemRoot, 'System32', 'where.exe'),
        [executable, `${executable}.cmd`, `${executable}.bat`, `${executable}.exe`],
        { timeout: 5000, windowsHide: true, encoding: 'utf8' });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, `${executable} and its shims must not resolve on the controlled PATH`);
      assert.equal(result.stdout.trim(), '');
    }
    const db = new DatabaseSync(':memory:');
    try {
      db.exec("CREATE VIRTUAL TABLE search USING fts5(text,tokenize='trigram'); INSERT INTO search VALUES ('synthetic-folder')");
      assert.equal(db.prepare("SELECT count(*) AS n FROM search WHERE search MATCH 'folder'").get().n, 1);
    } finally { db.close(); }
  }
  const root = process.env.HUB_PROBE_ROOT;
  assert.ok(root);
  const relative = path.relative(root, extension.exports.storage);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'isolated storage');
  await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(extension.exports));
};
