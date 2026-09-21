import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { downloadAndUnzipVSCode } from '@vscode/test-electron';

export async function prepareIsolatedTestHost(version) {
  const vscodeExecutablePath = await downloadAndUnzipVSCode(version);
  const installRoot = path.dirname(vscodeExecutablePath);
  const directProductPath = path.join(installRoot, 'resources', 'app', 'product.json');
  let productPath = directProductPath;
  try {
    await access(productPath);
  } catch {
    const candidates = [];
    for (const entry of await readdir(installRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(installRoot, entry.name, 'resources', 'app', 'product.json');
      try {
        await access(candidate);
        candidates.push(candidate);
      } catch {
        // Non-version directories are expected in updater-style archives.
      }
    }
    if (candidates.length !== 1) {
      throw new Error(`Expected one VS Code product.json, found ${candidates.length}.`);
    }
    [productPath] = candidates;
  }
  const original = await readFile(productPath, 'utf8');
  const product = JSON.parse(original);
  const suffix = version.replaceAll(/[^a-zA-Z0-9]/g, '-');
  product.applicationName = `kilo-hub-test-${suffix}`;
  product.dataFolderName = `.kilo-hub-test-${suffix}`;
  product.win32MutexName = `kilo-hub-test-${suffix}`;
  product.win32AppUserModelId = `local.KiloHub.Test.${suffix}`;
  await writeFile(productPath, JSON.stringify(product));

  let restored = false;
  return {
    vscodeExecutablePath,
    async restore() {
      if (restored) return;
      restored = true;
      await writeFile(productPath, original);
    },
  };
}
