import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { resolveKiloDatabasePath } from './kiloDataSource.js';
import { HUB_DIAGNOSTICS, type HubDiagnostic, type HubIndexOptions, type HubIndexSnapshot } from './hubIndexProtocol.js';

/** The only host transport is bounded folder metadata, never the indexed text corpus. */
export class HubIndexService {
  private worker: Worker | undefined;
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;
  private readonly listeners = new Set<(snapshot: HubIndexSnapshot) => void>();
  public snapshot: HubIndexSnapshot = { generation: '', indexRevision: 0, complete: false, health: 'preparing', folders: [] };

  public constructor(private readonly storagePath: string, private readonly kiloVersion?: string,
    private readonly diagnostic?: (code: HubDiagnostic) => void,
    private readonly testMode = false) {}

  public subscribe(listener: (snapshot: HubIndexSnapshot) => void): { dispose(): void } {
    this.listeners.add(listener);
    listener(this.snapshot);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  public start(): void {
    if (this.disposed || this.worker) return;
    try {
      // Test-host startup may precede its fixture setup. Never fall through to the real default source.
      if (this.testMode && (process.env.KILO_HUB_SYNTHETIC_TEST !== '1' || !process.env.KILO_DB)) {
        this.failed();
        return;
      }
      const options: HubIndexOptions = { storagePath: this.storagePath,
        sourcePath: resolveKiloDatabasePath(), kiloVersion: this.kiloVersion };
      const worker = new Worker(join(__dirname, 'hubIndexWorker.js'), { workerData: options });
      this.worker = worker;
      worker.on('message', (snapshot: HubIndexSnapshot) => {
        if (this.worker !== worker || this.disposed) return;
        this.snapshot = snapshot;
        if (snapshot.diagnostic && HUB_DIAGNOSTICS.includes(snapshot.diagnostic)) this.diagnostic?.(snapshot.diagnostic);
        for (const listener of this.listeners) listener(snapshot);
      });
      worker.on('error', () => { /* Never forward native errors, messages or stacks. Exit restarts the worker. */ });
      worker.once('exit', () => {
        if (this.worker !== worker || this.disposed) return;
        this.worker = undefined;
        this.failed();
      });
    } catch { this.failed(); }
  }

  private failed(): void {
    this.snapshot = { ...this.snapshot, complete: false,
      health: this.snapshot.generation ? 'stale' : 'unavailable', diagnostic: 'worker-unavailable' };
    this.diagnostic?.('worker-unavailable');
    for (const listener of this.listeners) listener(this.snapshot);
    if (!this.disposed) this.timer = setTimeout(() => this.start(), 10_000);
  }

  public poll(): void { if (this.worker) this.worker.postMessage('poll'); else this.start(); }

  public async stop(): Promise<void> {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
    const worker = this.worker;
    this.worker = undefined;
    if (worker) await new Promise<void>((resolveStop) => {
      const timeout = setTimeout(() => { void worker.terminate().then(() => resolveStop()); }, 10_000);
      worker.once('exit', () => { clearTimeout(timeout); resolveStop(); });
      worker.postMessage('stop');
    });
  }

  public dispose(): void { void this.stop(); }
}
