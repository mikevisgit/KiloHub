import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeDiagnostic } from '../../src/diagnostics.js';

void test('redacts Windows, UNC and file URI paths from diagnostic stacks', () => {
  const error = new Error('failed C:\\Users\\Alice Smith\\project\\kilo.db');
  error.stack = `Error: failed C:\\Users\\Alice Smith\\project\\kilo.db\n`
    + ` at read (D:\\Programs\\Kilo Hub\\build\\extension.js:10:2)\n`
    + ` at file:///C:/Users/Alice%20Smith/project/file.js:2:1\n`
    + ` at \\\\server\\share\\folder\\file.db`;
  const sanitized = sanitizeDiagnostic(error);
  assert.doesNotMatch(sanitized, /Alice|Programs|server|kilo\.db|extension\.js/u);
  assert.match(sanitized, /<local-path>/u);
});

void test('bounds diagnostics and removes control characters without removing line breaks', () => {
  const sanitized = sanitizeDiagnostic(`problem\u0000value\n${'x'.repeat(5_000)}`);
  assert.equal(sanitized.includes('\u0000'), false);
  assert.equal(sanitized.includes('\n'), true);
  assert.equal(sanitized.length, 4_000);
});
