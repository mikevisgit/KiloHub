import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('build', { recursive: true });
await Promise.all([
  build({
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
  }),
  build({
    entryPoints: ['src/webview/main.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome138',
    outfile: 'build/webview.js',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'info',
  }),
  build({
    entryPoints: ['src/webview/styles.css'],
    bundle: true,
    outfile: 'build/webview.css',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'info',
  }),
]);
