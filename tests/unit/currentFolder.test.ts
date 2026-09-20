import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCurrentFolder,
  type CurrentFolderDiagnostic,
  type WorkspaceDescriptor,
} from '../../src/currentFolder.js';
import type { KiloFolder } from '../../src/types.js';

function descriptor(overrides: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor {
  return {
    folderCount: 1,
    path: 'C:\\Work\\Project',
    scheme: 'file',
    authority: '',
    workspaceFile: null,
    remote: false,
    ...overrides,
  };
}

function folder(id = 'c:\\work\\project'): KiloFolder {
  return {
    id,
    path: 'C:\\Work\\Project',
    uri: 'file:///C:/Work/Project',
    name: 'Project',
    available: true,
    conversations: [],
  };
}

void test('resolves one exact normalized local folder ID', () => {
  assert.deepEqual(resolveCurrentFolder(
    descriptor({ path: 'c:/work/child/../PROJECT/', authority: 'localhost' }),
    [folder()],
  ), {
    folderId: 'c:\\work\\project',
    diagnostic: 'resolved',
  });
});

void test('returns null with a stable diagnostic for unsupported workspace descriptors', () => {
  const cases: ReadonlyArray<readonly [Partial<WorkspaceDescriptor>, CurrentFolderDiagnostic]> = [
    [{ folderCount: 0, path: null }, 'workspace-folder-count'],
    [{ folderCount: 2 }, 'workspace-folder-count'],
    [{ workspaceFile: 'C:\\work\\project.code-workspace' }, 'workspace-file'],
    [{ remote: true }, 'remote-workspace'],
    [{ scheme: 'vscode-remote' }, 'unsupported-scheme'],
    [{ scheme: null }, 'unsupported-scheme'],
    [{ authority: 'server' }, 'unsupported-authority'],
    [{ path: null }, 'unsupported-path'],
    [{ path: '\\\\server\\share\\project' }, 'unsupported-path'],
    [{ path: 'C:\\work\\project.code-workspace' }, 'unsupported-path'],
    [{ path: 'relative\\project' }, 'unsupported-path'],
  ];

  for (const [overrides, diagnostic] of cases) {
    assert.deepEqual(resolveCurrentFolder(descriptor(overrides), [folder()]), {
      folderId: null,
      diagnostic,
    });
  }
});

void test('does not add a current folder missing from the Kilo snapshot', () => {
  assert.deepEqual(resolveCurrentFolder(descriptor(), [folder('c:\\other')]), {
    folderId: null,
    diagnostic: 'not-in-snapshot',
  });
});

void test('rejects an ambiguous duplicate snapshot identity', () => {
  assert.deepEqual(resolveCurrentFolder(descriptor(), [folder(), folder()]), {
    folderId: null,
    diagnostic: 'ambiguous-snapshot',
  });
});
