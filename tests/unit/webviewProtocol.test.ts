import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROTOCOL_VERSION,
  WEBVIEW_PROTOCOL_LIMITS,
  WEBVIEW_STATE_MESSAGES,
  isBrowserToHostMessage,
  isHostToBrowserMessage,
  isHubConversationDto,
  isHubFolderDto,
  isProtocolRevision,
  shouldApplyHostMessage,
} from '../../src/webviewProtocol.js';
import type {
  HostToBrowserMessage,
  HubFolderDto,
} from '../../src/webviewProtocol.js';

function folder(overrides: Partial<HubFolderDto> = {}): HubFolderDto {
  return {
    id: 'c:\\work\\alpha',
    name: 'Alpha',
    path: 'C:\\Work\\Alpha',
    available: true,
    current: false,
    activity: '2026-09-20T10:20:30.000Z',
    monogram: 'AL',
    colorSlot: 3,
    conversations: [{ id: 'session-1', title: 'Диалог' }],
    ...overrides,
  };
}

function readyMessage(revision = 1): HostToBrowserMessage {
  return {
    version: PROTOCOL_VERSION,
    revision,
    kind: 'ready',
    folders: [folder()],
    message: null,
    busy: false,
  };
}

void test('accepts only the three exact browser-to-host message shapes', () => {
  assert.equal(isBrowserToHostMessage({ type: 'ready', version: PROTOCOL_VERSION }), true);
  assert.equal(isBrowserToHostMessage({ type: 'refresh', version: PROTOCOL_VERSION }), true);

  for (const action of ['openHere', 'openNewWindow', 'revealInExplorer'] as const) {
    assert.equal(isBrowserToHostMessage({
      type: 'folderAction',
      version: PROTOCOL_VERSION,
      revision: 0,
      folderId: 'folder-id',
      action,
    }), true);
  }

  assert.equal(isBrowserToHostMessage({
    type: 'ready',
    version: PROTOCOL_VERSION,
    revision: 0,
  }), false);
  assert.equal(isBrowserToHostMessage({
    type: 'folderAction',
    version: PROTOCOL_VERSION,
    revision: 0,
    folderId: 'folder-id',
    action: 'openHere',
    path: 'C:\\forged',
  }), false);
});

void test('rejects malformed, prototype-shaped, accessor and symbol-key messages without throwing', () => {
  class Message {
    public readonly type = 'ready';
    public readonly version = PROTOCOL_VERSION;
  }

  const inherited = Object.create({ type: 'ready' }) as Record<string, unknown>;
  inherited.version = PROTOCOL_VERSION;
  const nullPrototype = Object.assign(Object.create(null) as object, {
    type: 'ready',
    version: PROTOCOL_VERSION,
  });
  let getterCalls = 0;
  const accessor = Object.defineProperty({ type: 'ready' }, 'version', {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return PROTOCOL_VERSION;
    },
  });
  const symbolKey = { type: 'ready', version: PROTOCOL_VERSION } as Record<PropertyKey, unknown>;
  symbolKey[Symbol('extra')] = true;

  for (const value of [
    null,
    undefined,
    true,
    'ready',
    [],
    new Message(),
    inherited,
    nullPrototype,
    accessor,
    symbolKey,
  ]) {
    assert.doesNotThrow(() => isBrowserToHostMessage(value));
    assert.equal(isBrowserToHostMessage(value), false);
  }
  assert.equal(getterCalls, 0);
});

void test('requires exact finite safe nonnegative revisions and bounded folder IDs', () => {
  for (const revision of [0, 1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(isProtocolRevision(revision), true);
  }
  for (const revision of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1']) {
    assert.equal(isProtocolRevision(revision), false);
    assert.equal(isBrowserToHostMessage({
      type: 'folderAction',
      version: PROTOCOL_VERSION,
      revision,
      folderId: 'folder-id',
      action: 'openHere',
    }), false);
  }

  for (const folderId of ['', 'x'.repeat(WEBVIEW_PROTOCOL_LIMITS.idLength + 1), 42]) {
    assert.equal(isBrowserToHostMessage({
      type: 'folderAction',
      version: PROTOCOL_VERSION,
      revision: 1,
      folderId,
      action: 'openHere',
    }), false);
  }
  assert.equal(isBrowserToHostMessage({
    type: 'folderAction',
    version: PROTOCOL_VERSION,
    revision: 1,
    folderId: 'folder-id',
    action: 'executeCommand',
  }), false);
});

void test('validates exact DTO keys, canonical activity, color slot and nested bounds', () => {
  assert.equal(isHubConversationDto({ id: 'session', title: '' }), true);
  assert.equal(isHubFolderDto(folder()), true);
  const withoutActivity = { ...folder() } as Record<string, unknown>;
  delete withoutActivity.activity;
  assert.equal(isHubFolderDto(withoutActivity), true);

  assert.equal(isHubFolderDto({ ...folder(), extra: true }), false);
  assert.equal(isHubFolderDto({ ...folder(), activity: undefined }), false);
  assert.equal(isHubFolderDto({ ...folder(), activity: '2026-02-30T10:20:30.000Z' }), false);
  assert.equal(isHubFolderDto({ ...folder(), activity: '2026-09-20T10:20:30Z' }), false);
  assert.equal(isHubFolderDto({ ...folder(), colorSlot: -1 }), false);
  assert.equal(isHubFolderDto({ ...folder(), colorSlot: 16 }), false);
  assert.equal(isHubFolderDto({ ...folder(), colorSlot: 1.5 }), false);
  assert.equal(isHubFolderDto({ ...folder(), colorSlot: null }), true);
  assert.equal(isHubFolderDto({ ...folder(), monogram: '' }), false);
  assert.equal(isHubFolderDto({
    ...folder(),
    name: 'x'.repeat(WEBVIEW_PROTOCOL_LIMITS.displayTextLength + 1),
  }), false);
  assert.equal(isHubFolderDto({
    ...folder(),
    path: 'x'.repeat(WEBVIEW_PROTOCOL_LIMITS.pathLength + 1),
  }), false);
  assert.equal(isHubFolderDto({
    ...folder(),
    conversations: Array.from(
      { length: WEBVIEW_PROTOCOL_LIMITS.conversationsPerFolder + 1 },
      (_, index) => ({ id: `session-${index}`, title: 'Title' }),
    ),
  }), false);
  assert.equal(isHubFolderDto({
    ...folder(),
    conversations: [{ id: 'session', title: 'Title', command: 'forged' }],
  }), false);

  const sparseConversations = new Array(1);
  assert.equal(isHubFolderDto({ ...folder(), conversations: sparseConversations }), false);
  const extendedConversations = [{ id: 'session', title: 'Title' }] as Array<unknown> & { extra?: boolean };
  extendedConversations.extra = true;
  assert.equal(isHubFolderDto({ ...folder(), conversations: extendedConversations }), false);

  let getterCalls = 0;
  const accessorConversations: unknown[] = [];
  Object.defineProperty(accessorConversations, 0, {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  accessorConversations.length = 1;
  assert.doesNotThrow(() => isHubFolderDto({ ...folder(), conversations: accessorConversations }));
  assert.equal(isHubFolderDto({ ...folder(), conversations: accessorConversations }), false);
  assert.equal(getterCalls, 0);
});

void test('rejects hostile prototypes at every nested DTO level', () => {
  const prototypeFolder = Object.assign(Object.create({ injected: true }) as object, folder());
  const prototypeConversation = Object.assign(Object.create({ injected: true }) as object, {
    id: 'session',
    title: 'Title',
  });
  assert.equal(isHubFolderDto(prototypeFolder), false);
  assert.equal(isHubFolderDto({ ...folder(), conversations: [prototypeConversation] }), false);
});

void test('accepts every exact host state and rejects inconsistent discriminants', () => {
  const folders = [folder()];
  const states: HostToBrowserMessage[] = [
    { version: 1, revision: 0, kind: 'initial', folders: [], message: null, busy: false },
    {
      version: 1,
      revision: 1,
      kind: 'loading',
      folders: [],
      message: WEBVIEW_STATE_MESSAGES.loading,
      busy: true,
    },
    { version: 1, revision: 2, kind: 'ready', folders, message: null, busy: false },
    {
      version: 1,
      revision: 3,
      kind: 'ready',
      folders: [],
      message: WEBVIEW_STATE_MESSAGES.empty,
      busy: false,
    },
    {
      version: 1,
      revision: 4,
      kind: 'refreshing',
      folders,
      message: WEBVIEW_STATE_MESSAGES.refreshing,
      busy: true,
    },
    {
      version: 1,
      revision: 5,
      kind: 'initialError',
      folders: [],
      message: WEBVIEW_STATE_MESSAGES.initialError,
      busy: false,
    },
    {
      version: 1,
      revision: 6,
      kind: 'refreshError',
      folders,
      message: WEBVIEW_STATE_MESSAGES.refreshError,
      busy: false,
    },
  ];
  for (const state of states) {
    assert.equal(isHostToBrowserMessage(state), true, state.kind);
  }

  assert.equal(isHostToBrowserMessage({ ...states[0], extra: true }), false);
  assert.equal(isHostToBrowserMessage({ ...states[1], folders }), false);
  assert.equal(isHostToBrowserMessage({ ...states[2], busy: true }), false);
  assert.equal(isHostToBrowserMessage({ ...states[3], message: null }), false);
  assert.equal(isHostToBrowserMessage({ ...states[4], message: 'Обновление' }), false);
  assert.equal(isHostToBrowserMessage({ ...states[5], folders }), false);
  assert.equal(isHostToBrowserMessage({ ...states[6], kind: 'unknown' }), false);
  assert.equal(isHostToBrowserMessage({ ...states[6], version: 2 }), false);

  const tooManyFolders = Array.from(
    { length: WEBVIEW_PROTOCOL_LIMITS.folders + 1 },
    () => folder(),
  );
  assert.equal(isHostToBrowserMessage({ ...states[2], folders: tooManyFolders }), false);
});

void test('accepts host states only when their revision is newer than the applied revision', () => {
  const message = readyMessage(7);
  assert.equal(shouldApplyHostMessage(message, null), true);
  assert.equal(shouldApplyHostMessage(message, 6), true);
  assert.equal(shouldApplyHostMessage(message, 7), false);
  assert.equal(shouldApplyHostMessage(message, 8), false);
  assert.equal(shouldApplyHostMessage(message, -1), false);
  assert.equal(shouldApplyHostMessage({ ...message, revision: Number.NaN }, 6), false);
});
