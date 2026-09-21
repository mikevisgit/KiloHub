import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { HubIndexEngine } from '../../src/hubIndexEngine.js';
import type { HubIndexOptions } from '../../src/hubIndexProtocol.js';
import type { HubPointer } from '../../src/hubStorage.js';

const options = workerData as HubIndexOptions;
const engine = new HubIndexEngine(options);
void engine.tick().then(() => {
  const pointer = JSON.parse(readFileSync(join(options.storagePath, 'hub-pointer.json'), 'utf8')) as HubPointer;
  if (!pointer.building) throw new Error('Synthetic crash requires incomplete generation');
  const db = new DatabaseSync(join(options.storagePath, `hub-${pointer.building}.sqlite`));
  db.exec("BEGIN IMMEDIATE; UPDATE progress SET cursor='uncommitted-crash'; DELETE FROM texts");
  parentPort?.postMessage('transaction-held');
  parentPort?.on('message', () => undefined);
});
