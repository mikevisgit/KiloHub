import * as vscode from 'vscode';

import type { FolderAction, FolderCommandResolver } from './commands.js';
import { resolveCurrentFolder } from './currentFolder.js';
import type { WorkspaceDescriptor } from './currentFolder.js';
import { presentFolders } from './presentation.js';
import type { KiloFolder } from './types.js';
import {
  isBrowserToHostMessage,
  isCurrentRevision,
} from './webviewProtocol.js';
import type {
  BrowserFolderActionMessage,
  BrowserToHostMessage,
  HostToBrowserMessage,
} from './webviewProtocol.js';
import {
  createInitialWebviewState,
  reduceWebviewState,
} from './webviewState.js';
import type { WebviewState } from './webviewState.js';
import { createWebviewHtml } from './webviewHtml.js';

export const KILO_HUB_VIEW_ID = 'kiloHub.folders';

export interface KiloHubWebviewDependencies {
  readonly extensionUri: vscode.Uri;
  readonly output: vscode.OutputChannel;
  readonly loadFolders: () => Promise<readonly KiloFolder[]>;
  readonly workspaceDescriptor: () => Promise<WorkspaceDescriptor>;
  readonly executeAction: (action: FolderAction, folder: KiloFolder) => Promise<void>;
  readonly now?: () => Date;
}

function technicalError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

function protocolAction(action: BrowserFolderActionMessage['action']): FolderAction {
  return action;
}

export class KiloHubWebviewProvider
implements vscode.WebviewViewProvider, vscode.Disposable, FolderCommandResolver {
  private readonly disposables: vscode.Disposable[] = [];
  private viewDisposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private browserReady = false;
  private state: WebviewState = createInitialWebviewState();
  private folders: readonly KiloFolder[] = [];
  private refreshInFlight: Promise<void> | undefined;

  public constructor(private readonly dependencies: KiloHubWebviewDependencies) {}

  public dispose(): void {
    this.disposeViewSubscriptions();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  public resolveFolderCommandReference(argument: unknown): KiloFolder | undefined {
    void argument;
    return undefined;
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.disposeViewSubscriptions();
    this.view = view;
    this.browserReady = false;
    view.title = 'Kilo Hub';
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.dependencies.extensionUri, 'build')],
    };
    view.webview.html = createWebviewHtml(view.webview, this.dependencies.extensionUri);
    this.viewDisposables = [
      view.webview.onDidReceiveMessage((message: unknown) => {
        this.handleBrowserMessage(message);
      }),
      view.onDidDispose(() => {
        if (this.view === view) {
          this.view = undefined;
          this.browserReady = false;
        }
        this.disposeViewSubscriptions();
      }),
    ];
  }

  public async refresh(): Promise<void> {
    if (this.refreshInFlight !== undefined) {
      return this.refreshInFlight;
    }
    const operation = this.performRefresh();
    this.refreshInFlight = operation;
    try {
      await operation;
    } finally {
      if (this.refreshInFlight === operation) {
        this.refreshInFlight = undefined;
      }
    }
  }

  public async workspaceChanged(): Promise<void> {
    if (this.state.kind === 'initial' || this.state.kind === 'initialError') {
      return;
    }
    await this.replacePresentationWithoutRead();
  }

  public get currentState(): HostToBrowserMessage {
    return this.state;
  }

  private disposeViewSubscriptions(): void {
    for (const disposable of this.viewDisposables.splice(0)) {
      disposable.dispose();
    }
  }

  private handleBrowserMessage(value: unknown): void {
    if (!isBrowserToHostMessage(value)) {
      this.dependencies.output.appendLine('[webview] Отклонено некорректное сообщение Webview.');
      return;
    }
    this.dispatchBrowserMessage(value);
  }

  private dispatchBrowserMessage(message: BrowserToHostMessage): void {
    switch (message.type) {
      case 'ready':
        this.browserReady = true;
        void this.publishState();
        if (this.state.kind === 'initial') {
          void this.refresh().catch(() => undefined);
        }
        break;
      case 'refresh':
        void this.refresh().catch(() => undefined);
        break;
      case 'folderAction':
        void this.handleFolderAction(message);
        break;
    }
  }

  private async performRefresh(): Promise<void> {
    this.state = reduceWebviewState(this.state, { type: 'loadRequested' });
    const requestRevision = this.state.revision;
    const previousFolders = this.folders;
    await this.publishState();
    try {
      const folders = await this.dependencies.loadFolders();
      this.folders = Object.freeze([...folders]);
      const presented = await this.createPresentation();
      this.state = reduceWebviewState(this.state, {
        type: 'loadSucceeded',
        requestRevision,
        folders: presented,
      });
      await this.publishState();
    } catch (error) {
      this.folders = previousFolders;
      this.state = reduceWebviewState(this.state, {
        type: 'loadFailed',
        requestRevision,
      });
      this.dependencies.output.appendLine(`[refresh] ${technicalError(error)}`);
      await this.publishState();
      throw error;
    }
  }

  private async replacePresentationWithoutRead(): Promise<void> {
    if (this.state.busy) {
      return;
    }
    this.state = reduceWebviewState(this.state, { type: 'loadRequested' });
    const requestRevision = this.state.revision;
    try {
      const presented = await this.createPresentation();
      this.state = reduceWebviewState(this.state, {
        type: 'loadSucceeded',
        requestRevision,
        folders: presented,
      });
      await this.publishState();
    } catch (error) {
      this.state = reduceWebviewState(this.state, {
        type: 'loadFailed',
        requestRevision,
      });
      this.dependencies.output.appendLine(`[workspace] ${technicalError(error)}`);
      await this.publishState();
      throw error;
    }
  }

  private async createPresentation() {
    const workspace = await this.dependencies.workspaceDescriptor();
    const current = resolveCurrentFolder(workspace, this.folders);
    if (current.diagnostic !== 'resolved' && current.diagnostic !== 'not-in-snapshot') {
      this.dependencies.output.appendLine(`[workspace] current folder: ${current.diagnostic}`);
    }
    return presentFolders(this.folders, {
      currentFolderId: current.folderId,
      now: this.dependencies.now?.() ?? new Date(),
    });
  }

  private async handleFolderAction(message: BrowserFolderActionMessage): Promise<void> {
    if (!isCurrentRevision(message.revision, this.state.revision)) {
      this.dependencies.output.appendLine('[webview] Отклонено действие устаревшей ревизии.');
      return;
    }
    const folder = this.folders.find(({ id }) => id === message.folderId);
    const folderDto = this.state.folders.find(({ id }) => id === message.folderId);
    if (folder === undefined || folderDto === undefined || !folder.available || !folderDto.available) {
      this.dependencies.output.appendLine('[webview] Отклонено действие недоступной или неизвестной папки.');
      return;
    }
    if (folderDto.current && message.action !== 'revealInExplorer') {
      this.dependencies.output.appendLine('[webview] Отклонено действие, недоступное для текущей папки.');
      return;
    }
    await this.dependencies.executeAction(protocolAction(message.action), folder);
  }

  private async publishState(): Promise<void> {
    if (!this.browserReady || this.view === undefined) {
      return;
    }
    const accepted = await this.view.webview.postMessage(this.state);
    if (!accepted) {
      this.dependencies.output.appendLine('[webview] Webview не принял state message.');
    }
  }
}
