import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('build', { recursive: true });
await build({
  entryPoints: ['src/extension.ts', 'src/kiloDataWorker.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outdir: 'build',
  external: ['vscode', 'node:sqlite'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});
