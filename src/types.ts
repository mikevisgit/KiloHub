export type RawKiloTimestamp = number | string;

/** Metadata-only row returned by the Kilo session adapter. */
export interface RawSessionMetadata {
  id: string;
  title: string | null;
  directory: string | null;
  parentId: string | null;
  timeCreated: RawKiloTimestamp | null;
  timeArchived: RawKiloTimestamp | null;
  timeUpdated: RawKiloTimestamp | null;
}

export interface KiloConversation {
  id: string;
  title: string;
  updatedAt?: string;
}

export interface KiloFolder {
  id: string;
  uri: string;
  name: string;
  available: boolean;
  lastKiloActivityAt?: string;
  conversations: KiloConversation[];
}

export interface NormalizedWindowsDirectory {
  /** Case-preserving absolute path with Windows separators. */
  path: string;
  /** Case-insensitive folder identity used for grouping. */
  key: string;
  uri: string;
  name: string;
}

export type DirectoryAvailabilityCheck = (path: string) => Promise<boolean>;
export type ProjectionWarning = (message: string) => void;

export interface ProjectionOptions {
  isDirectoryAvailable: DirectoryAvailabilityCheck;
  onWarning?: ProjectionWarning;
}
