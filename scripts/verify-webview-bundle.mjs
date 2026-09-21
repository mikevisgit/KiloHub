import { readFile } from 'node:fs/promises';

const source = await readFile('build/webview/webview.js', 'utf8');
const forbidden = [
  ['CommonJS require', /\brequire\s*\(/u],
  ['Node built-in import', /\bnode:/u],
  ['fetch', /\bfetch\s*\(/u],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/u],
  ['WebSocket', /\bWebSocket\b/u],
  ['EventSource', /\bEventSource\b/u],
  ['eval', /\beval\s*\(/u],
  ['source map marker', /sourceMappingURL/u],
];

for (const [label, pattern] of forbidden) {
  if (pattern.test(source)) throw new Error(`Forbidden browser bundle primitive: ${label}`);
}

for (const required of ['acquireVsCodeApi', 'kilo-hub-theme-style', 'folderAction']) {
  if (!source.includes(required)) throw new Error(`Required browser bundle marker is missing: ${required}`);
}

console.log(`PASS webview bundle scan (${source.length} bytes)`);
