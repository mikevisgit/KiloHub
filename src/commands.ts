import { win32 } from 'node:path';

import * as vscode from 'vscode';

import { KILO_HUB_COMMANDS } from './commandIds.js';
import { sanitizeDiagnostic } from './diagnostics.js';
import type { KiloFolder } from './types.js';
import { resolveAvailableLocalDirectory } from './windowsPathSafety.js';
import { normalizeWindowsDirectory } from './projection.js';

export type FolderAction = 'openHere' | 'openNewWindow' | 'revealInExplorer';
export type FinalFolderActionGuard = () => Promise<boolean>;

const FINAL_ACTION_GUARD = Symbol('kiloHub.finalActionGuard');
type GuardedFolder = KiloFolder & { readonly [FINAL_ACTION_GUARD]?: FinalFolderActionGuard };

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

export interface FolderPickerDependencies {
  readonly select: () => Thenable<readonly vscode.Uri[] | undefined>;
  readonly resolve: (path: string) => Promise<string | undefined>;
  readonly currentPath: () => string | undefined;
  readonly open: (uri: vscode.Uri) => Thenable<unknown>;
  readonly error: () => Thenable<unknown>;
}

/** Paths originate exclusively in the native dialog, never in Webview messages. */
export async function pickExistingFolder(dependencies: FolderPickerDependencies): Promise<void> {
  try {
    const selected = await dependencies.select();
    if (selected === undefined || selected.length === 0) return;
    const uri = selected.length === 1 ? selected[0] : undefined;
    if (!uri || uri.scheme !== 'file' || uri.authority !== '' || !normalizeWindowsDirectory(uri.fsPath)) {
      await dependencies.error();
      return;
    }
    const path = await dependencies.resolve(uri.fsPath);
    const normalized = path === undefined ? null : normalizeWindowsDirectory(path);
    if (!normalized) { await dependencies.error(); return; }
    const current = dependencies.currentPath();
    if (current && normalizeWindowsDirectory(current)?.key === normalized.key) return;
    await dependencies.open(vscode.Uri.file(normalized.path));
  } catch {
    await dependencies.error();
  }
}

export async function showFolderPicker(): Promise<void> {
  await pickExistingFolder({
    select: () => vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true,
      canSelectMany: false, openLabel: 'Начать работу в новой папке' }),
    resolve: (path) => resolveAvailableLocalDirectory(path, 2_000),
    currentPath: () => !vscode.env.remoteName && !vscode.workspace.workspaceFile
      && vscode.workspace.workspaceFolders?.length === 1
      ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined,
    open: (uri) => vscode.commands.executeCommand('vscode.openFolder', uri, openFolderOptions('here')),
    error: () => vscode.window.showErrorMessage('Не удалось открыть папку: выберите доступную локальную папку Windows.'),
  });
}

function redactPath(value: string, ...paths: readonly string[]): string {
  return paths.reduce(
    (redacted, path) => path === '' ? redacted : redacted.replaceAll(path, '<local-path>'),
    value,
  );
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

export function withFinalFolderActionGuard(
  folder: KiloFolder,
  guard: FinalFolderActionGuard,
): KiloFolder {
  const guarded = { ...folder } as GuardedFolder;
  Object.defineProperty(guarded, FINAL_ACTION_GUARD, {
    configurable: false,
    enumerable: false,
    value: guard,
    writable: false,
  });
  return guarded;
}

export async function executeFolderAction(
  action: FolderAction,
  folder: KiloFolder,
  output: vscode.OutputChannel,
  finalGuard?: FinalFolderActionGuard,
): Promise<void> {
  const uri = parseLocalFolderUri(folder);
  if (uri === undefined) {
    output.appendLine('[commands] Отклонён нелокальный или некорректный path папки.');
    await vscode.window.showErrorMessage('Не удалось открыть папку: поддерживаются только локальные папки Windows.');
    return;
  }

  let resolvedPath: string | undefined;
  try {
    resolvedPath = await resolveAvailableLocalDirectory(uri.fsPath, 2_000);
    if (resolvedPath === undefined) {
      output.appendLine('[commands] Путь не является доступным локальным каталогом.');
      await vscode.window.showErrorMessage('Папка недоступна или больше не может быть открыта.');
      return;
    }

    const guard = finalGuard ?? (folder as GuardedFolder)[FINAL_ACTION_GUARD];
    if (guard !== undefined && !await guard()) {
      output.appendLine('[commands] Действие отменено после повторной проверки состояния.');
      await vscode.window.showErrorMessage('Папка недоступна или больше не может быть открыта.');
      return;
    }

    const resolvedUri = vscode.Uri.file(resolvedPath);
    if (action === 'revealInExplorer') {
      const opened = await vscode.env.openExternal(resolvedUri);
      if (!opened) {
        output.appendLine('[commands] VS Code не смог открыть проверенный путь во внешнем приложении.');
        await vscode.window.showErrorMessage('Не удалось открыть папку в Проводнике.');
      }
      return;
    }

    await vscode.commands.executeCommand(
      'vscode.openFolder',
      resolvedUri,
      openFolderOptions(action === 'openHere' ? 'here' : 'newWindow'),
    );
  } catch (error) {
    const detail = redactPath(sanitizeDiagnostic(error), folder.path, uri.fsPath, resolvedPath ?? '');
    output.appendLine(`[commands] Ошибка открытия локальной папки: ${detail}`);
    await vscode.window.showErrorMessage('Папка недоступна или больше не может быть открыта.');
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
