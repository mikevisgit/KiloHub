import { stat } from 'node:fs/promises';

import * as vscode from 'vscode';

import { registerKiloHubCommands } from './commands.js';
import { KiloFolderTreeProvider } from './folderTreeProvider.js';
import { readKiloSessions } from './kiloDataSource.js';
import { projectSessions } from './projection.js';

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

async function isDirectoryAvailable(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(OUTPUT_NAME);
  const provider = new KiloFolderTreeProvider();
  const treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider });
  let refreshInFlight: Promise<void> | undefined;
  let initialVisibilityHandled = false;

  const performRefresh = async (): Promise<void> => {
    treeView.message = LOADING_MESSAGE;
    try {
      if (process.platform !== 'win32') {
        throw new Error(PLATFORM_ERROR);
      }

      const sessions = readKiloSessions({
        kiloVersion: installedKiloVersion(),
        onWarning: (message) => output.appendLine(`[adapter] ${message}`),
      });
      const folders = await projectSessions(sessions, {
        isDirectoryAvailable,
        onWarning: (message) => output.appendLine(`[projection] ${message}`),
      });

      provider.setFolders(folders);
      treeView.message = folders.length === 0 ? EMPTY_MESSAGE : undefined;
    } catch (error) {
      treeView.message = ERROR_MESSAGE;
      output.appendLine(`[refresh] ${technicalError(error)}`);
      await vscode.window.showErrorMessage(
        process.platform === 'win32' ? ERROR_MESSAGE : PLATFORM_ERROR,
      );
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
    void refresh();
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
