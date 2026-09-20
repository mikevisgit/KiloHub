import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  isAvailableLocalDirectory,
  isLocalResolvedWindowsPath,
} from '../../src/windowsPathSafety.js';

void test('accepts local resolved paths and rejects UNC targets', () => {
  assert.equal(isLocalResolvedWindowsPath('C:\\project'), true);
  assert.equal(isLocalResolvedWindowsPath('\\\\?\\C:\\project'), true);
  assert.equal(isLocalResolvedWindowsPath('\\\\server\\share'), false);
  assert.equal(isLocalResolvedWindowsPath('\\\\?\\UNC\\server\\share'), false);
});

void test('checks an existing local directory with a bounded operation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kilo-hub-local-'));
  try {
    assert.equal(await isAvailableLocalDirectory(directory), true);
    assert.equal(await isAvailableLocalDirectory(join(directory, 'missing')), false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
