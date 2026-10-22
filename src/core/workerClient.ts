/**
 * Popup ↔ worker facade. One conversion at a time on the UI side, but the client
 * supports multiple pending requests. `cancelAll` terminates the worker: the
 * only reliable way to interrupt a synchronous WASM encode.
 */
import { ConversionError } from './errors';
import type { ConversionOptions, ConversionStage } from './converter';
import type { WorkerRequest, WorkerResponse, WorkerResultPayload } from './worker';

export interface ConvertPayload {
  bytes: Uint8Array;
  fileName: string;
  mime?: string;
}

interface Pending {
  resolve: (result: WorkerResultPayload) => void;
  reject: (error: unknown) => void;
  onProgress?: (stage: ConversionStage, ratio: number) => void;
  cleanupAbort?: () => void;
}

export class ConversionWorker {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(chrome.runtime.getURL('worker.js'), { type: 'module' });

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (!message || typeof message.id !== 'number') return;
      if (message.type === 'progress') {
        this.pending.get(message.id)?.onProgress?.(message.stage, message.ratio);
        return;
      }

      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.cleanupAbort?.();

      if (message.type === 'done') {
        pending.resolve(message.result);
      } else {
        const { code, params, message: detail } = message.error;
        pending.reject(new ConversionError(code, params, detail));
      }
    });

    worker.addEventListener('error', (event) => {
      this.failAll(new ConversionError('unknown', undefined, event.message));
    });

    this.worker = worker;
    return worker;
  }

  convert(
    payload: ConvertPayload,
    options: ConversionOptions,
    onProgress?: (stage: ConversionStage, ratio: number) => void,
    signal?: AbortSignal,
  ): Promise<WorkerResultPayload> {
    return new Promise<WorkerResultPayload>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ConversionError('cancelled'));
        return;
      }

      const id = this.nextId++;
      const pending: Pending = { resolve, reject, onProgress };

      if (signal) {
        const onAbort = (): void => {
          if (!this.pending.has(id)) return;
          this.cancelAll();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        pending.cleanupAbort = () => signal.removeEventListener('abort', onAbort);
      }

      this.pending.set(id, pending);

      const request: WorkerRequest = {
        type: 'convert',
        id,
        // Intentional copy: the UI must be able to restart a conversion/preview.
        bytes: payload.bytes.slice().buffer,
        fileName: payload.fileName,
        mime: payload.mime,
        options,
      };

      try {
        this.ensureWorker().postMessage(request);
      } catch (error) {
        this.pending.delete(id);
        pending.cleanupAbort?.();
        reject(error);
      }
    });
  }

  /** Interrupts everything and rejects in-flight requests. */
  cancelAll(): void {
    for (const pending of this.pending.values()) {
      pending.cleanupAbort?.();
      pending.reject(new ConversionError('cancelled'));
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  /** Fatal worker error: reject and restart cleanly. */
  private failAll(error: unknown): void {
    for (const pending of this.pending.values()) {
      pending.cleanupAbort?.();
      pending.reject(error);
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  dispose(): void {
    this.cancelAll();
  }
}
