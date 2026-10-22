/**
 * Dedicated Web Worker: one job at a time (the client serializes
 * conversions). No DOM access; everything goes through OffscreenCanvas + WASM.
 */
import {
  convertImage,
  type ConversionOptions,
  type ConversionStage,
} from './converter';
import { serializeError, type SerializedError } from './errors';
import type { InputFormat, Warning } from './formats';

export interface WorkerConvertRequest {
  type: 'convert';
  id: number;
  bytes: ArrayBuffer;
  fileName: string;
  mime?: string;
  options: ConversionOptions;
}

export type WorkerRequest = WorkerConvertRequest;

export interface WorkerResultPayload {
  bytes: ArrayBuffer;
  fileName: string;
  mime: string;
  ext: string;
  width: number;
  height: number;
  sourceFormat: InputFormat;
  warnings: Warning[];
}

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: ConversionStage; ratio: number }
  | { type: 'done'; id: number; result: WorkerResultPayload }
  | { type: 'error'; id: number; error: SerializedError };

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ): void;
}

const scope = self as unknown as WorkerScope;

async function handle(request: WorkerConvertRequest): Promise<void> {
  const { id } = request;
  try {
    const result = await convertImage(
      {
        bytes: new Uint8Array(request.bytes),
        fileName: request.fileName,
        mime: request.mime,
      },
      request.options,
      (stage: ConversionStage, ratio: number) => {
        scope.postMessage({ type: 'progress', id, stage, ratio });
      },
    );

    const payload: WorkerResultPayload = {
      bytes: result.bytes.buffer as ArrayBuffer,
      fileName: result.fileName,
      mime: result.mime,
      ext: result.ext,
      width: result.width,
      height: result.height,
      sourceFormat: result.sourceFormat,
      warnings: result.warnings,
    };
    scope.postMessage({ type: 'done', id, result: payload }, [payload.bytes]);
  } catch (error) {
    scope.postMessage({ type: 'error', id, error: serializeError(error) });
  }
}

// Serializes requests: one decode/encode (and one WASM) at a time.
let queue: Promise<void> = Promise.resolve();
scope.addEventListener('message', (event) => {
  const request = event.data;
  if (!request || request.type !== 'convert') return;
  queue = queue.then(() => handle(request)).catch(() => {});
});
