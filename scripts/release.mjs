import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required; run through npm run release.');
const environment = {
  ...process.env,
  NODE_TLS_REJECT_UNAUTHORIZED: '1',
};
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const artifact = `dist/${manifest.name}-${manifest.version}-win32-x64.vsix`;

function runNpm(arguments_) {
  console.log(`\n> npm ${arguments_.join(' ')}`);
  const result = spawnSync(process.execPath, [npmCli, ...arguments_], {
    env: environment,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function artifactHash() {
  return createHash('sha256').update(await readFile(artifact)).digest('hex').toUpperCase();
}

const packageHashes = [];
for (let cycle = 1; cycle <= 2; cycle += 1) {
  console.log(`\n=== Clean release cycle ${cycle}/2 ===`);
  runNpm(['ci']);
  runNpm(['audit', '--audit-level=high']);
  runNpm(['run', 'clean']);
  runNpm(['test']);
  runNpm(['run', 'package']);
  packageHashes.push(await artifactHash());
}

console.log(`First=${packageHashes[0]}`);
console.log(`Second=${packageHashes[1]}`);
if (packageHashes[0] !== packageHashes[1]) {
  throw new Error('Independent clean release cycles produced different VSIX files.');
}

runNpm(['run', 'test:integration:current']);
runNpm(['run', 'test:verify-vsix-negative']);
runNpm(['run', 'test:installed:min']);
runNpm(['run', 'test:installed:current']);
