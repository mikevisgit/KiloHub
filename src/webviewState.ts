import {
  PROTOCOL_VERSION,
  WEBVIEW_STATE_MESSAGES,
  isHubFolderArray,
  isProtocolRevision,
} from './webviewProtocol.js';
import type {
  HostToBrowserMessage,
  HubFolderDto,
} from './webviewProtocol.js';

export type WebviewState = HostToBrowserMessage;

export type WebviewStateEvent =
  | Readonly<{ type: 'loadRequested' }>
  | Readonly<{
    type: 'loadSucceeded';
    requestRevision: number;
    folders: readonly HubFolderDto[];
  }>
  | Readonly<{
    type: 'loadFailed';
    requestRevision: number;
  }>;

const EMPTY_FOLDERS = Object.freeze([]) as readonly HubFolderDto[];

function nextRevision(revision: number): number {
  if (!isProtocolRevision(revision) || revision === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Webview revision cannot be incremented safely.');
  }
  return revision + 1;
}

function copyFolders(folders: readonly HubFolderDto[]): readonly HubFolderDto[] {
  if (!isHubFolderArray(folders)) {
    throw new TypeError('Invalid Hub folder DTO snapshot.');
  }

  return Object.freeze(folders.map((folder) => {
    const conversations = Object.freeze(folder.conversations.map((conversation) => Object.freeze({
      id: conversation.id,
      title: conversation.title,
    })));
    const copy: HubFolderDto = {
      id: folder.id,
      name: folder.name,
      path: folder.path,
      available: folder.available,
      current: folder.current,
      monogram: folder.monogram,
      colorSlot: folder.colorSlot,
      conversations,
      ...(folder.activity === undefined ? {} : { activity: folder.activity }),
    };
    return Object.freeze(copy);
  }));
}

export function createInitialWebviewState(initialRevision = 0): WebviewState {
  if (!isProtocolRevision(initialRevision)) {
    throw new RangeError('Initial webview revision must be a nonnegative safe integer.');
  }
  return Object.freeze({
    version: PROTOCOL_VERSION,
    revision: initialRevision,
    kind: 'initial',
    folders: EMPTY_FOLDERS,
    message: null,
    busy: false,
  });
}

export function reduceWebviewState(
  state: WebviewState,
  event: WebviewStateEvent,
): WebviewState {
  switch (event.type) {
    case 'loadRequested': {
      if (state.busy) {
        return state;
      }
      const revision = nextRevision(state.revision);
      if (state.kind === 'initial' || state.kind === 'initialError') {
        return Object.freeze({
          version: PROTOCOL_VERSION,
          revision,
          kind: 'loading',
          folders: EMPTY_FOLDERS,
          message: WEBVIEW_STATE_MESSAGES.loading,
          busy: true,
        });
      }
      return Object.freeze({
        version: PROTOCOL_VERSION,
        revision,
        kind: 'refreshing',
        folders: state.folders,
        message: WEBVIEW_STATE_MESSAGES.refreshing,
        busy: true,
      });
    }
    case 'loadSucceeded': {
      if (!state.busy || event.requestRevision !== state.revision) {
        return state;
      }
      const folders = copyFolders(event.folders);
      return Object.freeze({
        version: PROTOCOL_VERSION,
        revision: nextRevision(state.revision),
        kind: 'ready',
        folders,
        message: folders.length === 0 ? WEBVIEW_STATE_MESSAGES.empty : null,
        busy: false,
      });
    }
    case 'loadFailed': {
      if (!state.busy || event.requestRevision !== state.revision) {
        return state;
      }
      const revision = nextRevision(state.revision);
      if (state.kind === 'loading') {
        return Object.freeze({
          version: PROTOCOL_VERSION,
          revision,
          kind: 'initialError',
          folders: EMPTY_FOLDERS,
          message: WEBVIEW_STATE_MESSAGES.initialError,
          busy: false,
        });
      }
      return Object.freeze({
        version: PROTOCOL_VERSION,
        revision,
        kind: 'refreshError',
        folders: state.folders,
        message: WEBVIEW_STATE_MESSAGES.refreshError,
        busy: false,
      });
    }
  }
}
