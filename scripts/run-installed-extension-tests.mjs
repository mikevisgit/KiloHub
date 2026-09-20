import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTests, runVSCodeCommand } from '@vscode/test-electron';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const artifact = path.join(
  repositoryRoot,
  'dist',
  `${manifest.name}-${manifest.version}-win32-x64.vsix`,
);
const smokeRoot = path.join(repositoryRoot, 'build', 'installed-smoke');
const userDataDirectory = path.join(smokeRoot, 'user-data');
const extensionsDirectory = path.join(smokeRoot, 'extensions');
const profileArguments = [
  `--user-data-dir=${userDataDirectory}`,
  `--extensions-dir=${extensionsDirectory}`,
];

const verification = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(repositoryRoot, 'scripts', 'verify-vsix.ps1'),
  ],
  { stdio: 'inherit' },
);
if (verification.status !== 0) {
  throw new Error('Installed smoke requires a VSIX that passes exact verification.');
}

await rm(smokeRoot, { force: true, recursive: true });
delete process.env.ELECTRON_RUN_AS_NODE;

await runVSCodeCommand([
  ...profileArguments,
  '--install-extension',
  artifact,
  '--force',
], {
  version: '1.105.1',
});

const installed = await runVSCodeCommand([
  ...profileArguments,
  '--list-extensions',
  '--show-versions',
], {
  version: '1.105.1',
});
const expectedExtension = `${manifest.publisher}.${manifest.name}@${manifest.version}`;
if (!installed.stdout.split(/\r?\n/).includes(expectedExtension)) {
  throw new Error(`Installed extension was not listed: ${expectedExtension}`);
}

await runTests({
  version: '1.105.1',
  extensionDevelopmentPath: path.join(repositoryRoot, 'tests', 'fixtures', 'harness-extension'),
  extensionTestsPath: path.join(repositoryRoot, 'build-tests', 'tests', 'integration', 'index.js'),
  launchArgs: [
    path.join(repositoryRoot, 'tests', 'fixtures', 'workspace'),
    ...profileArguments,
  ],
  reuseMachineInstall: false,
});
