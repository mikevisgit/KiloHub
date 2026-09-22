import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTests, runVSCodeCommand } from '@vscode/test-electron';

import { prepareIsolatedTestHost } from './isolated-test-host.mjs';
import { withRestrictedToolPath } from './restricted-test-env.mjs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const version = process.argv[2] ?? '1.105.1';
const artifact = path.join(
  repositoryRoot,
  'dist',
  `${manifest.name}-${manifest.version}-win32-x64.vsix`,
);
const smokeRoot = path.join(
  repositoryRoot,
  'build',
  'installed-smoke',
  version.replaceAll(/[^a-zA-Z0-9._-]/g, '_'),
);
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

// Startup must never resolve the personal source before the test creates its fixture.
const runtimeEnvironment = {
  ...process.env,
  KILO_DB: path.join(smokeRoot, 'synthetic-source-not-created.sqlite'),
  KILO_HUB_SYNTHETIC_TEST: '1',
  KILO_HUB_TEST_FIXTURE_ROOT: smokeRoot,
  KILO_HUB_NO_EXTERNAL_TOOLS: '1',
  NODE_TLS_REJECT_UNAUTHORIZED: '1',
};
for (const key of Object.keys(runtimeEnvironment)) {
  if (key.toLowerCase() === 'path') delete runtimeEnvironment[key];
}
runtimeEnvironment.Path = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;

const testHost = await prepareIsolatedTestHost(version);
try {
  await runVSCodeCommand([
    ...profileArguments,
    '--install-extension',
    artifact,
    '--force',
  ], {
    version,
  });

  const installed = await runVSCodeCommand([
    ...profileArguments,
    '--list-extensions',
    '--show-versions',
  ], {
    version,
  });
  const expectedExtension = `${manifest.publisher}.${manifest.name}@${manifest.version}`;
  if (!installed.stdout.split(/\r?\n/).includes(expectedExtension)) {
    throw new Error(`Installed extension was not listed: ${expectedExtension}`);
  }

  await withRestrictedToolPath(() => runTests({
    vscodeExecutablePath: testHost.vscodeExecutablePath,
    extensionDevelopmentPath: path.join(repositoryRoot, 'tests', 'fixtures', 'harness-extension'),
    extensionTestsPath: path.join(repositoryRoot, 'build-tests', 'tests', 'integration', 'index.js'),
    launchArgs: [
      path.join(repositoryRoot, 'tests', 'fixtures', 'workspace'),
      ...profileArguments,
    ],
    extensionTestsEnv: {
      ...runtimeEnvironment,
      ...(version === '1.105.1' ? {
        KILO_HUB_EXPECTED_NODE: '22.19.0',
        KILO_HUB_EXPECTED_ELECTRON: '37.6.0',
      } : {}),
    },
    reuseMachineInstall: false,
  }));
} finally {
  try { await testHost.restore(); }
  finally {
    for (const suffix of ['', '-wal', '-shm']) {
      await rm(`${runtimeEnvironment.KILO_DB}${suffix}`, { force: true, maxRetries: 10, retryDelay: 200 });
    }
    await rm(path.join(smokeRoot, 'hub'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
