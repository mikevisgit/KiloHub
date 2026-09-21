import * as vscode from 'vscode';

import {
  withFinalFolderActionGuard,
  type FinalFolderActionGuard,
  type FolderAction,
  type FolderCommandResolver,
} from './commands.js';
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
import { WEBVIEW_ASSET_DIRECTORY, createWebviewHtml } from './webviewHtml.js';

export const KILO_HUB_VIEW_ID = 'kiloHub.folders';
const DEFAULT_BROWSER_READY_TIMEOUT_MS = 5_000;

interface BrowserReadyWaiter {
  readonly generation: number;
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
  readonly timeout: NodeJS.Timeout;
}

export interface KiloHubWebviewDependencies {
  readonly extensionUri: vscode.Uri;
  readonly output: vscode.OutputChannel;
  readonly loadFolders: () => Promise<readonly KiloFolder[]>;
  readonly workspaceDescriptor: () => Promise<WorkspaceDescriptor>;
  readonly executeAction: (
    action: FolderAction,
    folder: KiloFolder,
    finalGuard: FinalFolderActionGuard,
  ) => Promise<void>;
  readonly now?: () => Date;
  readonly browserReadyTimeoutMs?: number;
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
  private viewGeneration = 0;
  private disposed = false;
  private readonly browserReadyWaiters = new Set<BrowserReadyWaiter>();

  public constructor(private readonly dependencies: KiloHubWebviewDependencies) {}

  public dispose(): void {
    this.disposed = true;
    this.rejectBrowserReadyWaiters(undefined, 'Webview Kilo Hub закрыт до готовности.');
    this.viewGeneration += 1;
    this.view = undefined;
    this.browserReady = false;
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
    if (this.disposed) {
      return;
    }
    this.rejectBrowserReadyWaiters(this.viewGeneration, 'Webview Kilo Hub заменён до готовности.');
    this.disposeViewSubscriptions();
    const generation = ++this.viewGeneration;
    this.view = view;
    this.browserReady = false;
    view.title = 'Kilo Hub';
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(
        this.dependencies.extensionUri,
        ...WEBVIEW_ASSET_DIRECTORY,
      )],
    };
    view.webview.html = createWebviewHtml(view.webview, this.dependencies.extensionUri);
    this.viewDisposables = [
      view.webview.onDidReceiveMessage((message: unknown) => {
        this.handleBrowserMessage(message, view, generation);
      }),
      view.onDidDispose(() => {
        if (this.isActiveView(view, generation)) {
          this.rejectBrowserReadyWaiters(generation, 'Webview Kilo Hub закрыт до готовности.');
          this.viewGeneration += 1;
          this.view = undefined;
          this.browserReady = false;
          this.disposeViewSubscriptions();
        }
      }),
    ];
  }

  public async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.refreshInFlight !== undefined) {
      return this.refreshInFlight;
    }
    const operation = this.performRefreshWhenReady();
    this.refreshInFlight = operation;
    try {
      await operation;
    } finally {
      if (this.refreshInFlight === operation) {
        this.refreshInFlight = undefined;
        if (!this.disposed && this.browserReady && this.state.kind === 'initial') {
          void this.refresh().catch(() => undefined);
        }
      }
    }
  }

  public async workspaceChanged(): Promise<void> {
    if (this.disposed) {
      return;
    }
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

  private isActiveView(view: vscode.WebviewView, generation: number): boolean {
    return !this.disposed && this.view === view && this.viewGeneration === generation;
  }

  private rejectBrowserReadyWaiters(generation: number | undefined, message: string): void {
    for (const waiter of this.browserReadyWaiters) {
      if (generation !== undefined && waiter.generation !== generation) {
        continue;
      }
      clearTimeout(waiter.timeout);
      this.browserReadyWaiters.delete(waiter);
      waiter.reject(new Error(message));
    }
  }

  private resolveBrowserReadyWaiters(generation: number): void {
    for (const waiter of this.browserReadyWaiters) {
      if (waiter.generation !== generation) {
        continue;
      }
      clearTimeout(waiter.timeout);
      this.browserReadyWaiters.delete(waiter);
      waiter.resolve();
    }
  }

  private async waitForBrowserReady(): Promise<void> {
    const view = this.view;
    const generation = this.viewGeneration;
    if (view === undefined || this.browserReady || !this.isActiveView(view, generation)) {
      return;
    }

    const timeoutMs = this.dependencies.browserReadyTimeoutMs ?? DEFAULT_BROWSER_READY_TIMEOUT_MS;
    await new Promise<void>((resolve, reject) => {
      const waiter: BrowserReadyWaiter = {
        generation,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.browserReadyWaiters.delete(waiter);
          reject(new Error(`Webview Kilo Hub не ответил в течение ${timeoutMs} ms.`));
        }, timeoutMs),
      };
      this.browserReadyWaiters.add(waiter);
    });
    if (!this.isActiveView(view, generation)) {
      throw new Error('Webview Kilo Hub изменился до завершения handshake.');
    }
  }

  private handleBrowserMessage(
    value: unknown,
    view: vscode.WebviewView,
    generation: number,
  ): void {
    if (!this.isActiveView(view, generation)) {
      return;
    }
    if (!isBrowserToHostMessage(value)) {
      this.dependencies.output.appendLine('[webview] Отклонено некорректное сообщение Webview.');
      return;
    }
    this.dispatchBrowserMessage(value, view, generation);
  }

  private dispatchBrowserMessage(
    message: BrowserToHostMessage,
    view: vscode.WebviewView,
    generation: number,
  ): void {
    switch (message.type) {
      case 'ready':
        this.browserReady = true;
        this.resolveBrowserReadyWaiters(generation);
        void this.publishState();
        if (this.state.kind === 'initial') {
          void this.refresh().catch(() => undefined);
        }
        break;
      case 'refresh':
        void this.refresh().catch(() => undefined);
        break;
      case 'folderAction':
        void this.handleFolderAction(message, view, generation);
        break;
    }
  }

  private async performRefreshWhenReady(): Promise<void> {
    await this.waitForBrowserReady();
    if (!this.disposed) {
      await this.performRefresh();
    }
  }

  private async performRefresh(): Promise<void> {
    this.state = reduceWebviewState(this.state, { type: 'loadRequested' });
    const requestRevision = this.state.revision;
    const previousFolders = this.folders;
    await this.publishState();
    try {
      const folders = await this.dependencies.loadFolders();
      if (this.disposed) {
        return;
      }
      this.folders = Object.freeze([...folders]);
      const presented = await this.createPresentation();
      this.state = reduceWebviewState(this.state, {
        type: 'loadSucceeded',
        requestRevision,
        folders: presented,
      });
      await this.publishState();
    } catch (error) {
      if (this.disposed) {
        return;
      }
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

  private async handleFolderAction(
    message: BrowserFolderActionMessage,
    view: vscode.WebviewView,
    generation: number,
  ): Promise<void> {
    const folder = await this.authorizeFolderAction(message, view, generation);
    if (folder === undefined) {
      return;
    }

    const finalGuard: FinalFolderActionGuard = async () => (
      await this.authorizeFolderAction(message, view, generation, false) !== undefined
    );
    const guardedFolder = withFinalFolderActionGuard(folder, finalGuard);
    try {
      await this.dependencies.executeAction(
        protocolAction(message.action),
        guardedFolder,
        finalGuard,
      );
    } catch (error) {
      this.dependencies.output.appendLine(`[webview] Ошибка выполнения действия: ${technicalError(error)}`);
    }
  }

  private async authorizeFolderAction(
    message: BrowserFolderActionMessage,
    view: vscode.WebviewView,
    generation: number,
    logRejection = true,
  ): Promise<KiloFolder | undefined> {
    const reject = (text: string): undefined => {
      if (logRejection) {
        this.dependencies.output.appendLine(text);
      }
      return undefined;
    };
    if (!this.isActiveView(view, generation)) {
      return reject('[webview] Отклонено действие устаревшего экземпляра Webview.');
    }
    if (!isCurrentRevision(message.revision, this.state.revision)) {
      return reject('[webview] Отклонено действие устаревшей ревизии.');
    }

    const folder = this.folders.find(({ id }) => id === message.folderId);
    const folderDto = this.state.folders.find(({ id }) => id === message.folderId);
    if (folder === undefined || folderDto === undefined || !folder.available || !folderDto.available) {
      return reject('[webview] Отклонено действие недоступной или неизвестной папки.');
    }

    let workspace: WorkspaceDescriptor;
    try {
      workspace = await this.dependencies.workspaceDescriptor();
    } catch (error) {
      if (logRejection) {
        this.dependencies.output.appendLine(`[workspace] Не удалось повторно проверить current: ${technicalError(error)}`);
      }
      return undefined;
    }
    if (!this.isActiveView(view, generation)
      || !isCurrentRevision(message.revision, this.state.revision)) {
      return reject('[webview] Отклонено действие после изменения состояния.');
    }

    const current = resolveCurrentFolder(workspace, this.folders);
    const isCurrent = current.folderId === folder.id;
    if (isCurrent && message.action !== 'revealInExplorer') {
      return reject('[webview] Отклонено действие, недоступное для текущей папки.');
    }
    return folder;
  }

  private async publishState(): Promise<void> {
    const view = this.view;
    const generation = this.viewGeneration;
    const state = this.state;
    if (!this.browserReady || view === undefined || !this.isActiveView(view, generation)) {
      return;
    }
    try {
      const accepted = await view.webview.postMessage(state);
      if (this.isActiveView(view, generation) && !accepted) {
        this.dependencies.output.appendLine('[webview] Webview не принял state message.');
      }
    } catch (error) {
      if (this.isActiveView(view, generation)) {
        this.dependencies.output.appendLine(`[webview] Ошибка postMessage: ${technicalError(error)}`);
      }
    }
  }
}
