import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const artifact = `dist/${manifest.name}-${manifest.version}-win32-x64.vsix`;
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required; run through npm run package:repro.');

function packageOnce() {
  const result = spawnSync(process.execPath, [npmCli, 'run', 'package'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function sha256() {
  return createHash('sha256').update(await readFile(artifact)).digest('hex').toUpperCase();
}

packageOnce();
const first = await sha256();
packageOnce();
const second = await sha256();
console.log(`First=${first}`);
console.log(`Second=${second}`);
if (first !== second) throw new Error('VSIX builds are not reproducible.');
