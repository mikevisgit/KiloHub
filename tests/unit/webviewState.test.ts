import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEBVIEW_STATE_MESSAGES,
  isCurrentRevision,
  isHostToBrowserMessage,
} from '../../src/webviewProtocol.js';
import type { HubFolderDto } from '../../src/webviewProtocol.js';
import {
  createInitialWebviewState,
  reduceWebviewState,
} from '../../src/webviewState.js';

function mutableFolder(id: string, name = id): {
  id: string;
  name: string;
  path: string;
  available: boolean;
  current: boolean;
  activity: string;
  monogram: string;
  colorSlot: number;
  conversations: Array<{ id: string; title: string }>;
} {
  return {
    id,
    name,
    path: `C:\\Work\\${name}`,
    available: true,
    current: false,
    activity: '2026-09-20T10:20:30.000Z',
    monogram: 'AB',
    colorSlot: 2,
    conversations: [{ id: `${id}-session`, title: 'First title' }],
  };
}

function succeed(
  state: ReturnType<typeof createInitialWebviewState>,
  folders: readonly HubFolderDto[],
) {
  return reduceWebviewState(state, {
    type: 'loadSucceeded',
    requestRevision: state.revision,
    folders,
  });
}

void test('creates an immutable exact initial state at a validated revision', () => {
  const state = createInitialWebviewState();
  assert.deepEqual(state, {
    version: 1,
    revision: 0,
    kind: 'initial',
    folders: [],
    message: null,
    busy: false,
  });
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.folders), true);
  assert.equal(isHostToBrowserMessage(state), true);

  assert.equal(createInitialWebviewState(42).revision, 42);
  for (const revision of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createInitialWebviewState(revision), RangeError);
  }
});

void test('covers initial loading, success, refresh, error retention and recovery', () => {
  const initial = createInitialWebviewState();
  const loading = reduceWebviewState(initial, { type: 'loadRequested' });
  assert.deepEqual(loading, {
    version: 1,
    revision: 1,
    kind: 'loading',
    folders: [],
    message: WEBVIEW_STATE_MESSAGES.loading,
    busy: true,
  });

  const firstSnapshot = [mutableFolder('one', 'One')];
  const ready = succeed(loading, firstSnapshot);
  assert.equal(ready.kind, 'ready');
  assert.equal(ready.revision, 2);
  assert.equal(ready.folders[0].id, 'one');
  assert.equal(ready.message, null);

  const refreshing = reduceWebviewState(ready, { type: 'loadRequested' });
  assert.equal(refreshing.kind, 'refreshing');
  assert.equal(refreshing.revision, 3);
  assert.equal(refreshing.folders, ready.folders);
  assert.equal(refreshing.message, WEBVIEW_STATE_MESSAGES.refreshing);

  const refreshError = reduceWebviewState(refreshing, {
    type: 'loadFailed',
    requestRevision: refreshing.revision,
  });
  assert.equal(refreshError.kind, 'refreshError');
  assert.equal(refreshError.revision, 4);
  assert.equal(refreshError.folders, ready.folders);
  assert.equal(refreshError.message, WEBVIEW_STATE_MESSAGES.refreshError);

  const retrying = reduceWebviewState(refreshError, { type: 'loadRequested' });
  assert.equal(retrying.kind, 'refreshing');
  assert.equal(retrying.revision, 5);
  assert.equal(retrying.folders, ready.folders);

  const replacement = [mutableFolder('two', 'Two')];
  const recovered = succeed(retrying, replacement);
  assert.equal(recovered.kind, 'ready');
  assert.equal(recovered.revision, 6);
  assert.deepEqual(recovered.folders.map(({ id }) => id), ['two']);
  assert.deepEqual(ready.folders.map(({ id }) => id), ['one']);

  for (const state of [initial, loading, ready, refreshing, refreshError, retrying, recovered]) {
    assert.equal(isHostToBrowserMessage(state), true, state.kind);
  }
});

void test('covers initial failure and retry without ever retaining folders', () => {
  const loading = reduceWebviewState(createInitialWebviewState(), { type: 'loadRequested' });
  const failed = reduceWebviewState(loading, {
    type: 'loadFailed',
    requestRevision: loading.revision,
  });
  assert.deepEqual(failed, {
    version: 1,
    revision: 2,
    kind: 'initialError',
    folders: [],
    message: WEBVIEW_STATE_MESSAGES.initialError,
    busy: false,
  });

  const retry = reduceWebviewState(failed, { type: 'loadRequested' });
  assert.equal(retry.kind, 'loading');
  assert.equal(retry.revision, 3);
  assert.deepEqual(retry.folders, []);
  assert.equal(isHostToBrowserMessage(retry), true);
});

void test('represents an empty successful snapshot with the exact empty message', () => {
  const loading = reduceWebviewState(createInitialWebviewState(), { type: 'loadRequested' });
  const ready = succeed(loading, []);
  assert.equal(ready.kind, 'ready');
  assert.deepEqual(ready.folders, []);
  assert.equal(ready.message, WEBVIEW_STATE_MESSAGES.empty);
  assert.equal(ready.busy, false);
});

void test('coalesces duplicate loads and ignores stale or out-of-order completions', () => {
  const initial = createInitialWebviewState();
  const loading = reduceWebviewState(initial, { type: 'loadRequested' });
  assert.equal(reduceWebviewState(loading, { type: 'loadRequested' }), loading);
  assert.equal(reduceWebviewState(loading, {
    type: 'loadSucceeded',
    requestRevision: initial.revision,
    folders: [mutableFolder('stale')],
  }), loading);
  assert.equal(reduceWebviewState(loading, {
    type: 'loadFailed',
    requestRevision: loading.revision + 1,
  }), loading);
  assert.equal(reduceWebviewState(initial, {
    type: 'loadSucceeded',
    requestRevision: initial.revision,
    folders: [mutableFolder('out-of-order')],
  }), initial);
  assert.equal(reduceWebviewState(initial, {
    type: 'loadFailed',
    requestRevision: initial.revision,
  }), initial);
});

void test('atomically copies and deeply freezes successful snapshots', () => {
  const source = mutableFolder('one', 'Original');
  const loading = reduceWebviewState(createInitialWebviewState(), { type: 'loadRequested' });
  const ready = succeed(loading, [source]);

  assert.notEqual(ready.folders[0], source);
  assert.notEqual(ready.folders[0].conversations, source.conversations);
  assert.notEqual(ready.folders[0].conversations[0], source.conversations[0]);
  assert.equal(Object.isFrozen(ready), true);
  assert.equal(Object.isFrozen(ready.folders), true);
  assert.equal(Object.isFrozen(ready.folders[0]), true);
  assert.equal(Object.isFrozen(ready.folders[0].conversations), true);
  assert.equal(Object.isFrozen(ready.folders[0].conversations[0]), true);

  source.name = 'Mutated';
  source.conversations[0].title = 'Mutated title';
  source.conversations.push({ id: 'late', title: 'Late mutation' });
  assert.equal(ready.folders[0].name, 'Original');
  assert.deepEqual(ready.folders[0].conversations, [
    { id: 'one-session', title: 'First title' },
  ]);
});

void test('rejects malformed snapshots before replacing retained data', () => {
  const loading = reduceWebviewState(createInitialWebviewState(), { type: 'loadRequested' });
  const invalid = [{ ...mutableFolder('one'), colorSlot: 16 }];
  assert.throws(() => succeed(loading, invalid), TypeError);
  assert.equal(loading.kind, 'loading');
  assert.deepEqual(loading.folders, []);
});

void test('keeps revisions safe, monotonic and exact for folder actions', () => {
  const state = createInitialWebviewState(Number.MAX_SAFE_INTEGER);
  assert.throws(
    () => reduceWebviewState(state, { type: 'loadRequested' }),
    RangeError,
  );

  assert.equal(isCurrentRevision(7, 7), true);
  assert.equal(isCurrentRevision(6, 7), false);
  assert.equal(isCurrentRevision(7.5, 7), false);
  assert.equal(isCurrentRevision(Number.NaN, 7), false);
  assert.equal(isCurrentRevision(7, -1), false);
});
