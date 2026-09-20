import { normalizeWindowsDirectory } from './projection.js';
import type { KiloFolder } from './types.js';

export interface WorkspaceDescriptor {
  readonly folderCount: number;
  readonly path: string | null;
  readonly scheme: string | null;
  readonly authority: string | null;
  readonly workspaceFile: string | null;
  readonly remote: boolean;
}

export type CurrentFolderDiagnostic =
  | 'resolved'
  | 'workspace-folder-count'
  | 'workspace-file'
  | 'remote-workspace'
  | 'unsupported-scheme'
  | 'unsupported-authority'
  | 'unsupported-path'
  | 'not-in-snapshot'
  | 'ambiguous-snapshot';

export interface CurrentFolderResolution {
  readonly folderId: string | null;
  readonly diagnostic: CurrentFolderDiagnostic;
}

function unresolved(diagnostic: Exclude<CurrentFolderDiagnostic, 'resolved'>): CurrentFolderResolution {
  return { folderId: null, diagnostic };
}

/** Resolves current only from an already inspected workspace descriptor and snapshot. */
export function resolveCurrentFolder(
  workspace: WorkspaceDescriptor,
  snapshot: readonly KiloFolder[],
): CurrentFolderResolution {
  if (workspace.folderCount !== 1) return unresolved('workspace-folder-count');
  if (workspace.workspaceFile !== null) return unresolved('workspace-file');
  if (workspace.remote) return unresolved('remote-workspace');
  if (workspace.scheme?.toLowerCase() !== 'file') return unresolved('unsupported-scheme');

  const authority = workspace.authority?.toLowerCase() ?? '';
  if (authority !== '' && authority !== 'localhost') {
    return unresolved('unsupported-authority');
  }
  if (workspace.path === null) return unresolved('unsupported-path');

  const normalized = normalizeWindowsDirectory(workspace.path);
  if (!normalized) return unresolved('unsupported-path');

  const matches = snapshot.filter(({ id }) => id === normalized.key);
  if (matches.length === 0) return unresolved('not-in-snapshot');
  if (matches.length !== 1) return unresolved('ambiguous-snapshot');
  return { folderId: normalized.key, diagnostic: 'resolved' };
}
