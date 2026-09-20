import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const artifact = `dist/${manifest.name}-${manifest.version}-win32-x64.vsix`;
const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
  encoding: 'utf8',
});
if (status.status !== 0) {
  throw new Error(status.stderr || 'Could not inspect the Git working tree.');
}
const allowedArtifact = `?? ${artifact.replaceAll('\\', '/')}`;
const unexpectedChanges = status.stdout
  .split(/\r?\n/)
  .filter((line) => line !== '' && line !== allowedArtifact);
if (unexpectedChanges.length > 0) {
  throw new Error(`Release packaging requires a clean Git tree:\n${unexpectedChanges.join('\n')}`);
}
const timestamp = spawnSync('git', ['log', '-1', '--pretty=%ct'], {
  encoding: 'utf8',
});

if (timestamp.status !== 0) {
  throw new Error(timestamp.stderr || 'Could not resolve the latest commit timestamp.');
}

await rm(artifact, { force: true });

const executable = process.execPath;
const result = spawnSync(
  executable,
  [
    'node_modules/@vscode/vsce/vsce',
    'package',
    '--target',
    'win32-x64',
    '--no-dependencies',
    '--allow-missing-repository',
    '--out',
    artifact,
  ],
  {
    env: {
      ...process.env,
      SOURCE_DATE_EPOCH: timestamp.stdout.trim(),
    },
    stdio: 'inherit',
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
