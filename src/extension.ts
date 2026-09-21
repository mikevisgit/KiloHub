import * as vscode from 'vscode';

import {
  executeFolderAction,
  registerKiloHubCommands,
} from './commands.js';
import type { WorkspaceDescriptor } from './currentFolder.js';
import {
  KILO_HUB_VIEW_ID,
  KiloHubWebviewProvider,
} from './kiloHubWebviewProvider.js';
import { readKiloSessions } from './kiloDataSource.js';
import { projectSessions } from './projection.js';
import { isAvailableLocalDirectory } from './windowsPathSafety.js';

const OUTPUT_NAME = 'Kilo Hub';
const PLATFORM_ERROR = 'Kilo Hub Step 2 поддерживает только локальный Windows Extension Host.';

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

async function describeWorkspace(): Promise<WorkspaceDescriptor> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const uri = folders.length === 1 ? folders[0].uri : undefined;
  let path: string | null = null;
  if (uri?.scheme === 'file' && (uri.authority === '' || uri.authority === 'localhost')) {
    path = await isAvailableLocalDirectory(uri.fsPath) ? uri.fsPath : null;
  }
  return {
    folderCount: folders.length,
    path,
    scheme: uri?.scheme ?? null,
    authority: uri?.authority ?? null,
    workspaceFile: vscode.workspace.workspaceFile?.toString() ?? null,
    remote: vscode.env.remoteName !== undefined,
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(OUTPUT_NAME);
  let warningCount = 0;
  const logWarning = (source: string, message: string): void => {
    if (warningCount < 100) {
      output.appendLine(`[${source}] ${message}`);
    } else if (warningCount === 100) {
      output.appendLine('[warning] Дополнительные предупреждения refresh подавлены.');
    }
    warningCount += 1;
  };

  const provider = new KiloHubWebviewProvider({
    extensionUri: context.extensionUri,
    output,
    loadFolders: async () => {
      warningCount = 0;
      if (process.platform !== 'win32') {
        throw new Error(PLATFORM_ERROR);
      }
      const sessions = await readKiloSessions({
        kiloVersion: installedKiloVersion(),
        onWarning: (message) => logWarning('adapter', message),
      });
      return projectSessions(sessions, {
        isDirectoryAvailable: (path) => isAvailableLocalDirectory(path),
        onWarning: (message) => logWarning('projection', message),
      });
    },
    workspaceDescriptor: describeWorkspace,
    executeAction: (action, folder) => executeFolderAction(action, folder, output),
  });
  const viewRegistration = vscode.window.registerWebviewViewProvider(
    KILO_HUB_VIEW_ID,
    provider,
    { webviewOptions: { retainContextWhenHidden: false } },
  );
  const commandSubscriptions = registerKiloHubCommands({
    provider,
    output,
    refresh: () => provider.refresh(),
  });
  const workspaceSubscription = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    void provider.workspaceChanged().catch((error: unknown) => {
      output.appendLine(`[workspace] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    });
  });

  context.subscriptions.push(
    output,
    provider,
    viewRegistration,
    workspaceSubscription,
    ...commandSubscriptions,
  );
}
