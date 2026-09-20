import { glob } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const files = [];
for await (const file of glob('build-tests/tests/unit/**/*.test.js')) {
  files.push(file);
}

if (files.length === 0) {
  throw new Error('No compiled unit tests were found.');
}

const result = spawnSync(process.execPath, ['--test', ...files.sort()], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
