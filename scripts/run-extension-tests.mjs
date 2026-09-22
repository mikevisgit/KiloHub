import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';

import { runTests } from '@vscode/test-electron';

import { prepareIsolatedTestHost } from './isolated-test-host.mjs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] ?? '1.105.1';
const expectedRuntime = version === '1.105.1'
  ? { node: '22.19.0', electron: '37.6.0' }
  : undefined;

try {
  delete process.env.ELECTRON_RUN_AS_NODE;
const testHost = await prepareIsolatedTestHost(version);
let fixtureRoot;
try {
  fixtureRoot = await mkdtemp(path.join(repositoryRoot, 'build', 'host-source-'));
  await runTests({
    vscodeExecutablePath: testHost.vscodeExecutablePath,
    extensionDevelopmentPath: repositoryRoot,
    extensionTestsPath: path.join(repositoryRoot, 'build-tests', 'tests', 'integration', 'index.js'),
    launchArgs: [
      path.join(repositoryRoot, 'tests', 'fixtures', 'workspace'),
      '--disable-extensions',
    ],
    extensionTestsEnv: {
      ...process.env,
      KILO_DB: path.join(fixtureRoot, 'synthetic-source-not-created.sqlite'),
      KILO_HUB_SYNTHETIC_TEST: '1',
      KILO_HUB_TEST_FIXTURE_ROOT: fixtureRoot,
      ...(expectedRuntime === undefined ? {} : {
        KILO_HUB_EXPECTED_NODE: expectedRuntime.node,
        KILO_HUB_EXPECTED_ELECTRON: expectedRuntime.electron,
      }),
    },
    reuseMachineInstall: false,
  });
} finally {
  try { await testHost.restore(); }
  finally { if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
}
} catch (error) {
  console.error('Extension Host tests failed.', error);
  process.exitCode = 1;
}
