export const PROTOCOL_VERSION = 1 as const;

export const WEBVIEW_PROTOCOL_LIMITS = Object.freeze({
  idLength: 1_024,
  displayTextLength: 4_096,
  pathLength: 32_767,
  monogramLength: 32,
  folders: 10_000,
  conversationsPerFolder: 3,
});

export const WEBVIEW_STATE_MESSAGES = Object.freeze({
  loading: 'Загружаем папки…',
  empty: 'Здесь пока нет папок с диалогами Kilo',
  refreshing: 'Обновляем список…',
  initialError: 'Не удалось загрузить папки. Попробуйте обновить список',
  refreshError: 'Не удалось обновить список. Показаны ранее загруженные данные',
});

export interface HubConversationDto {
  readonly id: string;
  readonly title: string;
}

export interface HubFolderDto {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly available: boolean;
  readonly current: boolean;
  /** Exact Kilo activity timestamp. Omitted when no trustworthy timestamp exists. */
  readonly activity?: string;
  readonly monogram: string;
  readonly colorSlot: number | null;
  readonly conversations: readonly HubConversationDto[];
}

export type FolderAction = 'openHere' | 'openNewWindow' | 'revealInExplorer';

export interface BrowserReadyMessage {
  readonly type: 'ready';
  readonly version: typeof PROTOCOL_VERSION;
}

export interface BrowserRefreshMessage {
  readonly type: 'refresh';
  readonly version: typeof PROTOCOL_VERSION;
}

export interface BrowserFolderActionMessage {
  readonly type: 'folderAction';
  readonly version: typeof PROTOCOL_VERSION;
  readonly revision: number;
  readonly folderId: string;
  readonly action: FolderAction;
}

export type BrowserToHostMessage =
  | BrowserReadyMessage
  | BrowserRefreshMessage
  | BrowserFolderActionMessage;

export type HubStateKind =
  | 'initial'
  | 'loading'
  | 'ready'
  | 'refreshing'
  | 'initialError'
  | 'refreshError';

interface HubStateEnvelopeBase {
  readonly version: typeof PROTOCOL_VERSION;
  readonly revision: number;
  readonly folders: readonly HubFolderDto[];
}

export interface HubInitialStateEnvelope extends HubStateEnvelopeBase {
  readonly kind: 'initial';
  readonly message: null;
  readonly busy: false;
}

export interface HubLoadingStateEnvelope extends HubStateEnvelopeBase {
  readonly kind: 'loading';
  readonly message: typeof WEBVIEW_STATE_MESSAGES.loading;
  readonly busy: true;
}

export interface HubReadyStateEnvelope extends HubStateEnvelopeBase {
  readonly kind: 'ready';
  readonly message: null | typeof WEBVIEW_STATE_MESSAGES.empty;
  readonly busy: false;
}

export interface HubRefreshingStateEnvelope extends HubStateEnvelopeBase {
  readonly kind: 'refreshing';
  readonly message: typeof WEBVIEW_STATE_MESSAGES.refreshing;
  readonly busy: true;
}

export interface HubInitialErrorStateEnvelope extends HubStateEnvelopeBase {
  readonly kind: 'initialError';
  readonly message: typeof WEBVIEW_STATE_MESSAGES.initialError;
  readonly busy: false;
}

export interface HubRefreshErrorStateEnvelope extends HubStateEnvelopeBase {
  readonly kind: 'refreshError';
  readonly message: typeof WEBVIEW_STATE_MESSAGES.refreshError;
  readonly busy: false;
}

export type HostToBrowserMessage =
  | HubInitialStateEnvelope
  | HubLoadingStateEnvelope
  | HubReadyStateEnvelope
  | HubRefreshingStateEnvelope
  | HubInitialErrorStateEnvelope
  | HubRefreshErrorStateEnvelope;

type ExactObject = Readonly<Record<string, unknown>>;

function asExactObject(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): ExactObject | undefined {
  try {
    if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) {
      return undefined;
    }

    const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))) {
      return undefined;
    }
    if (requiredKeys.some((key) => !Object.hasOwn(value, key))) {
      return undefined;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of ownKeys) {
      if (typeof key !== 'string') {
        return undefined;
      }
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return undefined;
      }
    }

    return value as ExactObject;
  } catch {
    return undefined;
  }
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
  allowEmpty = false,
): value is string {
  return typeof value === 'string'
    && value.length <= maximumLength
    && (allowEmpty || value.length > 0);
}

export function isProtocolRevision(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isExactArray(value: unknown, maximumLength: number): value is readonly unknown[] {
  try {
    if (!Array.isArray(value)
      || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > maximumLength) {
      return false;
    }

    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) {
      return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[index];
      if (descriptor === undefined
        || !descriptor.enumerable
        || !Object.hasOwn(descriptor, 'value')) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function isCanonicalActivity(value: unknown): value is string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function isHubConversationDto(value: unknown): value is HubConversationDto {
  const candidate = asExactObject(value, ['id', 'title']);
  return candidate !== undefined
    && isBoundedString(candidate.id, WEBVIEW_PROTOCOL_LIMITS.idLength)
    && isBoundedString(candidate.title, WEBVIEW_PROTOCOL_LIMITS.displayTextLength, true);
}

export function isHubFolderDto(value: unknown): value is HubFolderDto {
  const candidate = asExactObject(
    value,
    [
      'id',
      'name',
      'path',
      'available',
      'current',
      'monogram',
      'colorSlot',
      'conversations',
    ],
    ['activity'],
  );
  if (candidate === undefined) {
    return false;
  }

  const colorSlot = candidate.colorSlot;
  return isBoundedString(candidate.id, WEBVIEW_PROTOCOL_LIMITS.idLength)
    && isBoundedString(candidate.name, WEBVIEW_PROTOCOL_LIMITS.displayTextLength)
    && isBoundedString(candidate.path, WEBVIEW_PROTOCOL_LIMITS.pathLength)
    && typeof candidate.available === 'boolean'
    && typeof candidate.current === 'boolean'
    && (!Object.hasOwn(candidate, 'activity') || isCanonicalActivity(candidate.activity))
    && isBoundedString(candidate.monogram, WEBVIEW_PROTOCOL_LIMITS.monogramLength)
    && (colorSlot === null
      || (typeof colorSlot === 'number' && Number.isInteger(colorSlot) && colorSlot >= 0 && colorSlot < 16))
    && isExactArray(candidate.conversations, WEBVIEW_PROTOCOL_LIMITS.conversationsPerFolder)
    && candidate.conversations.every(isHubConversationDto);
}

export function isHubFolderArray(value: unknown): value is readonly HubFolderDto[] {
  return isExactArray(value, WEBVIEW_PROTOCOL_LIMITS.folders)
    && value.every(isHubFolderDto);
}

function isFolderAction(value: unknown): value is FolderAction {
  return value === 'openHere' || value === 'openNewWindow' || value === 'revealInExplorer';
}

export function isBrowserToHostMessage(value: unknown): value is BrowserToHostMessage {
  const header = asExactObject(value, ['type', 'version'], ['revision', 'folderId', 'action']);
  if (header === undefined || header.version !== PROTOCOL_VERSION) {
    return false;
  }

  if (header.type === 'ready' || header.type === 'refresh') {
    return asExactObject(value, ['type', 'version']) !== undefined;
  }
  if (header.type !== 'folderAction') {
    return false;
  }

  const action = asExactObject(value, ['type', 'version', 'revision', 'folderId', 'action']);
  return action !== undefined
    && isProtocolRevision(action.revision)
    && isBoundedString(action.folderId, WEBVIEW_PROTOCOL_LIMITS.idLength)
    && isFolderAction(action.action);
}

export function isHostToBrowserMessage(value: unknown): value is HostToBrowserMessage {
  const candidate = asExactObject(
    value,
    ['version', 'revision', 'kind', 'folders', 'message', 'busy'],
  );
  if (candidate === undefined
    || candidate.version !== PROTOCOL_VERSION
    || !isProtocolRevision(candidate.revision)
    || !isHubFolderArray(candidate.folders)) {
    return false;
  }

  switch (candidate.kind) {
    case 'initial':
      return candidate.folders.length === 0 && candidate.message === null && candidate.busy === false;
    case 'loading':
      return candidate.folders.length === 0
        && candidate.message === WEBVIEW_STATE_MESSAGES.loading
        && candidate.busy === true;
    case 'ready':
      return candidate.busy === false
        && candidate.message === (candidate.folders.length === 0 ? WEBVIEW_STATE_MESSAGES.empty : null);
    case 'refreshing':
      return candidate.message === WEBVIEW_STATE_MESSAGES.refreshing && candidate.busy === true;
    case 'initialError':
      return candidate.folders.length === 0
        && candidate.message === WEBVIEW_STATE_MESSAGES.initialError
        && candidate.busy === false;
    case 'refreshError':
      return candidate.message === WEBVIEW_STATE_MESSAGES.refreshError && candidate.busy === false;
    default:
      return false;
  }
}

export function shouldApplyHostMessage(
  value: unknown,
  lastAppliedRevision: number | null,
): value is HostToBrowserMessage {
  return isHostToBrowserMessage(value)
    && (lastAppliedRevision === null
      || (isProtocolRevision(lastAppliedRevision) && value.revision > lastAppliedRevision));
}

export function isCurrentRevision(messageRevision: unknown, currentRevision: number): boolean {
  return isProtocolRevision(messageRevision)
    && isProtocolRevision(currentRevision)
    && messageRevision === currentRevision;
}
