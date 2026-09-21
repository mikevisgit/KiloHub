import { win32 } from 'node:path';

import * as vscode from 'vscode';

import { KILO_HUB_COMMANDS } from './commandIds.js';
import type { KiloFolder } from './types.js';
import { isAvailableLocalDirectory } from './windowsPathSafety.js';

export type FolderAction = 'openHere' | 'openNewWindow' | 'revealInExplorer';

export interface FolderCommandResolver {
  resolveFolderCommandReference(argument: unknown): KiloFolder | undefined;
}

export interface CommandRegistrationOptions {
  readonly provider: FolderCommandResolver;
  readonly output: vscode.OutputChannel;
  readonly refresh: () => Promise<void>;
}

export function openFolderOptions(mode: 'here' | 'newWindow'):
{ forceReuseWindow: true } | { forceNewWindow: true } {
  return mode === 'here'
    ? { forceReuseWindow: true }
    : { forceNewWindow: true };
}

function technicalError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

function parseLocalFolderUri(folder: KiloFolder): vscode.Uri | undefined {
  const uri = vscode.Uri.file(folder.path);
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

export async function executeFolderAction(
  action: FolderAction,
  folder: KiloFolder,
  output: vscode.OutputChannel,
): Promise<void> {
  const uri = parseLocalFolderUri(folder);
  if (uri === undefined) {
    output.appendLine(`[commands] Отклонён нелокальный или некорректный path папки: ${folder.path}`);
    await vscode.window.showErrorMessage('Не удалось открыть папку: поддерживаются только локальные папки Windows.');
    return;
  }

  try {
    if (!await isAvailableLocalDirectory(uri.fsPath, 2_000)) {
      output.appendLine(`[commands] Путь не является доступным локальным каталогом: ${uri.fsPath}`);
      await vscode.window.showErrorMessage(`Папка недоступна: ${uri.fsPath}`);
      return;
    }

    if (action === 'revealInExplorer') {
      const opened = await vscode.env.openExternal(uri);
      if (!opened) {
        output.appendLine(`[commands] VS Code не смог открыть путь во внешнем приложении: ${uri.fsPath}`);
        await vscode.window.showErrorMessage(`Не удалось открыть папку в Проводнике: ${uri.fsPath}`);
      }
      return;
    }

    await vscode.commands.executeCommand(
      'vscode.openFolder',
      uri,
      openFolderOptions(action === 'openHere' ? 'here' : 'newWindow'),
    );
  } catch (error) {
    output.appendLine(`[commands] Ошибка открытия локальной папки ${uri.fsPath}: ${technicalError(error)}`);
    await vscode.window.showErrorMessage(`Папка недоступна: ${uri.fsPath}`);
  }
}

async function openFolderFromCommand(
  action: FolderAction,
  argument: unknown,
  options: CommandRegistrationOptions,
): Promise<void> {
  const folder = options.provider.resolveFolderCommandReference(argument);
  if (folder === undefined) {
    options.output.appendLine('[commands] Отклонена некорректная внутренняя ссылка на папку.');
    await showInvalidReference();
    return;
  }
  await executeFolderAction(action, folder, options.output);
}

/** Registers the complete Step 1 command surface. */
export function registerKiloHubCommands(
  options: CommandRegistrationOptions,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(KILO_HUB_COMMANDS.refresh, options.refresh),
    vscode.commands.registerCommand(
      KILO_HUB_COMMANDS.openHere,
      (argument: unknown) => openFolderFromCommand('openHere', argument, options),
    ),
    vscode.commands.registerCommand(
      KILO_HUB_COMMANDS.openNewWindow,
      (argument: unknown) => openFolderFromCommand('openNewWindow', argument, options),
    ),
    vscode.commands.registerCommand(
      KILO_HUB_COMMANDS.openInFileExplorer,
      (argument: unknown) => openFolderFromCommand('revealInExplorer', argument, options),
    ),
  ];
}
