import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTests } from '@vscode/test-electron';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  delete process.env.ELECTRON_RUN_AS_NODE;
  await runTests({
    version: '1.105.1',
    extensionDevelopmentPath: repositoryRoot,
    extensionTestsPath: path.join(repositoryRoot, 'build-tests', 'tests', 'integration', 'index.js'),
    launchArgs: [
      path.join(repositoryRoot, 'tests', 'fixtures', 'workspace'),
      '--disable-extensions',
    ],
    reuseMachineInstall: false,
  });
} catch (error) {
  console.error('Extension Host tests failed.', error);
  process.exitCode = 1;
}
