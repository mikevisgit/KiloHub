import * as vscode from 'vscode';

import {
  withFinalFolderActionGuard,
  type FinalFolderActionGuard,
  type FolderAction,
  type FolderCommandResolver,
} from './commands.js';
import { resolveCurrentFolder, resolveTemporaryCurrentFolder } from './currentFolder.js';
import { parseSearchQuery } from './searchQuery.js';
import type { WorkspaceDescriptor } from './currentFolder.js';
import { sanitizeDiagnostic } from './diagnostics.js';
import { presentFolders } from './presentation.js';
import type { KiloFolder } from './types.js';
import type { HubIndexSnapshot, HubSearchResult } from './hubIndexProtocol.js';
import {
  isBrowserToHostMessage,
  isCurrentRevision,
  isHubFolderArray,
  WEBVIEW_STATE_MESSAGES,
} from './webviewProtocol.js';
import type {
  BrowserFolderActionMessage,
  BrowserToHostMessage,
  HostToBrowserMessage,
  HubFolderDto,
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
  readonly revealView?: () => Thenable<unknown>;
  readonly now?: () => Date;
  readonly browserReadyTimeoutMs?: number;
  readonly pickFolder?: () => Promise<void>;
  readonly index?: {
    subscribe(listener: (snapshot: HubIndexSnapshot) => void): vscode.Disposable;
    poll(): void;
    search(query: string, queryGeneration: number): Promise<HubSearchResult>;
  };
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
  private presentationGeneration = 0;
  private indexSnapshot: HubIndexSnapshot | undefined;
  private appliedQuery = '';
  private queryGeneration = 0;
  private pickerInFlight = false;
  private unfiltered: { snapshot: HubIndexSnapshot; folders: readonly HubFolderDto[] } | undefined;
  private readonly browserReadyWaiters = new Set<BrowserReadyWaiter>();

  public constructor(private readonly dependencies: KiloHubWebviewDependencies) {
    if (dependencies.index) this.disposables.push(dependencies.index.subscribe((snapshot) => {
      void this.acceptIndexSnapshot(snapshot);
    }));
  }

  private async acceptIndexSnapshot(snapshot: HubIndexSnapshot): Promise<void> {
    if (this.disposed) return;
    this.indexSnapshot = snapshot;
    const generation = ++this.presentationGeneration;
    const viewGeneration = this.viewGeneration;
    const queryGeneration = this.queryGeneration;
    const parsed = parseSearchQuery(this.appliedQuery);
    // Invalidate final action guards immediately, before filesystem/workspace awaits.
    this.state = { ...this.state, revision: this.state.revision + 1 };
    const folders = Object.freeze([...snapshot.folders]);
    try {
      const workspace = await this.dependencies.workspaceDescriptor();
      if (this.disposed || generation !== this.presentationGeneration || viewGeneration !== this.viewGeneration) return;
      const current = resolveCurrentFolder(workspace, folders);
      const options = { currentFolderId: current.folderId, now: this.dependencies.now?.() ?? new Date(),
        temporaryCurrent: resolveTemporaryCurrentFolder(workspace, folders, snapshot.complete && snapshot.health === 'ready') };
      const unfiltered = presentFolders(folders, options);
      if (!isHubFolderArray(unfiltered)) throw new Error('display-overflow');
      this.unfiltered = { snapshot, folders: unfiltered };
      const result = parsed.kind === 'query' && snapshot.generation
        ? await this.dependencies.index?.search(this.appliedQuery, queryGeneration) : undefined;
      if (this.disposed || generation !== this.presentationGeneration || viewGeneration !== this.viewGeneration
        || queryGeneration !== this.queryGeneration) return;
      if (result && (result.generation !== snapshot.generation || result.indexRevision !== snapshot.indexRevision
        || result.queryGeneration !== queryGeneration)) return;
      const presented = presentFolders(folders, {
        ...options,
        ...(parsed.kind === 'query' ? { matches: result?.matches ?? [], tokens: parsed.tokens } : {}),
      });
      if (!isHubFolderArray(presented)) throw new Error('display-overflow');
      this.folders = folders;
      this.state = this.indexedState(snapshot, presented);
      await this.publishState();
    } catch {
      if (this.disposed || generation !== this.presentationGeneration || viewGeneration !== this.viewGeneration) return;
      const retained = this.state.search?.appliedQuery === this.appliedQuery ? this.state.folders : [];
      const envelope = { version: this.state.version, revision: this.state.revision + 1, folders: retained,
        search: { generation: queryGeneration, appliedQuery: this.appliedQuery, error: null } };
      this.state = retained.length
        ? { ...envelope, kind: 'refreshError', busy: false, message: WEBVIEW_STATE_MESSAGES.refreshError }
        : { ...envelope, kind: 'initialError', busy: false, message: WEBVIEW_STATE_MESSAGES.initialError };
      this.dependencies.output.appendLine('[index] presentation-unavailable');
      await this.publishState();
    }
  }

  private indexedState(snapshot: HubIndexSnapshot, folders: readonly HubFolderDto[]): WebviewState {
    const envelope = { version: this.state.version, revision: this.state.revision + 1, folders,
      search: { generation: this.queryGeneration, appliedQuery: this.appliedQuery, error: null } };
    if (snapshot.health === 'stale' || snapshot.health === 'unavailable') return folders.length
      ? { ...envelope, kind: 'refreshError', busy: false, message: WEBVIEW_STATE_MESSAGES.refreshError }
      : { ...envelope, kind: 'initialError', busy: false, message: WEBVIEW_STATE_MESSAGES.initialError };
    if (!snapshot.complete) return folders.length
      ? { ...envelope, kind: 'refreshing', busy: true, message: WEBVIEW_STATE_MESSAGES.refreshing }
      : { ...envelope, kind: 'loading', busy: true, message: WEBVIEW_STATE_MESSAGES.loading };
    return { ...envelope, kind: 'ready', busy: false, message: folders.length ? null
      : this.appliedQuery ? WEBVIEW_STATE_MESSAGES.noResults : WEBVIEW_STATE_MESSAGES.empty };
  }

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
    this.appliedQuery = '';
    this.queryGeneration = 0;
    this.presentationGeneration += 1;
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
    if (this.indexSnapshot) {
      this.state = createInitialWebviewState(this.state.revision + 1);
      void this.acceptIndexSnapshot(this.indexSnapshot);
    }
  }

  public async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.dependencies.index) {
      this.dependencies.index.poll();
      return;
    }
    if (this.refreshInFlight !== undefined) {
      return this.refreshInFlight;
    }
    const operation = this.performRefreshAfterViewReady();
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

  private async performRefreshAfterViewReady(): Promise<void> {
    await this.ensureResolvedView();
    return this.performRefreshWhenReady();
  }

  private async ensureResolvedView(): Promise<void> {
    if (this.view !== undefined) {
      return;
    }
    await (this.dependencies.revealView?.()
      ?? vscode.commands.executeCommand('workbench.view.extension.kiloHub'));
    const timeoutMs = this.dependencies.browserReadyTimeoutMs ?? DEFAULT_BROWSER_READY_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    while (!this.disposed && this.view === undefined && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    if (this.disposed) {
      throw new Error('Kilo Hub закрыт до создания Webview.');
    }
    if (this.view === undefined) {
      throw new Error(`Webview Kilo Hub не был создан в течение ${timeoutMs} ms.`);
    }
  }

  public async workspaceChanged(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.unfiltered = undefined;
    if (this.indexSnapshot) return this.acceptIndexSnapshot(this.indexSnapshot);
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
    if (view === undefined || !this.isActiveView(view, generation)) {
      throw new Error('Webview Kilo Hub закрыт до готовности.');
    }
    if (this.browserReady) {
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
        if (this.browserReady && this.indexSnapshot) {
          // A browser reload can repeat the handshake without replacing the VS Code view object.
          this.appliedQuery = '';
          this.queryGeneration = 0;
          this.state = createInitialWebviewState(this.state.revision + 1);
          void this.acceptIndexSnapshot(this.indexSnapshot);
        }
        this.browserReady = true;
        this.resolveBrowserReadyWaiters(generation);
        void this.publishState();
        if (this.state.kind === 'initial' && !this.dependencies.index) {
          void this.refresh().catch(() => undefined);
        }
        break;
      case 'refresh':
        void this.refresh().catch(() => undefined);
        break;
      case 'applySearch': {
        if (!this.browserReady || message.generation <= this.queryGeneration) break;
        const query = parseSearchQuery(message.query);
        if (query.kind === 'invalid') {
          this.state = { ...this.state, revision: this.state.revision + 1,
            search: { generation: this.queryGeneration, appliedQuery: this.appliedQuery, error: query.reason } };
          void this.publishState();
          break;
        }
        this.appliedQuery = query.kind === 'reset' ? '' : message.query;
        this.queryGeneration = message.generation;
        if (query.kind === 'reset' && this.unfiltered && this.unfiltered.snapshot === this.indexSnapshot) {
          this.presentationGeneration += 1;
          this.folders = this.unfiltered.snapshot.folders;
          this.state = this.indexedState(this.unfiltered.snapshot, this.unfiltered.folders);
          void this.publishState();
        } else if (this.indexSnapshot) void this.acceptIndexSnapshot(this.indexSnapshot);
        break;
      }
      case 'pickFolder':
        if (this.browserReady && !this.pickerInFlight && this.dependencies.pickFolder) {
          this.pickerInFlight = true;
          void this.dependencies.pickFolder().catch(() => {
            this.dependencies.output.appendLine('[commands] folder-picker-unavailable');
          }).finally(() => { this.pickerInFlight = false; });
        }
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
      this.dependencies.output.appendLine(`[refresh] ${sanitizeDiagnostic(error)}`);
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
      this.dependencies.output.appendLine(`[workspace] ${sanitizeDiagnostic(error)}`);
      await this.publishState();
      throw error;
    }
  }

  private async createPresentation(folders: readonly KiloFolder[] = this.folders) {
    const workspace = await this.dependencies.workspaceDescriptor();
    const current = resolveCurrentFolder(workspace, folders);
    if (current.diagnostic !== 'resolved' && current.diagnostic !== 'not-in-snapshot') {
      this.dependencies.output.appendLine(`[workspace] current folder: ${current.diagnostic}`);
    }
    return presentFolders(folders, {
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
      this.dependencies.output.appendLine(`[webview] Ошибка выполнения действия: ${sanitizeDiagnostic(error)}`);
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
        this.dependencies.output.appendLine(`[workspace] Не удалось повторно проверить current: ${sanitizeDiagnostic(error)}`);
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
        this.dependencies.output.appendLine(`[webview] Ошибка postMessage: ${sanitizeDiagnostic(error)}`);
      }
    }
  }
}
