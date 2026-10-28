import { Worker } from 'node:worker_threads';
import type { Report } from 'ng-checkup';
import type { AnalyseResult, WorkerRequest, WorkerResponse } from './protocol.js';

/** `Omit` applied to each member of a union, so the request kinds stay distinct. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** A request without its id; the client numbers them. */
type Outgoing = WithoutId<WorkerRequest>;

/**
 * The extension's side of the analysis worker (see `worker.ts`): starts it on
 * the first request, matches replies to requests by id, and starts a fresh one
 * after a crash. A crash loses the analysis caches, which only makes the next
 * run a full one; every request still pending is rejected so no caller waits
 * forever.
 */
export class Analyser {
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  /** @param script Absolute path of the bundled `worker.js`. */
  constructor(private readonly script: string) {}

  /** Analyses one root; rejects with the user-facing message of a config error or a crash. */
  analyse(root: string, offline: boolean, maxExamples: number): Promise<AnalyseResult> {
    return this.request({ type: 'analyse', root, offline, maxExamples }) as Promise<AnalyseResult>;
  }

  /** ng-checkup's HTML report for a report this worker produced. */
  html(report: Report): Promise<string> {
    return this.request({ type: 'html', report }) as Promise<string>;
  }

  /** Drops the cache of one root, for a settings change that the cache's own stamps cannot see (the registry lookup). */
  reset(root: string): Promise<void> {
    return this.request({ type: 'reset', root }) as Promise<void>;
  }

  /** Stops the worker and rejects whatever is pending. */
  dispose(): void {
    const worker = this.worker;
    this.worker = undefined;
    this.failAll(new Error('ng-checkup was stopped'));
    void worker?.terminate();
  }

  /** Sends one request, starting the worker if there is none. */
  private request(message: Outgoing): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ensureWorker().postMessage({ ...message, id });
    });
  }

  /** The running worker, or a new one wired to settle replies and survive crashes. */
  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.script);
    worker.on('message', (response: WorkerResponse) => {
      const waiting = this.pending.get(response.id);
      if (!waiting) return;
      this.pending.delete(response.id);
      if (response.ok) waiting.resolve(response.value);
      else waiting.reject(new Error(response.message));
    });
    const lost = (error: Error): void => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      this.failAll(error);
    };
    worker.on('error', lost);
    worker.on('exit', (code) => lost(new Error(`The ng-checkup worker stopped (exit code ${code})`)));
    this.worker = worker;
    return worker;
  }

  /** Rejects every pending request with `error`. */
  private failAll(error: Error): void {
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }
}
