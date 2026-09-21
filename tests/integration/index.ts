import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import * as vscode from 'vscode';

import { openFolderOptions } from '../../src/commands.js';
import type { FolderAction } from '../../src/commands.js';
import { KiloHubWebviewProvider } from '../../src/kiloHubWebviewProvider.js';
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
  activationEvents: string[];
  contributes: {
    commands: ManifestCommand[];
    views: Record<string, ManifestView[]>;
    viewsContainers: { activitybar: ManifestView[] };
    menus?: Record<string, unknown>;
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
    loadFolders: () => failLoad ? Promise.reject(new Error('fixture failure')) : Promise.resolve([folder]),
    workspaceDescriptor: () => Promise.resolve({
      folderCount: 1,
      path: workspacePath,
      scheme: 'file',
      authority: '',
      workspaceFile: null,
      remote: false,
    }),
    executeAction: (action, actionFolder) => {
      actions.push({ action, folder: actionFolder });
      return Promise.resolve();
    },
    now: () => new Date('2026-09-20T12:00:00.000Z'),
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
    assert.match(webview.html, /Content-Security-Policy/);
    assert.match(webview.html, /build\/webview\.js/);
    assert.match(webview.html, /build\/webview\.css/);
    assert.doesNotMatch(webview.html, /Fixture conversation/);

    receiveEmitter.fire({ type: 'ready', version: PROTOCOL_VERSION });
    await waitUntil(() => provider.currentState.kind === 'ready');
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

    failLoad = true;
    await assert.rejects(provider.refresh(), /fixture failure/);
    assert.equal(provider.currentState.kind, 'refreshError');
    assert.equal(provider.currentState.folders.length, 1);
    receiveEmitter.fire(Object.create({ type: 'refresh', version: PROTOCOL_VERSION }));
    assert.ok(outputLines.some((line) => line.includes('некорректное сообщение')));
  } finally {
    provider.dispose();
    receiveEmitter.dispose();
    disposeEmitter.dispose();
  }
}

export async function run(): Promise<void> {
  assert.equal(process.versions.node, '22.19.0');
  assert.equal(process.versions.electron, '37.6.0');
  const runtimeProbe = new DatabaseSync(':memory:');
  try {
    assert.equal(typeof runtimeProbe.prepare('SELECT sqlite_version()').get(), 'object');
  } finally {
    runtimeProbe.close();
  }

  const repositoryRoot = resolve(__dirname, '..', '..', '..');
  assert.equal(existsSync(join(repositoryRoot, 'build', 'webview.js')), true);
  assert.equal(existsSync(join(repositoryRoot, 'build', 'webview.css')), true);
  await testHostProviderContract(repositoryRoot);

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'kilo-hub-extension-'));
  const databasePath = join(fixtureRoot, 'kilo.db');
  const workspacePath = resolve(repositoryRoot, 'tests', 'fixtures', 'workspace');
  createFixture(databasePath, workspacePath);
  const before = fingerprintDirectory(fixtureRoot);
  process.env.KILO_DB = databasePath;

  try {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    assert.equal(extension.isActive, false);
    assertManifest(extension.packageJSON);
    const manifest = extension.packageJSON;
    assert.equal(manifest.version, '0.2.0');
    assert.deepEqual(sorted(manifest.activationEvents), sorted(['onCommand:kiloHub.refresh', 'onView:kiloHub.folders']));
    assert.deepEqual(sorted(manifest.contributes.commands.map(({ command }) => command)), sorted(COMMAND_IDS));
    assert.equal(manifest.contributes.viewsContainers.activitybar.length, 1);
    assert.equal(manifest.contributes.viewsContainers.activitybar[0].id, VIEW_CONTAINER_ID);
    assert.deepEqual(manifest.contributes.views[VIEW_CONTAINER_ID], [{ id: VIEW_ID, name: 'Kilo Hub', type: 'webview', visibility: 'visible' }]);
    assert.equal(manifest.contributes.menus?.['view/title'], undefined);

    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    await vscode.commands.executeCommand('kiloHub.refresh');
    assert.equal(extension.isActive, true);
    const productCommands = (await vscode.commands.getCommands(true)).filter((id) => COMMAND_IDS.includes(id as typeof COMMAND_IDS[number]));
    assert.deepEqual(sorted(productCommands), sorted(COMMAND_IDS));
    assert.deepEqual(fingerprintDirectory(fixtureRoot), before);
    assert.deepEqual(openFolderOptions('here'), { forceReuseWindow: true });
    assert.deepEqual(openFolderOptions('newWindow'), { forceNewWindow: true });
  } finally {
    delete process.env.KILO_DB;
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}
