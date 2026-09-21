import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const stylesPath = resolve(process.cwd(), 'src/webview/styles.css');

function customProperty(css: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`, 'u').exec(css);
  assert.ok(match, `${name} must exist in production styles.css`);
  return match[1].trim();
}

function multiplier(css: string, name: string): number {
  const value = customProperty(css, name);
  const match = /calc\(var\(--hub-base\) \* ([0-9.]+)\)/u.exec(value);
  assert.ok(match, `${name} must remain proportional to --hub-base`);
  return Number(match[1]);
}

void test('production scale variables preserve the B=13/16/20 size contract', async () => {
  const css = await readFile(stylesPath, 'utf8');
  assert.equal(customProperty(css, '--hub-base'), 'var(--vscode-font-size, 13px)');
  const variables = [
    ['--hub-secondary', 12 / 13],
    ['--hub-name-size', 16 / 13],
    ['--hub-mono-size', 36 / 13],
    ['--hub-row-y', 11 / 13],
    ['--hub-row-x', 12 / 13],
    ['--hub-gap', 10 / 13],
  ] as const;
  for (const [name, expected] of variables) {
    const actual = multiplier(css, name);
    for (const base of [13, 16, 20]) {
      assert.ok(Math.abs(actual * base - expected * base) < 0.000001, `${name} at B=${base}`);
    }
  }
});

void test('production CSS keeps 260/320/400 layouts horizontally bounded', async () => {
  const css = await readFile(stylesPath, 'utf8');
  assert.match(css, /html,\s*body,\s*#app\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*min-width:\s*0;/su);
  assert.match(css, /body\s*\{[^}]*padding:\s*0\s*!important;/su);
  assert.match(css, /\.hub\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*min-width:\s*0;/su);
  assert.match(css, /\.folders\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*min-width:\s*0;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*overflow-x:\s*hidden;/su);
  assert.match(css, /\.folder\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*min-width:\s*0;/su);
  assert.match(css, /\.folder-head\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/su);
  assert.match(css, /\.identity\s*\{[^}]*min-width:\s*0;/su);
  assert.match(css, /\.detail\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/su);
  assert.match(css, /\.actions\s*\{[^}]*width:\s*100%;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/su);
  assert.match(css, /\.action\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/su);
  assert.match(css, /\.folder-name\s*\{[^}]*overflow-wrap:\s*anywhere;/su);
  assert.match(css, /\.conversation\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/su);
  assert.doesNotMatch(css, /@media\s*\([^)]*(?:width|zoom)[^)]*\)[^{]*\{[^}]*font-size/isu);

  const rowX = multiplier(css, '--hub-row-x');
  const gap = multiplier(css, '--hub-gap');
  const monogram = multiplier(css, '--hub-mono-size');
  for (const width of [260, 320, 400]) {
    for (const base of [13, 16, 20]) {
      const identityWidth = width - 2 - 2 * rowX * base - monogram * base - 2 * gap * base - base;
      assert.ok(identityWidth > 0, `text column remains available at ${width}px/B=${base}`);
    }
  }
});

void test('focus, forced-colors, reduced-motion and panel edge contracts are present', async () => {
  const css = await readFile(stylesPath, 'utf8');
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/su);
  assert.doesNotMatch(css, /\.hub\s*\{[^}]*border:/su);
  assert.match(css, /\.folder\s*\{[^}]*border:\s*1px solid var\(--hub-card-border\);/su);
  assert.match(css, /\.tooltip\s*\{[^}]*pointer-events:\s*none;/su);
  assert.match(css, /\.folder-name\s*\{[^}]*display:\s*inline;/su);
  assert.doesNotMatch(css, /\.folder\s*\{[^}]*overflow:\s*(?:clip|hidden)/su);
  assert.match(css, /\.folder-head:focus-visible[\s\S]*outline-offset:\s*-3px;/u);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)[\s\S]*CanvasText[\s\S]*Highlight/u);
  assert.match(css, /body\.vscode-reduce-motion \.chevron\s*\{[^}]*transition-duration:\s*0ms;/su);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*transition-duration:\s*0ms;/u);
});
