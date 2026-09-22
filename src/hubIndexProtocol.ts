import type { KiloFolder } from './types.js';

export type HubHealth = 'preparing' | 'ready' | 'stale' | 'unavailable';
export type HubDiagnostic = 'source-unavailable' | 'source-incompatible' | 'source-ambiguous'
  | 'resource-refused' | 'storage-unsafe' | 'storage-unavailable' | 'worker-unavailable'
  | 'display-overflow';

export interface HubIndexSnapshot {
  readonly generation: string;
  readonly indexRevision: number;
  readonly complete: boolean;
  readonly health: HubHealth;
  readonly folders: readonly KiloFolder[];
  readonly diagnostic?: HubDiagnostic;
}

export interface HubIndexOptions {
  readonly storagePath: string;
  readonly sourcePath: string;
  readonly kiloVersion?: string;
}

export interface HubSearchResult {
  readonly generation: string;
  readonly indexRevision: number;
  readonly queryGeneration: number;
  readonly matches: readonly { folderId: string; rank: 0 | 1 | 2 }[];
}

export const HUB_SEARCH_ERRORS = ['invalid-query', 'search-cancelled', 'index-changed', 'search-unavailable'] as const;
export type HubSearchError = typeof HUB_SEARCH_ERRORS[number];

export const HUB_DIAGNOSTICS: readonly HubDiagnostic[] = Object.freeze([
  'source-unavailable', 'source-incompatible', 'source-ambiguous', 'resource-refused',
  'storage-unsafe', 'storage-unavailable', 'worker-unavailable', 'display-overflow',
]);

export function isHubIndexSnapshot(value: unknown): value is HubIndexSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  const text = (input: unknown): input is string => typeof input === 'string' && input.length <= 4096;
  if (Object.keys(row).some((key) => !['generation', 'indexRevision', 'complete', 'health', 'folders', 'diagnostic'].includes(key))
    || !text(row.generation) || !Number.isSafeInteger(row.indexRevision) || Number(row.indexRevision) < 0
    || typeof row.complete !== 'boolean' || !['preparing', 'ready', 'stale', 'unavailable'].includes(String(row.health))
    || (row.diagnostic !== undefined && !HUB_DIAGNOSTICS.includes(row.diagnostic as HubDiagnostic))
    || !Array.isArray(row.folders) || row.folders.length > 40_000) return false;
  return row.folders.every((value: unknown) => {
    if (typeof value !== 'object' || value === null) return false;
    const folder = value as Record<string, unknown>;
    return Object.keys(folder).every((key) => ['id', 'path', 'uri', 'name', 'available', 'lastKiloActivityAt', 'conversations'].includes(key))
      && ['id', 'path', 'uri', 'name'].every((key) => text(folder[key]))
      && typeof folder.available === 'boolean' && (folder.lastKiloActivityAt === undefined || text(folder.lastKiloActivityAt))
      && Array.isArray(folder.conversations) && folder.conversations.length <= 3
      && folder.conversations.every((value: unknown) => {
        if (typeof value !== 'object' || value === null) return false;
        const conversation = value as Record<string, unknown>;
        return Object.keys(conversation).every((key) => ['id', 'title', 'updatedAt'].includes(key))
          && text(conversation.id) && text(conversation.title)
          && (conversation.updatedAt === undefined || text(conversation.updatedAt));
      });
  });
}
