import { parentPort, workerData } from 'node:worker_threads';
import { HubIndexEngine } from './hubIndexEngine.js';
import type { HubIndexOptions } from './hubIndexProtocol.js';

const port = parentPort;
if (!port) throw new Error('Hub worker requires a parent port');
const engine = new HubIndexEngine(workerData as HubIndexOptions);
let stopped = false;
let running = false;
let failures = 0;
let timer: NodeJS.Timeout | undefined;

async function cycle(): Promise<void> {
  if (stopped || running) return;
  if (timer) clearTimeout(timer);
  running = true;
  try {
    const snapshot = await engine.tick();
    if (!stopped) port?.postMessage(snapshot);
    failures = snapshot.diagnostic ? Math.min(failures + 1, 6) : 0;
  } finally {
    running = false;
    if (!stopped) timer = setTimeout(() => { void cycle(); }, engine.hasPendingWork ? 0
      : Math.min(300_000, 10_000 * 2 ** Math.max(0, failures - 1)));
  }
}

port.on('message', (message: unknown) => {
  if (message === 'stop') {
    stopped = true;
    if (timer) clearTimeout(timer);
    void engine.close().finally(() => port.close());
  } else if (message === 'poll') {
    // Compatibility trigger does not bypass resource-error backoff or queue work.
    if (failures === 0) void cycle();
  }
});
void cycle();
