import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { resolveKiloDatabasePath } from './kiloDataSource.js';
import { HUB_DIAGNOSTICS, HUB_SEARCH_ERRORS, isHubIndexSnapshot, type HubDiagnostic, type HubIndexOptions, type HubIndexSnapshot, type HubSearchResult } from './hubIndexProtocol.js';
import { parseSearchQuery } from './searchQuery.js';

/** The only host transport is bounded folder metadata, never the indexed text corpus. */
export class HubIndexService {
  private worker: Worker | undefined;
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;
  private requestId = 0;
  private pending: { id: number; queryGeneration: number; generation: string; revision: number;
    resolve: (result: HubSearchResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | undefined;
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
      worker.on('message', (message: unknown) => {
        if (this.worker !== worker || this.disposed) return;
        if (!isHubIndexSnapshot(message)) { this.searchMessage(message); return; }
        const snapshot = message;
        if (this.pending && (this.pending.generation !== snapshot.generation || this.pending.revision !== snapshot.indexRevision)) {
          this.rejectSearch('index-changed');
        }
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
    this.rejectSearch('search-unavailable');
    this.snapshot = { ...this.snapshot, complete: false,
      health: this.snapshot.generation ? 'stale' : 'unavailable', diagnostic: 'worker-unavailable' };
    this.diagnostic?.('worker-unavailable');
    for (const listener of this.listeners) listener(this.snapshot);
    if (!this.disposed) this.timer = setTimeout(() => this.start(), 10_000);
  }

  public poll(): void { if (this.worker) this.worker.postMessage('poll'); else this.start(); }

  public search(query: string, queryGeneration: number): Promise<HubSearchResult> {
    const parsed = parseSearchQuery(query);
    if (parsed.kind === 'invalid' || !Number.isSafeInteger(queryGeneration) || queryGeneration < 0) {
      return Promise.reject(new Error('invalid-query'));
    }
    this.rejectSearch('search-cancelled');
    if (!this.disposed && parsed.kind === 'reset') return Promise.resolve({ generation: this.snapshot.generation,
      indexRevision: this.snapshot.indexRevision, queryGeneration,
      matches: this.snapshot.folders.map((folder) => ({ folderId: folder.id, rank: 0 })) });
    if (this.disposed || !this.worker) return Promise.reject(new Error('search-unavailable'));
    const worker = this.worker;
    const id = ++this.requestId;
    return new Promise<HubSearchResult>((resolve, reject) => {
      const timer = setTimeout(() => this.rejectSearch('search-unavailable'), 30_000);
      this.pending = { id, queryGeneration, generation: this.snapshot.generation,
        revision: this.snapshot.indexRevision, resolve, reject, timer };
      try { worker.postMessage({ type: 'search', requestId: id, query, queryGeneration }); }
      catch { this.rejectSearch('search-unavailable'); }
    });
  }

  private rejectSearch(code: typeof HUB_SEARCH_ERRORS[number]): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    try { this.worker?.postMessage({ type: 'cancel' }); } catch { /* The worker may already have exited. */ }
    pending.reject(new Error(code));
  }

  private searchMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) return;
    const row = message as Record<string, unknown>;
    const pending = this.pending;
    if (!pending || row.requestId !== pending.id) return;
    if (row.type === 'search-error') {
      this.rejectSearch(HUB_SEARCH_ERRORS.includes(row.code as typeof HUB_SEARCH_ERRORS[number])
        ? row.code as typeof HUB_SEARCH_ERRORS[number] : 'search-unavailable');
      return;
    }
    if (row.type !== 'search-result' || typeof row.result !== 'object' || row.result === null) return;
    const result = row.result as Record<string, unknown>;
    if (result.generation !== pending.generation || result.indexRevision !== pending.revision
      || result.queryGeneration !== pending.queryGeneration) { this.rejectSearch('index-changed'); return; }
    const supported = new Set(this.snapshot.folders.map((folder) => folder.id));
    if (!Array.isArray(result.matches) || result.matches.length > supported.size) {
      this.rejectSearch('search-unavailable'); return;
    }
    const matches: { folderId: string; rank: 0 | 1 | 2 }[] = [];
    for (const value of result.matches as unknown[]) {
      if (typeof value !== 'object' || value === null) { this.rejectSearch('search-unavailable'); return; }
      const match = value as Record<string, unknown>;
      if (typeof match.folderId !== 'string' || !supported.delete(match.folderId)
        || (match.rank !== 0 && match.rank !== 1 && match.rank !== 2)) { this.rejectSearch('search-unavailable'); return; }
      matches.push({ folderId: match.folderId, rank: match.rank });
    }
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.resolve({ generation: pending.generation, indexRevision: pending.revision,
      queryGeneration: pending.queryGeneration, matches });
  }

  public async stop(): Promise<void> {
    this.disposed = true;
    this.rejectSearch('search-cancelled');
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
