import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import * as vscode from 'vscode';

import { openFolderOptions } from '../../src/commands.js';
import { KiloFolderTreeProvider } from '../../src/folderTreeProvider.js';

const EXTENSION_ID = 'local.kilo-hub';
const VIEW_CONTAINER_ID = 'kiloHub';
const VIEW_ID = 'kiloHub.folders';
const COMMAND_IDS = [
  'kiloHub.openHere',
  'kiloHub.openInFileExplorer',
  'kiloHub.openNewWindow',
  'kiloHub.refresh',
] as const;

interface ManifestCommand {
  command: string;
}

interface ManifestView {
  id: string;
}

interface ExtensionManifest {
  activationEvents: string[];
  contributes: {
    commands: ManifestCommand[];
    views: Record<string, ManifestView[]>;
    viewsContainers: {
      activitybar: ManifestView[];
    };
  };
}

function assertManifest(value: unknown): asserts value is ExtensionManifest {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  const manifest = value as Partial<ExtensionManifest>;
  assert.ok(Array.isArray(manifest.activationEvents));
  const contributes = manifest.contributes;
  if (!contributes || typeof contributes !== 'object') {
    assert.fail('Extension manifest has no contributes object.');
  }
  assert.ok(Array.isArray(contributes.commands));
  assert.equal(typeof contributes.views, 'object');
  assert.notEqual(contributes.views, null);
  assert.ok(Array.isArray(contributes.viewsContainers?.activitybar));
}

function createFixture(databasePath: string, workspacePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`CREATE TABLE session (
      id TEXT NOT NULL PRIMARY KEY,
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
    .map((name) => {
      const digest = createHash('sha256').update(readFileSync(join(directory, name))).digest('hex');
      return `${name}:${digest}`;
    });
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function testTreeProviderContract(): void {
  const provider = new KiloFolderTreeProvider();
  try {
    provider.setFolders([{
      id: 'c:\\missing project',
      uri: 'file:///C:/Missing%20Project',
      path: 'C:\\Missing Project',
      name: 'Missing Project',
      available: false,
      lastKiloActivityAt: '2026-09-19T20:00:00.000Z',
      conversations: [{
        id: 'session-1',
        title: 'Проверочный диалог',
        updatedAt: '2026-09-19T20:00:00.000Z',
      }],
    }]);

    const roots = provider.getChildren();
    assert.equal(roots.length, 1);
    const rootItem = provider.getTreeItem(roots[0]);
    assert.equal(rootItem.label, 'Missing Project');
    assert.equal(rootItem.description, undefined);
    assert.equal(rootItem.command, undefined);
    assert.equal(rootItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

    const children = provider.getChildren(roots[0]);
    assert.deepEqual(
      children.map((child) => provider.getTreeItem(child).label),
      [
        vscode.Uri.parse('file:///C:/Missing%20Project', true).fsPath,
        'Open Here',
        'Open in New Window',
        'Open in File Explorer',
        'Проверочный диалог',
      ],
    );
    for (const action of children.slice(1, 4)) {
      const item = provider.getTreeItem(action);
      assert.equal(item.command, undefined);
      assert.equal(item.tooltip, 'Папка недоступна; действие заблокировано.');
    }
    assert.equal(provider.getTreeItem(children[4]).command, undefined);
  } finally {
    provider.dispose();
  }
}

export async function run(): Promise<void> {
  assert.equal(process.versions.node, '22.19.0');
  assert.equal(process.versions.electron, '37.6.0');
  assert.equal(typeof DatabaseSync, 'function');

  const runtimeProbe = new DatabaseSync(':memory:');
  try {
    const row = runtimeProbe.prepare('SELECT sqlite_version() AS version').get() as Record<string, unknown>;
    assert.equal(typeof row.version, 'string');
  } finally {
    runtimeProbe.close();
  }

  testTreeProviderContract();
  assert.deepEqual(openFolderOptions('here'), { forceReuseWindow: true });
  assert.deepEqual(openFolderOptions('newWindow'), { forceNewWindow: true });

  const workspacePath = resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'workspace');
  const tempDirectory = mkdtempSync(join(tmpdir(), 'kilo-hub-extension-'));
  const databasePath = join(tempDirectory, 'kilo.db');
  const previousKiloDatabase = process.env.KILO_DB;

  try {
    createFixture(databasePath, workspacePath);
    const before = fingerprintDirectory(dirname(databasePath));
    process.env.KILO_DB = databasePath;

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the Extension Development Host.`);
    assert.equal(extension.isActive, false, 'The fixture must exist before extension activation.');

    const manifestValue: unknown = extension.packageJSON;
    assertManifest(manifestValue);
    assert.deepEqual(
      sorted(manifestValue.contributes.commands.map(({ command }) => command)),
      sorted(COMMAND_IDS),
    );
    assert.deepEqual(
      manifestValue.contributes.viewsContainers.activitybar.map(({ id }) => id),
      [VIEW_CONTAINER_ID],
    );
    assert.deepEqual(
      Object.keys(manifestValue.contributes.views),
      [VIEW_CONTAINER_ID],
    );
    assert.deepEqual(
      manifestValue.contributes.views[VIEW_CONTAINER_ID]?.map(({ id }) => id),
      [VIEW_ID],
    );
    assert.ok(manifestValue.activationEvents.includes(`onView:${VIEW_ID}`));
    assert.ok(manifestValue.activationEvents.includes('onCommand:kiloHub.refresh'));

    await vscode.commands.executeCommand<void>('kiloHub.refresh');
    assert.equal(extension.isActive, true);

    const registeredCommands = await vscode.commands.getCommands(true);
    const registeredKiloHubCommands = registeredCommands
      .filter((command) => command.startsWith('kiloHub.'))
      .sort();
    const productCommands = new Set<string>(COMMAND_IDS);
    for (const command of COMMAND_IDS) {
      assert.ok(registeredKiloHubCommands.includes(command), `${command} is not registered.`);
    }
    assert.deepEqual(
      registeredKiloHubCommands.filter((command) => (
        !productCommands.has(command) && !command.startsWith(`${VIEW_ID}.`)
      )),
      [],
    );
    assert.deepEqual(fingerprintDirectory(dirname(databasePath)), before);
  } finally {
    if (previousKiloDatabase === undefined) {
      delete process.env.KILO_DB;
    } else {
      process.env.KILO_DB = previousKiloDatabase;
    }
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}
