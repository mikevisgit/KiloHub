import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import console from 'node:console';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const { readZip } = require('@vscode/vsce/out/zip.js');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const version = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).version;
const root = await mkdtemp(path.join(os.tmpdir(), 'hub-readme-verifier-'));
const options = { cwd: root, timeout: 120000, env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1' } };

try {
  for (const directory of ['scripts', 'build/webview', 'resources', 'docs', 'dist']) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  for (const file of [
    'scripts/verify-vsix.ps1', 'scripts/test-vsix-verifier.ps1',
    'resources/kilo-hub.png', 'resources/hub.svg', 'docs/extension-description.md',
  ]) {
    await copyFile(path.join(project, file), path.join(root, file));
  }
  for (const file of ['extension.js', 'kiloDataWorker.js', 'hubIndexWorker.js', 'webview/webview.js', 'webview/webview.css']) {
    await writeFile(path.join(root, 'build', file), '/* Synthetic packaging fixture only. */\n');
  }
  await writeFile(path.join(root, 'LICENSE.txt'), 'Synthetic packaging fixture license.\n');
  await writeFile(path.join(root, 'docs/release-notes.md'), '# Synthetic packaging fixture\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'synthetic-readme-verifier',
    publisher: 'synthetic-discovery',
    version,
    description: 'Synthetic packaging fixture only',
    engines: { vscode: '^1.105.1', node: '>=22.19.0 <25' },
    main: './build/extension.js',
    icon: 'resources/kilo-hub.png',
    extensionKind: ['ui'],
    activationEvents: ['onStartupFinished', 'onCommand:kiloHub.refresh', 'onView:kiloHub.folders'],
    contributes: {
      commands: ['openHere', 'openInFileExplorer', 'openNewWindow', 'refresh'].map((name) => ({
        command: `kiloHub.${name}`, title: name,
      })),
      viewsContainers: {
        activitybar: [{ id: 'kiloHub', title: 'Kilo Hub', icon: 'resources/hub.svg' }],
      },
      views: { kiloHub: [{ id: 'kiloHub.folders', name: 'Kilo Hub', type: 'webview' }] },
    },
    files: ['build/**', 'resources/**', 'docs/extension-description.md', 'docs/release-notes.md', 'LICENSE.txt'],
  }));

  const artifact = path.join(root, `dist/synthetic-readme-verifier-${version}-win32-x64.vsix`);
  await execute(process.execPath, [path.join(project, 'node_modules/@vscode/vsce/vsce'),
    'package', '--no-dependencies', '--allow-missing-repository',
    '--readme-path', 'docs/extension-description.md', '--target', 'win32-x64', '--out', artifact], options);
  const entries = await readZip(artifact, () => true);
  assert.equal(entries.size, 13, 'Synthetic baseline must contain exactly 13 entries');

  // A valid baseline must pass before nonzero exits can prove rejection of mutations.
  const positive = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'scripts/verify-vsix.ps1'), '-ArtifactPath', artifact], options);
  assert.match(positive.stdout, /SHA-256: [A-F0-9]{64}/u);
  console.log('PASS synthetic positive: actual verifier accepted 13 exact entries, Details asset and hashes');

  const negative = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'scripts/test-vsix-verifier.ps1')], options);
  const results = negative.stdout.split(/\r?\n/u).filter((line) => line.startsWith('PASS rejected: '));
  assert.deepEqual(results, [
    'extra entry', 'missing browser bundle', 'stale browser bundle', 'wrong Node engine',
    'missing Details README', 'stale Details README', 'wrong Details asset path',
  ].map((label) => `PASS rejected: ${label}`));
  console.log(results.join('\n'));
  console.log('PASS synthetic packaging verification only: 1 positive + 7 negatives; not a production smoke test');
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
