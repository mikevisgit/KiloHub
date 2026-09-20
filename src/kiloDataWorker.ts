import { parentPort, workerData } from 'node:worker_threads';

import {
  readKiloSessionsInCurrentThread,
  type KiloDataWorkerResponse,
  type ReadKiloSessionsOptions,
} from './kiloDataSource.js';

const port = parentPort;
if (port === null) {
  throw new Error('SQLite worker requires a parent port.');
}

try {
  const result = readKiloSessionsInCurrentThread(workerData as ReadKiloSessionsOptions);
  port.postMessage({ result } satisfies KiloDataWorkerResponse);
} catch (error) {
  const normalized = error instanceof Error
    ? error
    : new Error(String(error));
  port.postMessage({
    error: {
      message: normalized.message,
      ...(normalized.stack === undefined ? {} : { stack: normalized.stack }),
    },
  } satisfies KiloDataWorkerResponse);
}
port.close();
