'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const process = require('node:process');
const assert = require('node:assert/strict');

exports.activate = async (context) => {
  const root = process.env.HUB_PROBE_ROOT;
  assert.ok(root, 'only the isolated discovery runner may activate this probe');
  const relative = path.relative(root, context.globalStorageUri.fsPath);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'refuse non-isolated storage');
  const marker = path.join(context.globalStorageUri.fsPath, 'synthetic-marker.txt');
  await fs.mkdir(context.globalStorageUri.fsPath, { recursive: true });
  let previous = null;
  try { previous = await fs.readFile(marker, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(marker, 'synthetic-discovery-only');
  return { storage: context.globalStorageUri.fsPath, previous,
    version: vscode.version, node: process.versions.node,
    electron: process.versions.electron, kind: context.extension.extensionKind };
};
