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

export const HUB_DIAGNOSTICS: readonly HubDiagnostic[] = Object.freeze([
  'source-unavailable', 'source-incompatible', 'source-ambiguous', 'resource-refused',
  'storage-unsafe', 'storage-unavailable', 'worker-unavailable', 'display-overflow',
]);
