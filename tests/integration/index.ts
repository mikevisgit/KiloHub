import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import * as vscode from 'vscode';

import { openFolderOptions, pickExistingFolder } from '../../src/commands.js';
import type { FolderAction } from '../../src/commands.js';
import { KiloHubWebviewProvider } from '../../src/kiloHubWebviewProvider.js';
import { HubIndexService } from '../../src/hubIndexService.js';
import type { HubIndexSnapshot, HubSearchResult } from '../../src/hubIndexProtocol.js';
import type { KiloFolder } from '../../src/types.js';
import { PROTOCOL_VERSION } from '../../src/webviewProtocol.js';

const EXTENSION_ID = 'local.kilo-hub';
const VIEW_CONTAINER_ID = 'kiloHub';
const VIEW_ID = 'kiloHub.folders';
const COMMAND_IDS = [
  'kiloHub.openHere',
  'kiloHub.openInFileExplorer',
  'kiloHub.openNewWindow',
  'kiloHub.refresh',
] as const;

interface ManifestCommand { command: string }
interface ManifestView { id: string; name?: string; type?: string }
interface ExtensionManifest {
  version: string;
  icon: string;
  activationEvents: string[];
  contributes: {
    commands: ManifestCommand[];
    views: Record<string, ManifestView[]>;
    viewsContainers: { activitybar: ManifestView[] };
    menus?: Record<string, unknown>;
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolveDeferred) => {
    resolvePromise = resolveDeferred;
  });
  return {
    promise,
    resolve: (value: T) => resolvePromise?.(value),
  };
}

function assertManifest(value: unknown): asserts value is ExtensionManifest {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  const manifest = value as Partial<ExtensionManifest>;
  assert.equal(typeof manifest.version, 'string');
  assert.ok(Array.isArray(manifest.activationEvents));
  if (!manifest.contributes || typeof manifest.contributes !== 'object') {
    assert.fail('Extension manifest has no contributes object.');
  }
  assert.ok(Array.isArray(manifest.contributes.commands));
  assert.equal(typeof manifest.contributes.views, 'object');
  assert.ok(Array.isArray(manifest.contributes.viewsContainers?.activitybar));
}

function createFixture(databasePath: string, workspacePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      directory TEXT NOT NULL,
      parent_id TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      time_archived INTEGER
    )`);
    database.exec(`CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,message_id TEXT NOT NULL,data TEXT NOT NULL);`);
    const insert = database.prepare(`INSERT INTO session (
      id, title, directory, parent_id, time_created, time_updated, time_archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    insert.run('fixture-root', 'Fixture conversation', workspacePath, null, 1_000, 2_000, null);
    insert.run('fixture-child', 'Excluded child', workspacePath, 'fixture-root', 1_000, 3_000, null);
    insert.run('fixture-archived', 'Excluded archive', workspacePath, null, 1_000, 4_000, 4_001);
  } finally {
    database.close();
  }
}

function fingerprintDirectory(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => statSync(join(directory, name)).isFile())
    .sort()
    .map((name) => `${name}:${createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')}`);
}

async function waitUntil(predicate: () => boolean, timeout = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('Timed out waiting for integration state.');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

async function testHostProviderContract(repositoryRoot: string): Promise<void> {
  const receiveEmitter = new vscode.EventEmitter<unknown>();
  const disposeEmitter = new vscode.EventEmitter<void>();
  const posted: unknown[] = [];
  const actions: Array<{ action: FolderAction; folder: KiloFolder }> = [];
  const outputLines: string[] = [];
  let workspacePath = 'C:\\Project';
  let failLoad = false;
  let loadCalls = 0;
  let pendingLoad: Deferred<readonly KiloFolder[]> | undefined;
  let pendingWorkspace: Deferred<{
    folderCount: number;
    path: string;
    scheme: string;
    authority: string;
    workspaceFile: null;
    remote: false;
  }> | undefined;
  let pendingFinalGuard: Deferred<void> | undefined;
  let finalGuardStarted = false;
  const folder: KiloFolder = {
    id: 'c:\\project',
    path: 'C:\\Project',
    uri: 'file:///C:/Project',
    name: 'Project',
    available: true,
    lastKiloActivityAt: '2026-09-19T20:00:00.000Z',
    conversations: [{ id: 'session-1', title: 'Conversation', updatedAt: '2026-09-19T20:00:00.000Z' }],
  };
  const output = {
    appendLine: (line: string): void => { outputLines.push(line); },
  } as unknown as vscode.OutputChannel;

  const provider = new KiloHubWebviewProvider({
    extensionUri: vscode.Uri.file(repositoryRoot),
    output,
    loadFolders: () => {
      loadCalls += 1;
      const load = pendingLoad;
      pendingLoad = undefined;
      if (load !== undefined) return load.promise;
      return failLoad ? Promise.reject(new Error('fixture failure')) : Promise.resolve([folder]);
    },
    workspaceDescriptor: () => {
      const workspace = pendingWorkspace;
      pendingWorkspace = undefined;
      return workspace?.promise ?? Promise.resolve({
        folderCount: 1,
        path: workspacePath,
        scheme: 'file',
        authority: '',
        workspaceFile: null,
        remote: false,
      });
    },
    executeAction: async (action, actionFolder, finalGuard) => {
      if (pendingFinalGuard !== undefined) {
        finalGuardStarted = true;
        const guard = pendingFinalGuard;
        pendingFinalGuard = undefined;
        await guard.promise;
      }
      if (await finalGuard()) {
        actions.push({ action, folder: actionFolder });
      }
    },
    now: () => new Date('2026-09-20T12:00:00.000Z'),
    browserReadyTimeoutMs: 50,
  });
  const webview = {
    options: {},
    html: '',
    cspSource: 'vscode-webview:',
    asWebviewUri: (uri: vscode.Uri) => uri.with({ scheme: 'vscode-webview' }),
    postMessage: (message: unknown) => { posted.push(message); return Promise.resolve(true); },
    onDidReceiveMessage: receiveEmitter.event,
  } as unknown as vscode.Webview;
  const view = {
    title: '',
    webview,
    visible: true,
    onDidDispose: disposeEmitter.event,
    onDidChangeVisibility: new vscode.EventEmitter<{ visible: boolean }>().event,
    show: () => undefined,
  } as unknown as vscode.WebviewView;

  try {
    provider.resolveWebviewView(view);
    assert.equal(view.title, 'Kilo Hub');
    const csp = /Content-Security-Policy" content="([^"]+)"/u.exec(webview.html)?.[1];
    assert.ok(csp);
    assert.match(csp, /^default-src 'none'; style-src vscode-webview: 'nonce-[A-Za-z0-9_-]+'; script-src 'nonce-[A-Za-z0-9_-]+'; img-src 'none'; connect-src 'none'$/u);
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline|data:/u);
    const styleNonce = /<style id="kilo-hub-theme-style" nonce="([^"]+)"><\/style>/u.exec(webview.html)?.[1];
    const script = /<script nonce="([^"]+)" src="([^"]+)"><\/script>/u.exec(webview.html);
    assert.ok(styleNonce);
    assert.ok(script);
    assert.equal(script[1], styleNonce);
    assert.equal((webview.options.localResourceRoots as vscode.Uri[]).length, 1);
    assert.equal(
      (webview.options.localResourceRoots as vscode.Uri[])[0]?.fsPath,
      join(repositoryRoot, 'build', 'webview'),
    );
    assert.doesNotMatch(webview.html, /<script(?![^>]*\bsrc=)[^>]*>|\son\w+=|javascript:|data:/iu);
    assert.match(webview.html, /build\/webview\/webview\.js/);
    assert.match(webview.html, /build\/webview\/webview\.css/);
    assert.doesNotMatch(webview.html, /Fixture conversation/);

    receiveEmitter.fire({ type: 'ready', version: PROTOCOL_VERSION });
    await waitUntil(() => provider.currentState.kind === 'ready');
    assert.equal(loadCalls, 1);
    assert.equal(provider.currentState.folders[0]?.current, true);
    assert.deepEqual(posted.map((message) => (message as { kind?: string }).kind), ['initial', 'loading', 'ready']);

    const readyRevision = provider.currentState.revision;
    receiveEmitter.fire({ type: 'folderAction', version: PROTOCOL_VERSION, revision: readyRevision - 1, folderId: folder.id, action: 'revealInExplorer' });
    receiveEmitter.fire({ type: 'folderAction', version: PROTOCOL_VERSION, revision: readyRevision, folderId: folder.id, action: 'openHere' });
    receiveEmitter.fire({ type: 'folderAction', version: PROTOCOL_VERSION, revision: readyRevision, folderId: folder.id, action: 'revealInExplorer' });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    assert.deepEqual(actions.map(({ action }) => action), ['revealInExplorer']);

    workspacePath = 'C:\\Other';
    await provider.workspaceChanged();
    assert.equal(provider.currentState.folders[0]?.current, false);
    receiveEmitter.fire({ type: 'folderAction', version: PROTOCOL_VERSION, revision: provider.currentState.revision, folderId: folder.id, action: 'openNewWindow' });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    assert.deepEqual(actions.map(({ action }) => action), ['revealInExplorer', 'openNewWindow']);

    workspacePath = 'C:\\Project';
    const workspaceRaceRevision = provider.currentState.revision;
    receiveEmitter.fire({ type: 'folderAction', version: PROTOCOL_VERSION, revision: workspaceRaceRevision, folderId: folder.id, action: 'openHere' });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    assert.deepEqual(actions.map(({ action }) => action), ['revealInExplorer', 'openNewWindow']);

    workspacePath = 'C:\\Other';
    const staleWorkspace = deferred<{
      folderCount: number;
      path: string;
      scheme: string;
      authority: string;
      workspaceFile: null;
      remote: false;
    }>();
    pendingWorkspace = staleWorkspace;
    const staleDuringAuthorizationRevision = provider.currentState.revision;
    receiveEmitter.fire({ type: 'folderAction', version: PROTOCOL_VERSION, revision: staleDuringAuthorizationRevision, folderId: folder.id, action: 'revealInExplorer' });
    await provider.workspaceChanged();
    staleWorkspace.resolve({
      folderCount: 1,
      path: 'C:\\Other',
      scheme: 'file',
      authority: '',
      workspaceFile: null,
      remote: false,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    assert.deepEqual(actions.map(({ action }) => action), ['revealInExplorer', 'openNewWindow']);

    const deferredFinalGuard = deferred<void>();
    pendingFinalGuard = deferredFinalGuard;
    finalGuardStarted = false;
    const finalGuardRevision = provider.currentState.revision;
    receiveEmitter.fire({ type: 'folderAction', version: PROTOCOL_VERSION, revision: finalGuardRevision, folderId: folder.id, action: 'openNewWindow' });
    await waitUntil(() => finalGuardStarted);
    workspacePath = 'C:\\Project';
    deferredFinalGuard.resolve();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    assert.deepEqual(actions.map(({ action }) => action), ['revealInExplorer', 'openNewWindow']);

    workspacePath = 'C:\\Other';
    const deferredLoad = deferred<readonly KiloFolder[]>();
    pendingLoad = deferredLoad;
    const firstRefresh = provider.refresh();
    const secondRefresh = provider.refresh();
    await waitUntil(() => loadCalls === 2);
    assert.equal(loadCalls, 2);
    deferredLoad.resolve([folder]);
    await Promise.all([firstRefresh, secondRefresh]);
    assert.equal(loadCalls, 2);

    const latePost = deferred<boolean>();
    let deferNextPost = true;
    (webview as unknown as { postMessage: (message: unknown) => Promise<boolean> }).postMessage = (message) => {
      posted.push(message);
      if (deferNextPost) {
        deferNextPost = false;
        return latePost.promise;
      }
      return Promise.resolve(true);
    };
    const latePublication = provider.workspaceChanged();
    await waitUntil(() => !deferNextPost);
    disposeEmitter.fire();

    const revivedReceiveEmitter = new vscode.EventEmitter<unknown>();
    const revivedDisposeEmitter = new vscode.EventEmitter<void>();
    const revivedPosted: unknown[] = [];
    const revivedWebview = {
      options: {},
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (uri: vscode.Uri) => uri.with({ scheme: 'vscode-webview' }),
      postMessage: (message: unknown) => { revivedPosted.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: revivedReceiveEmitter.event,
    } as unknown as vscode.Webview;
    const revivedView = {
      title: '',
      webview: revivedWebview,
      visible: true,
      onDidDispose: revivedDisposeEmitter.event,
      onDidChangeVisibility: new vscode.EventEmitter<{ visible: boolean }>().event,
      show: () => undefined,
    } as unknown as vscode.WebviewView;
    provider.resolveWebviewView(revivedView);
    revivedReceiveEmitter.fire({ type: 'ready', version: PROTOCOL_VERSION });
    latePost.resolve(false);
    await latePublication;
    await waitUntil(() => revivedPosted.length > 0);
    assert.equal(outputLines.some((line) => line.includes('не принял state message')), false);
    receiveEmitter.fire({ type: 'folderAction', version: PROTOCOL_VERSION, revision: provider.currentState.revision, folderId: folder.id, action: 'revealInExplorer' });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    assert.deepEqual(actions.map(({ action }) => action), ['revealInExplorer', 'openNewWindow']);
    failLoad = true;
    await assert.rejects(provider.refresh(), /fixture failure/);
    assert.equal(provider.currentState.kind, 'refreshError');
    assert.equal(provider.currentState.folders.length, 1);
    revivedReceiveEmitter.fire(Object.create({ type: 'refresh', version: PROTOCOL_VERSION }));
    assert.ok(outputLines.some((line) => line.includes('некорректное сообщение')));

    revivedDisposeEmitter.fire();
    provider.resolveWebviewView(view);
    const disposedHandshake = provider.refresh();
    disposeEmitter.fire();
    await assert.rejects(disposedHandshake, /закрыт до готовности/);

    provider.resolveWebviewView(revivedView);
    await assert.rejects(provider.refresh(), /не ответил в течение 50 ms/);
    revivedReceiveEmitter.dispose();
    revivedDisposeEmitter.dispose();
  } finally {
    provider.dispose();
    receiveEmitter.dispose();
    disposeEmitter.dispose();
  }
}

async function testBackgroundSnapshotsWithoutWebview(repositoryRoot: string): Promise<void> {
  let reads = 0;
  let polls = 0;
  let listener: ((snapshot: HubIndexSnapshot) => void) | undefined;
  const snapshot: HubIndexSnapshot = { generation: 'fixture-generation', indexRevision: 1,
    complete: true, health: 'ready', folders: [{ id: 'c:\\project', path: 'C:\\Project',
      uri: 'file:///C:/Project', name: 'Project', available: true, conversations: [] }] };
  let pending: Deferred<{
    folderCount: 0; path: null; scheme: null; authority: null; workspaceFile: null; remote: false;
  }> | undefined;
  const workspace = { folderCount: 0, path: null, scheme: null, authority: null, workspaceFile: null, remote: false } as const;
  const provider = new KiloHubWebviewProvider({
    extensionUri: vscode.Uri.file(repositoryRoot),
    output: { appendLine: () => undefined } as unknown as vscode.OutputChannel,
    loadFolders: () => { reads += 1; return Promise.resolve([]); },
    workspaceDescriptor: () => { const next = pending; pending = undefined; return next?.promise ?? Promise.resolve(workspace); },
    index: { subscribe: (next) => { listener = next; next(snapshot); return { dispose: () => { listener = undefined; } }; },
      poll: () => { polls += 1; },
      search: (_query, queryGeneration) => Promise.resolve({ generation: snapshot.generation,
        indexRevision: snapshot.indexRevision, queryGeneration, matches: [] }) },
    executeAction: () => Promise.resolve(),
    revealView: () => Promise.resolve(),
    browserReadyTimeoutMs: 20,
  });
  try {
    await waitUntil(() => provider.currentState.kind === 'ready');
    await provider.refresh();
    assert.equal(polls, 1);
    assert.equal(reads, 0);
    assert.equal(provider.currentState.folders.length, 1);
    listener?.({ ...snapshot, complete: false, health: 'stale', diagnostic: 'source-ambiguous' });
    await waitUntil(() => provider.currentState.kind === 'refreshError');
    await provider.workspaceChanged();
    assert.equal(provider.currentState.kind, 'refreshError');
    const delayed = deferred<typeof workspace>();
    pending = delayed;
    listener?.({ ...snapshot, folders: [] });
    listener?.({ ...snapshot, complete: false, health: 'stale' });
    await waitUntil(() => provider.currentState.kind === 'refreshError');
    delayed.resolve(workspace);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    assert.equal(provider.currentState.folders.length, 1);
    assert.equal(provider.currentState.kind, 'refreshError');
  } finally {
    provider.dispose();
  }
}

async function testSearchAndPicker(repositoryRoot: string): Promise<void> {
  const receive = new vscode.EventEmitter<unknown>();
  const dispose = new vscode.EventEmitter<void>();
  const first: KiloFolder = { id: 'c:\\site', name: 'Site', path: 'C:\\Site', uri: 'file:///C:/Site',
    available: true, conversations: [{ id: 'latest', title: 'Latest title' }] };
  const other: KiloFolder = { ...first, id: 'c:\\other', name: 'Other', path: 'C:\\Other' };
  let snapshot: HubIndexSnapshot = { generation: 'synthetic', indexRevision: 1,
    health: 'ready', complete: true, folders: [first, other] };
  let listener: ((snapshot: HubIndexSnapshot) => void) | undefined;
  const searches: { query: string; generation: number; pending: Deferred<HubSearchResult> }[] = [];
  let workspacePath = 'C:\\Fresh';
  let pickerCalls = 0;
  const provider = new KiloHubWebviewProvider({ extensionUri: vscode.Uri.file(repositoryRoot),
    output: { appendLine: () => undefined } as unknown as vscode.OutputChannel,
    loadFolders: () => Promise.resolve([]), executeAction: () => Promise.resolve(),
    pickFolder: () => { pickerCalls += 1; return Promise.resolve(); },
    workspaceDescriptor: () => Promise.resolve({ folderCount: 1, path: workspacePath,
      scheme: 'file', authority: '', workspaceFile: null, remote: false }),
    index: { subscribe: (next) => { listener = next; next(snapshot); return { dispose: () => undefined }; },
      poll: () => undefined, search: (query, generation) => {
        const pending = deferred<HubSearchResult>(); searches.push({ query, generation, pending }); return pending.promise;
      } },
  });
  const view = { webview: { options: {}, html: '', cspSource: 'vscode-webview:',
    asWebviewUri: (uri: vscode.Uri) => uri, onDidReceiveMessage: receive.event,
    postMessage: () => Promise.resolve(true) }, onDidDispose: dispose.event } as unknown as vscode.WebviewView;
  const send = (query: string, generation: number): void => receive.fire({ type: 'applySearch', version: PROTOCOL_VERSION, query, generation });
  const complete = (index: number, ids: readonly string[], revision = 1): void => searches[index].pending.resolve({
    generation: 'synthetic', indexRevision: revision, queryGeneration: searches[index].generation,
    matches: ids.map((folderId) => ({ folderId, rank: 0 as const })),
  });
  try {
    provider.resolveWebviewView(view);
    receive.fire({ type: 'ready', version: PROTOCOL_VERSION });
    await waitUntil(() => provider.currentState.kind === 'ready');
    assert.equal(provider.currentState.folders[0].temporary, true);
    assert.equal(provider.currentState.folders[0].id, 'c:\\fresh');
    receive.fire({ type: 'pickFolder', version: PROTOCOL_VERSION, path: 'C:\\hostile' });
    assert.equal(pickerCalls, 0);
    receive.fire({ type: 'pickFolder', version: PROTOCOL_VERSION });
    await waitUntil(() => pickerCalls === 1);
    send('sit', 1); await waitUntil(() => searches.length === 1);
    complete(0, [first.id]); await waitUntil(() => provider.currentState.search?.generation === 1);
    assert.deepEqual(provider.currentState.folders.map(({ id }) => id), [first.id]);
    for (const query of ['ab', 'e\u0301x', '😀a']) {
      send(query, 2);
      assert.equal(searches.length, 1);
      assert.equal(provider.currentState.search?.appliedQuery, 'sit');
      assert.deepEqual(provider.currentState.folders.map(({ id }) => id), [first.id]);
    }
    snapshot = { ...snapshot, indexRevision: 2 };
    listener?.(snapshot); await waitUntil(() => searches.length === 2);
    assert.equal(searches[1].query, 'sit');
    send('oth', 2); await waitUntil(() => searches.length === 3);
    complete(2, [other.id], 2); await waitUntil(() => provider.currentState.search?.generation === 2);
    complete(1, [first.id], 2); await new Promise((done) => setTimeout(done, 10));
    assert.deepEqual(provider.currentState.folders.map(({ id }) => id), [other.id]);
    send('sit', 3); await waitUntil(() => searches.length === 4);
    send('', 4); await waitUntil(() => provider.currentState.search?.generation === 4);
    assert.equal(provider.currentState.folders.length, 3);
    complete(3, [first.id], 2); await new Promise((done) => setTimeout(done, 10));
    assert.equal(provider.currentState.folders.length, 3);
    listener?.({ ...snapshot, complete: false, health: 'stale' });
    await waitUntil(() => provider.currentState.kind === 'refreshError');
    assert.equal(provider.currentState.folders.some(({ temporary }) => temporary), false);
    await provider.workspaceChanged();
    assert.equal(provider.currentState.kind, 'refreshError');
    workspacePath = 'C:\\Other';
    listener?.(snapshot); await waitUntil(() => provider.currentState.kind === 'ready');
    assert.equal(provider.currentState.folders[0].id, other.id);
    send('sit', 5); await waitUntil(() => searches.length === 5);
    provider.resolveWebviewView(view);
    receive.fire({ type: 'ready', version: PROTOCOL_VERSION });
    await waitUntil(() => provider.currentState.kind === 'ready');
    complete(4, [first.id], 2); await new Promise((done) => setTimeout(done, 10));
    assert.equal(provider.currentState.search?.appliedQuery, '');
    assert.equal(provider.currentState.folders.length, 2);
    send('oth', 1); await waitUntil(() => searches.length === 6);
    receive.fire({ type: 'ready', version: PROTOCOL_VERSION });
    await waitUntil(() => provider.currentState.kind === 'ready' && provider.currentState.search?.generation === 0);
    complete(5, [other.id], 2); await new Promise((done) => setTimeout(done, 10));
    assert.equal(provider.currentState.search?.appliedQuery, '');
  } finally { provider.dispose(); receive.dispose(); dispose.dispose(); }

  let selected: readonly vscode.Uri[] | undefined;
  let available: string | undefined = 'C:\\Fresh';
  let current: string | undefined;
  const opened: vscode.Uri[] = [];
  let errors = 0;
  const pick = (): Promise<void> => pickExistingFolder({ select: () => Promise.resolve(selected),
    resolve: () => Promise.resolve(available), currentPath: () => current,
    open: (uri) => { opened.push(uri); return Promise.resolve(); },
    error: () => { errors += 1; return Promise.resolve(); } });
  await pick(); assert.equal(opened.length, 0); assert.equal(errors, 0);
  selected = [vscode.Uri.parse('vscode-remote://host/folder')]; await pick(); assert.equal(errors, 1);
  selected = [vscode.Uri.file('\\\\server\\share')]; await pick(); assert.equal(errors, 2);
  selected = [vscode.Uri.file('C:\\Fresh')]; available = undefined; await pick(); assert.equal(errors, 3);
  available = 'C:\\Fresh'; current = 'c:\\fresh'; await pick(); assert.equal(opened.length, 0);
  current = undefined; await pick(); assert.equal(opened[0].fsPath.toLowerCase(), 'c:\\fresh');
}

export async function run(): Promise<void> {
  const expectedNode = process.env.KILO_HUB_EXPECTED_NODE;
  const expectedElectron = process.env.KILO_HUB_EXPECTED_ELECTRON;
  if (expectedNode !== undefined) {
    assert.equal(process.versions.node, expectedNode);
  } else {
    assert.ok(Number(process.versions.node.split('.')[0]) >= 22);
  }
  if (expectedElectron !== undefined) {
    assert.equal(process.versions.electron, expectedElectron);
  }
  const runtimeProbe = new DatabaseSync(':memory:');
  try {
    assert.equal(typeof runtimeProbe.prepare('SELECT sqlite_version()').get(), 'object');
  } finally {
    runtimeProbe.close();
  }

  const repositoryRoot = resolve(__dirname, '..', '..', '..');
  assert.equal(existsSync(join(repositoryRoot, 'build', 'webview', 'webview.js')), true);
  assert.equal(existsSync(join(repositoryRoot, 'build', 'webview', 'webview.css')), true);
  await testBackgroundSnapshotsWithoutWebview(repositoryRoot);
  await testHostProviderContract(repositoryRoot);
  await testSearchAndPicker(repositoryRoot);

  const suppliedPath = process.env.KILO_HUB_SYNTHETIC_TEST === '1' ? process.env.KILO_DB : undefined;
  const installedMode = process.env.KILO_HUB_NO_EXTERNAL_TOOLS === '1';
  if (installedMode) {
    assert.ok(suppliedPath, 'Installed startup must supply the isolated sentinel before activation.');
    const systemRoot = process.env.SystemRoot;
    assert.ok(systemRoot);
    const where = join(systemRoot, 'System32', 'where.exe');
    for (const tool of ['node', 'npm', 'sqlite3', 'kilo']) {
      for (const name of [tool, `${tool}.exe`, `${tool}.cmd`, `${tool}.bat`]) {
        const probe = spawnSync(where, [name], { encoding: 'utf8', windowsHide: true });
        assert.equal(probe.status, 1, `External tool must not resolve: ${name}`);
        assert.equal(probe.stdout.trim(), '');
      }
    }
  }
  if (suppliedPath !== undefined) {
    const isolatedRoot = realpathSync(join(repositoryRoot, 'build', 'installed-smoke'));
    const parent = realpathSync(dirname(suppliedPath));
    const inside = relative(isolatedRoot, parent);
    assert.ok(inside !== '' && !inside.startsWith('..') && !isAbsolute(inside));
    assert.equal(basename(suppliedPath), 'synthetic-source-not-created.sqlite');
    assert.equal(existsSync(suppliedPath), false, 'Never overwrite an existing source.');
  }
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'kilo-hub-extension-'));
  const databasePath = suppliedPath ?? join(fixtureRoot, 'kilo.db');
  const workspacePath = resolve(repositoryRoot, 'tests', 'fixtures', 'workspace');
  createFixture(databasePath, workspacePath);
  const sourceDirectory = dirname(databasePath);
  const before = fingerprintDirectory(sourceDirectory);
  process.env.KILO_DB = databasePath;
  process.env.KILO_HUB_SYNTHETIC_TEST = '1';

  try {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    assertManifest(extension.packageJSON);
    const manifest = extension.packageJSON;
    assert.equal(manifest.version, '0.3.1');
    assert.equal(manifest.icon, 'resources/kilo-hub.png');
    assert.deepEqual(sorted(manifest.activationEvents), sorted(['onStartupFinished', 'onCommand:kiloHub.refresh', 'onView:kiloHub.folders']));
    assert.deepEqual(sorted(manifest.contributes.commands.map(({ command }) => command)), sorted(COMMAND_IDS));
    assert.equal(manifest.contributes.viewsContainers.activitybar.length, 1);
    assert.equal(manifest.contributes.viewsContainers.activitybar[0].id, VIEW_CONTAINER_ID);
    assert.deepEqual(manifest.contributes.views[VIEW_CONTAINER_ID], [{ id: VIEW_ID, name: 'Kilo Hub', type: 'webview', visibility: 'visible' }]);
    assert.equal(manifest.contributes.menus?.['view/title'], undefined);

    // A real managed Worker imports this synthetic database without resolving any Webview.
    const service = new HubIndexService(join(fixtureRoot, 'hub'), undefined, undefined, true);
    try {
      service.start();
      await waitUntil(() => service.snapshot.complete || service.snapshot.diagnostic !== undefined, 10_000);
      assert.equal(service.snapshot.complete, true);
      assert.equal(service.snapshot.folders.length, 1);
    } finally { await service.stop(); }
    const api = await extension.activate() as { getIndexSnapshot(): HubIndexSnapshot };
    await waitUntil(() => api.getIndexSnapshot().complete, 20_000);
    assert.equal(api.getIndexSnapshot().folders.length, 1);
    await vscode.commands.executeCommand('kiloHub.refresh');
    assert.equal(extension.isActive, true);
    const productCommands = (await vscode.commands.getCommands(true)).filter((id) => COMMAND_IDS.includes(id as typeof COMMAND_IDS[number]));
    assert.deepEqual(sorted(productCommands), sorted(COMMAND_IDS));
    assert.deepEqual(fingerprintDirectory(sourceDirectory), before);
    assert.deepEqual(openFolderOptions('here'), { forceReuseWindow: true });
    assert.deepEqual(openFolderOptions('newWindow'), { forceNewWindow: true });
  } finally {
    const activeExtension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(activeExtension, 'The activated extension must still be registered for teardown.');
    const lifecycle = await import(pathToFileURL(join(activeExtension.extensionPath, 'build', 'extension.js')).href) as { deactivate(): Promise<void> };
    await lifecycle.deactivate();
    delete process.env.KILO_DB;
    delete process.env.KILO_HUB_SYNTHETIC_TEST;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    rmSync(fixtureRoot, { force: true, recursive: true });
    if (suppliedPath) {
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${suppliedPath}${suffix}`, { force: true });
    }
  }
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}
