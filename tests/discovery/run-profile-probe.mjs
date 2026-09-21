import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import { prepareIsolatedTestHost } from '../../scripts/isolated-test-host.mjs';
import { withRestrictedToolPath } from '../../scripts/restricted-test-env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const version = process.argv[2];
const withoutNode = process.argv.includes('--without-node');
assert.ok(['1.105.1', '1.138.0'].includes(version));
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
if (process.argv.includes('--uppercase-path')) {
  const savedPath = process.env.PATH ?? '';
  for (const key of Object.keys(process.env)) if (key.toLowerCase() === 'path') delete process.env[key];
  process.env.PATH = savedPath;
}
const root = await mkdtemp(path.join(os.tmpdir(), 'hub-profile-discovery-'));
const probe = path.join(here, 'profile-probe');
let testHost;
const env = { ...process.env, HUB_PROBE_ROOT: root };
if (withoutNode) {
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.Path = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  env.HUB_PROBE_NO_NODE = '1';
}
delete env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_RUN_AS_NODE;
try {
  testHost = await prepareIsolatedTestHost(version);
  const results = [];
  for (const [data, profile] of [['a', 'Default'], ['a', 'Discovery A'], ['a', 'Discovery B'], ['b', 'Default']]) {
    const workspace = path.join(root, `workspace-${results.length}`);
    await mkdir(workspace);
    const launch = () => runTests({
      vscodeExecutablePath: testHost.vscodeExecutablePath,
      extensionDevelopmentPath: probe,
      extensionTestsPath: path.join(probe, 'host-test.cjs'),
      extensionTestsEnv: env,
      launchArgs: [workspace, '--user-data-dir', path.join(root, data),
        '--extensions-dir', path.join(root, 'extensions'), '--profile', profile,
        '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
      reuseMachineInstall: false,
    });
    await (withoutNode ? withRestrictedToolPath(launch) : launch());
    results.push({ data, profile, ...JSON.parse(await readFile(path.join(root, 'result.json'), 'utf8')) });
  }
  assert.equal(results[0].previous, null);
  for (const result of results.slice(1, 3)) {
    assert.equal(result.storage, results[0].storage);
    assert.equal(result.previous, 'synthetic-discovery-only');
  }
  assert.notEqual(results[3].storage, results[0].storage);
  assert.equal(results[3].previous, null);
  console.log(JSON.stringify({ version, withoutNodeOnPath: withoutNode,
    checks: 'PASS startup, profiles share storage, user-data roots isolated',
    results: results.map(({ storage, ...rest }) => ({ ...rest, storage: path.relative(root, storage) })),
    limits: 'sequential windows; no simultaneous writer or shutdown/crash proof' }, null, 2));
} finally {
  try { await testHost?.restore(); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
}
