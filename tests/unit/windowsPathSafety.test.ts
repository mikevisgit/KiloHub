import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  isAvailableLocalDirectory,
  isLocalResolvedWindowsPath,
  resolveAvailableLocalDirectory,
} from '../../src/windowsPathSafety.js';
import type { PathProbeOperations } from '../../src/windowsPathSafety.js';

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for path probe.');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

void test('accepts local resolved paths and rejects UNC targets', () => {
  assert.equal(isLocalResolvedWindowsPath('C:\\project'), true);
  assert.equal(isLocalResolvedWindowsPath('\\\\?\\C:\\project'), true);
  assert.equal(isLocalResolvedWindowsPath('\\\\server\\share'), false);
  assert.equal(isLocalResolvedWindowsPath('\\\\?\\UNC\\server\\share'), false);
});

void test('checks an existing local directory with a bounded operation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kilo-hub-local-'));
  try {
    const expected = await realpath(directory);
    assert.equal(await resolveAvailableLocalDirectory(directory), expected);
    assert.equal(await isAvailableLocalDirectory(directory), true);
    assert.equal(await resolveAvailableLocalDirectory(join(directory, 'missing')), undefined);
    assert.equal(await isAvailableLocalDirectory(join(directory, 'missing')), false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test('keeps at most sixteen physical probes pending after timeout and handles late rejection', async () => {
  const realpaths: Array<ReturnType<typeof deferred<string>>> = [];
  let starts = 0;
  const operations: PathProbeOperations = {
    realpath: () => {
      starts += 1;
      const operation = deferred<string>();
      realpaths.push(operation);
      return operation.promise;
    },
    stat: () => Promise.reject(new Error('late stat')),
  };
  const first = Array.from({ length: 16 }, (_, index) => (
    resolveAvailableLocalDirectory(`C:\\probe-${index}`, 1, operations)
  ));
  assert.deepEqual(await Promise.all(first), Array(16).fill(undefined));
  const seventeenth = resolveAvailableLocalDirectory('C:\\probe-16', 1, operations);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(starts, 16);

  realpaths[0].resolve('C:\\resolved-0');
  await waitUntil(() => starts === 17);
  assert.equal(await seventeenth, undefined);
  for (const operation of realpaths.slice(1)) operation.resolve('C:\\resolved');
  await new Promise((resolve) => setTimeout(resolve, 10));
});
