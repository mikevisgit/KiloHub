'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const process = require('node:process');
const { setTimeout } = require('node:timers/promises');
const vscode = require('vscode');

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
  const root = process.env.HUB_PROBE_ROOT;
  assert.ok(root);
  const relative = path.relative(root, extension.exports.storage);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'isolated storage');
  await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(extension.exports));
};
