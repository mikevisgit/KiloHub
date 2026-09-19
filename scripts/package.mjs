import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const artifact = 'dist/kilo-hub-0.1.0-win32-x64.vsix';
const timestamp = spawnSync('git', ['log', '-1', '--pretty=%ct'], {
  encoding: 'utf8',
});

if (timestamp.status !== 0) {
  throw new Error(timestamp.stderr || 'Не удалось определить время последнего коммита.');
}

await rm(artifact, { force: true });

const executable = process.platform === 'win32' ? 'vsce.cmd' : 'vsce';
const result = spawnSync(
  executable,
  [
    'package',
    '--target',
    'win32-x64',
    '--no-dependencies',
    '--out',
    artifact,
  ],
  {
    env: {
      ...process.env,
      SOURCE_DATE_EPOCH: timestamp.stdout.trim(),
    },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
