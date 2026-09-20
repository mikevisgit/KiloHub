import * as vscode from 'vscode';

import { registerKiloHubCommands } from './commands.js';
import { KiloFolderTreeProvider } from './folderTreeProvider.js';
import { readKiloSessions } from './kiloDataSource.js';
import { projectSessions } from './projection.js';
import { isAvailableLocalDirectory } from './windowsPathSafety.js';

const VIEW_ID = 'kiloHub.folders';
const OUTPUT_NAME = 'Kilo Hub';
const LOADING_MESSAGE = 'Загрузка истории Kilo...';
const EMPTY_MESSAGE = 'Папки с активностью Kilo не найдены.';
const ERROR_MESSAGE = 'Не удалось прочитать историю Kilo. Выполните Refresh, чтобы повторить.';
const PLATFORM_ERROR = 'Kilo Hub Step 1 поддерживает только локальный Windows Extension Host.';

function technicalError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

function installedKiloVersion(): string | undefined {
  const extension = vscode.extensions.getExtension('kilocode.kilo-code') as unknown as
    { readonly packageJSON: unknown } | undefined;
  const packageJson = extension?.packageJSON;
  if (typeof packageJson !== 'object' || packageJson === null) {
    return undefined;
  }

  const version = (packageJson as { readonly version?: unknown }).version;
  return typeof version === 'string' ? version : undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(OUTPUT_NAME);
  const provider = new KiloFolderTreeProvider();
  const treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider });
  let refreshInFlight: Promise<void> | undefined;
  let initialVisibilityHandled = false;
  let warningCount = 0;

  const logWarning = (source: string, message: string): void => {
    if (warningCount < 100) {
      output.appendLine(`[${source}] ${message}`);
    } else if (warningCount === 100) {
      output.appendLine('[warning] Дополнительные предупреждения refresh подавлены.');
    }
    warningCount += 1;
  };

  const performRefresh = async (): Promise<void> => {
    treeView.message = LOADING_MESSAGE;
    try {
      warningCount = 0;
      if (process.platform !== 'win32') {
        throw new Error(PLATFORM_ERROR);
      }

      const sessions = await readKiloSessions({
        kiloVersion: installedKiloVersion(),
        onWarning: (message) => logWarning('adapter', message),
      });
      const folders = await projectSessions(sessions, {
        isDirectoryAvailable: (path) => isAvailableLocalDirectory(path),
        onWarning: (message) => logWarning('projection', message),
      });

      provider.setFolders(folders);
      treeView.message = folders.length === 0 ? EMPTY_MESSAGE : undefined;
    } catch (error) {
      treeView.message = ERROR_MESSAGE;
      output.appendLine(`[refresh] ${technicalError(error)}`);
      await vscode.window.showErrorMessage(
        process.platform === 'win32' ? ERROR_MESSAGE : PLATFORM_ERROR,
      );
      throw error;
    }
  };

  const refresh = async (): Promise<void> => {
    if (refreshInFlight !== undefined) {
      return refreshInFlight;
    }

    const operation = performRefresh();
    refreshInFlight = operation;
    try {
      await operation;
    } finally {
      if (refreshInFlight === operation) {
        refreshInFlight = undefined;
      }
    }
  };

  const loadOnFirstVisibility = (): void => {
    if (initialVisibilityHandled) {
      return;
    }
    initialVisibilityHandled = true;
    void refresh().catch(() => undefined);
  };

  const visibilitySubscription = treeView.onDidChangeVisibility(({ visible }) => {
    if (visible) {
      loadOnFirstVisibility();
    }
  });
  const commandSubscriptions = registerKiloHubCommands({ provider, output, refresh });
  context.subscriptions.push(
    output,
    provider,
    treeView,
    visibilitySubscription,
    ...commandSubscriptions,
  );

  if (treeView.visible) {
    loadOnFirstVisibility();
  }
}
