import { stat } from 'node:fs/promises';
import { win32 } from 'node:path';

import * as vscode from 'vscode';

import {
  KILO_HUB_COMMANDS,
  type KiloFolderTreeProvider,
} from './folderTreeProvider.js';
import type { KiloFolder } from './types.js';

export interface CommandRegistrationOptions {
  readonly provider: KiloFolderTreeProvider;
  readonly output: vscode.OutputChannel;
  readonly refresh: () => Promise<void>;
}

type OpenMode = 'here' | 'newWindow' | 'fileExplorer';

function technicalError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

function parseLocalFolderUri(folder: KiloFolder): vscode.Uri | undefined {
  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(folder.uri, true);
  } catch {
    return undefined;
  }

  if (
    uri.scheme !== 'file'
    || uri.authority !== ''
    || !/^[A-Za-z]:[\\/]/.test(uri.fsPath)
    || !win32.isAbsolute(uri.fsPath)
    || uri.fsPath.startsWith('\\\\')
  ) {
    return undefined;
  }
  return uri;
}

async function showInvalidReference(): Promise<void> {
  await vscode.window.showErrorMessage('Не удалось открыть папку: некорректная внутренняя ссылка Kilo Hub.');
}

async function openFolder(
  mode: OpenMode,
  argument: unknown,
  options: CommandRegistrationOptions,
): Promise<void> {
  const folder = options.provider.resolveFolderCommandReference(argument);
  if (folder === undefined) {
    options.output.appendLine('[commands] Отклонена некорректная внутренняя ссылка на папку.');
    await showInvalidReference();
    return;
  }

  const uri = parseLocalFolderUri(folder);
  if (uri === undefined) {
    options.output.appendLine(`[commands] Отклонён нелокальный или некорректный URI папки: ${folder.uri}`);
    await vscode.window.showErrorMessage('Не удалось открыть папку: поддерживаются только локальные папки Windows.');
    return;
  }

  try {
    const status = await stat(uri.fsPath);
    if (!status.isDirectory()) {
      options.output.appendLine(`[commands] Путь не является каталогом: ${uri.fsPath}`);
      await vscode.window.showErrorMessage(`Папка недоступна: ${uri.fsPath}`);
      return;
    }

    if (mode === 'fileExplorer') {
      const opened = await vscode.env.openExternal(uri);
      if (!opened) {
        options.output.appendLine(`[commands] VS Code не смог открыть путь во внешнем приложении: ${uri.fsPath}`);
        await vscode.window.showErrorMessage(`Не удалось открыть папку в Проводнике: ${uri.fsPath}`);
      }
      return;
    }

    const openOptions = mode === 'here'
      ? { forceReuseWindow: true }
      : { forceNewWindow: true };
    await vscode.commands.executeCommand('vscode.openFolder', uri, openOptions);
  } catch (error) {
    options.output.appendLine(`[commands] Ошибка открытия локальной папки ${uri.fsPath}: ${technicalError(error)}`);
    await vscode.window.showErrorMessage(`Папка недоступна: ${uri.fsPath}`);
  }
}

/** Registers the complete Step 1 command surface. */
export function registerKiloHubCommands(
  options: CommandRegistrationOptions,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(KILO_HUB_COMMANDS.refresh, options.refresh),
    vscode.commands.registerCommand(
      KILO_HUB_COMMANDS.openHere,
      (argument: unknown) => openFolder('here', argument, options),
    ),
    vscode.commands.registerCommand(
      KILO_HUB_COMMANDS.openNewWindow,
      (argument: unknown) => openFolder('newWindow', argument, options),
    ),
    vscode.commands.registerCommand(
      KILO_HUB_COMMANDS.openInFileExplorer,
      (argument: unknown) => openFolder('fileExplorer', argument, options),
    ),
  ];
}
