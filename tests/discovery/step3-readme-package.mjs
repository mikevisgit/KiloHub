import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readZip } = require('@vscode/vsce/out/zip.js');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = await mkdtemp(path.join(os.tmpdir(), 'hub-readme-package-'));
try {
  await mkdir(path.join(root, 'docs'));
  const description = await readFile(path.join(project, 'docs/extension-description.md'));
  await writeFile(path.join(root, 'docs/description.md'), description);
  await writeFile(path.join(root, 'extension.js'), 'exports.activate = () => {};\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'synthetic-readme-probe', publisher: 'synthetic-discovery', version: '0.0.1',
    engines: { vscode: '^1.105.1' }, main: './extension.js', activationEvents: ['onStartupFinished'],
    files: ['extension.js', 'docs/description.md'],
  }));
  const artifact = path.join(root, 'probe.vsix');
  await promisify(execFile)(process.execPath, [path.join(project, 'node_modules/@vscode/vsce/vsce'),
    'package', '--no-dependencies', '--skip-license', '--allow-missing-repository',
    '--readme-path', 'docs/description.md', '--target', 'win32-x64', '--out', artifact],
  { cwd: root, timeout: 120000, env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1' } });
  const entries = await readZip(artifact, () => true);
  assert.deepEqual(entries.get('extension/readme.md'), description);
  assert.equal(entries.has('extension/docs/description.md'), false);
  assert.match(entries.get('extension.vsixmanifest').toString('utf8'),
    /Type="Microsoft\.VisualStudio\.Services\.Content\.Details"[^>]*Path="extension\/readme\.md"/u);
  console.log('PASS synthetic VSIX: canonical README bytes, canonical archive path and Details asset');
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
