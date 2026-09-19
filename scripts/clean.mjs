import { rm } from 'node:fs/promises';

await Promise.all([
  rm('build', { force: true, recursive: true }),
  rm('build-tests', { force: true, recursive: true }),
]);
