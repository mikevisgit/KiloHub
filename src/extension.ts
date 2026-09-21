import * as vscode from 'vscode';

import {
  executeFolderAction,
  registerKiloHubCommands,
} from './commands.js';
import type { WorkspaceDescriptor } from './currentFolder.js';
import { sanitizeDiagnostic } from './diagnostics.js';
import {
  KILO_HUB_VIEW_ID,
  KiloHubWebviewProvider,
} from './kiloHubWebviewProvider.js';
import { HubIndexService } from './hubIndexService.js';
import type { HubIndexSnapshot } from './hubIndexProtocol.js';
import { isAvailableLocalDirectory } from './windowsPathSafety.js';

const OUTPUT_NAME = 'Kilo Hub';
let activeIndex: HubIndexService | undefined;

export async function deactivate(): Promise<void> {
  await activeIndex?.stop();
  activeIndex = undefined;
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

export function activate(context: vscode.ExtensionContext): { getIndexSnapshot(): HubIndexSnapshot } {
  const output = vscode.window.createOutputChannel(OUTPUT_NAME);
  const index = new HubIndexService(context.globalStorageUri.fsPath, installedKiloVersion(),
    (code) => output.appendLine(`[index] ${code}`), context.extensionMode === vscode.ExtensionMode.Test);
  activeIndex = index;

  const provider = new KiloHubWebviewProvider({
    extensionUri: context.extensionUri,
    output,
    index,
    loadFolders: () => Promise.resolve(index.snapshot.folders),
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
      output.appendLine(`[workspace] ${sanitizeDiagnostic(error)}`);
    });
  });

  context.subscriptions.push(
    output,
    index,
    provider,
    viewRegistration,
    workspaceSubscription,
    ...commandSubscriptions,
  );
  index.start();
  return { getIndexSnapshot: () => index.snapshot };
}
