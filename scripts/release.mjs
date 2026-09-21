import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required; run through npm run release.');
const environment = {
  ...process.env,
  NODE_TLS_REJECT_UNAUTHORIZED: '1',
};

const commands = [
  ['ci'],
  ['audit', '--audit-level=high'],
  ['test'],
  ['run', 'test:integration:current'],
  ['run', 'package:repro'],
  ['run', 'test:verify-vsix-negative'],
  ['run', 'test:installed:min'],
  ['run', 'test:installed:current'],
];

for (const arguments_ of commands) {
  console.log(`\n> npm ${arguments_.join(' ')}`);
  const result = spawnSync(process.execPath, [npmCli, ...arguments_], {
    env: environment,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
