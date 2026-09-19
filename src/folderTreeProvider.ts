import * as vscode from 'vscode';

import type { KiloConversation, KiloFolder } from './types.js';

export const KILO_HUB_COMMANDS = {
  refresh: 'kiloHub.refresh',
  openHere: 'kiloHub.openHere',
  openNewWindow: 'kiloHub.openNewWindow',
  openInFileExplorer: 'kiloHub.openInFileExplorer',
} as const;

export interface FolderCommandReference {
  readonly kind: 'kiloHub.folderReference';
}

interface FolderNode {
  readonly kind: 'folder';
  readonly folder: KiloFolder;
}

interface PathNode {
  readonly kind: 'path';
  readonly folder: KiloFolder;
}

interface ActionNode {
  readonly kind: 'action';
  readonly folder: KiloFolder;
  readonly action: 'openHere' | 'openNewWindow' | 'openInFileExplorer';
}

interface ConversationNode {
  readonly kind: 'conversation';
  readonly folder: KiloFolder;
  readonly conversation: KiloConversation;
}

export type KiloFolderTreeNode = FolderNode | PathNode | ActionNode | ConversationNode;

const ACTIONS: ReadonlyArray<{
  action: ActionNode['action'];
  label: string;
  icon: string;
  command: string;
}> = [
  {
    action: 'openHere',
    label: 'Open Here',
    icon: 'folder-opened',
    command: KILO_HUB_COMMANDS.openHere,
  },
  {
    action: 'openNewWindow',
    label: 'Open in New Window',
    icon: 'empty-window',
    command: KILO_HUB_COMMANDS.openNewWindow,
  },
  {
    action: 'openInFileExplorer',
    label: 'Open in File Explorer',
    icon: 'folder-library',
    command: KILO_HUB_COMMANDS.openInFileExplorer,
  },
];

function folderPath(folder: KiloFolder): string {
  return vscode.Uri.parse(folder.uri, true).fsPath;
}

function formatDate(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString();
}

function folderTooltip(folder: KiloFolder): string {
  const details = [
    folderPath(folder),
    `Диалогов: ${folder.conversations.length}`,
  ];
  const lastActivity = formatDate(folder.lastKiloActivityAt);
  if (lastActivity !== undefined) {
    details.push(`Последняя активность: ${lastActivity}`);
  }
  if (!folder.available) {
    details.push('Папка недоступна.');
  }
  return details.join('\n');
}

/** Native tree projection for the current in-memory Kilo folder model. */
export class KiloFolderTreeProvider
implements vscode.TreeDataProvider<KiloFolderTreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<KiloFolderTreeNode | undefined>();
  private folders: readonly KiloFolder[] = [];
  private commandReferences = new Map<string, FolderCommandReference>();
  private commandFolders = new WeakMap<object, KiloFolder>();

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public dispose(): void {
    this.changeEmitter.dispose();
  }

  public setFolders(folders: readonly KiloFolder[]): void {
    const nextReferences = new Map<string, FolderCommandReference>();
    const nextCommandFolders = new WeakMap<object, KiloFolder>();

    for (const folder of folders) {
      const reference = this.commandReferences.get(folder.id)
        ?? Object.freeze({ kind: 'kiloHub.folderReference' as const });
      nextReferences.set(folder.id, reference);
      nextCommandFolders.set(reference, folder);
    }

    this.folders = folders;
    this.commandReferences = nextReferences;
    this.commandFolders = nextCommandFolders;
    this.changeEmitter.fire(undefined);
  }

  public resolveFolderCommandReference(argument: unknown): KiloFolder | undefined {
    return typeof argument === 'object' && argument !== null
      ? this.commandFolders.get(argument)
      : undefined;
  }

  public getTreeItem(element: KiloFolderTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'folder':
        return this.createFolderItem(element.folder);
      case 'path':
        return this.createPathItem(element.folder);
      case 'action':
        return this.createActionItem(element);
      case 'conversation':
        return this.createConversationItem(element.folder, element.conversation);
    }
  }

  public getChildren(element?: KiloFolderTreeNode): KiloFolderTreeNode[] {
    if (element === undefined) {
      return this.folders.map((folder) => ({ kind: 'folder', folder }));
    }
    if (element.kind !== 'folder') {
      return [];
    }

    const folder = element.folder;
    return [
      { kind: 'path', folder },
      ...ACTIONS.map(({ action }) => ({ kind: 'action' as const, folder, action })),
      ...folder.conversations.map((conversation) => ({
        kind: 'conversation' as const,
        folder,
        conversation,
      })),
    ];
  }

  private createFolderItem(folder: KiloFolder): vscode.TreeItem {
    const item = new vscode.TreeItem(folder.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `folder:${folder.id}`;
    item.tooltip = folderTooltip(folder);
    item.contextValue = folder.available ? 'kiloHub.folder' : 'kiloHub.folder.missing';
    item.iconPath = folder.available
      ? new vscode.ThemeIcon('folder')
      : new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    return item;
  }

  private createPathItem(folder: KiloFolder): vscode.TreeItem {
    const path = folderPath(folder);
    const item = new vscode.TreeItem(path, vscode.TreeItemCollapsibleState.None);
    item.id = `folder:${folder.id}:path`;
    item.tooltip = path;
    item.iconPath = new vscode.ThemeIcon('location');
    item.contextValue = 'kiloHub.path';
    return item;
  }

  private createActionItem(node: ActionNode): vscode.TreeItem {
    const definition = ACTIONS.find(({ action }) => action === node.action);
    if (definition === undefined) {
      throw new Error(`Unknown folder action: ${node.action}`);
    }

    const item = new vscode.TreeItem(definition.label, vscode.TreeItemCollapsibleState.None);
    item.id = `folder:${node.folder.id}:action:${node.action}`;
    item.iconPath = new vscode.ThemeIcon(definition.icon);
    item.contextValue = node.folder.available ? 'kiloHub.action' : 'kiloHub.action.missing';
    if (node.folder.available) {
      const reference = this.commandReferences.get(node.folder.id);
      if (reference !== undefined) {
        item.command = {
          command: definition.command,
          title: definition.label,
          arguments: [reference],
        };
      }
    } else {
      item.tooltip = 'Папка недоступна; действие заблокировано.';
    }
    return item;
  }

  private createConversationItem(
    folder: KiloFolder,
    conversation: KiloConversation,
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(conversation.title, vscode.TreeItemCollapsibleState.None);
    const date = formatDate(conversation.updatedAt);
    item.id = `folder:${folder.id}:conversation:${conversation.id}`;
    item.description = date;
    item.tooltip = date === undefined
      ? conversation.title
      : `${conversation.title}\n${date}`;
    item.iconPath = new vscode.ThemeIcon('comment-discussion');
    item.contextValue = 'kiloHub.conversation';
    return item;
  }
}
