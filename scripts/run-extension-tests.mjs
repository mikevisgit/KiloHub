import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTests } from '@vscode/test-electron';

import { prepareIsolatedTestHost } from './isolated-test-host.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] ?? '1.105.1';
const expectedRuntime = version === '1.105.1'
  ? { node: '22.19.0', electron: '37.6.0' }
  : undefined;

try {
  delete process.env.ELECTRON_RUN_AS_NODE;
const testHost = await prepareIsolatedTestHost(version);
try {
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
      ...(expectedRuntime === undefined ? {} : {
        KILO_HUB_EXPECTED_NODE: expectedRuntime.node,
        KILO_HUB_EXPECTED_ELECTRON: expectedRuntime.electron,
      }),
    },
    reuseMachineInstall: false,
  });
} finally {
  await testHost.restore();
}
} catch (error) {
  console.error('Extension Host tests failed.', error);
  process.exitCode = 1;
}
