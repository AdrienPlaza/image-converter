/**
 * Stable error codes, translated in the UI via i18n (`errors.<code>`).
 * The worker serializes only `{ code, params, message }`: never a raw
 * Error object (not reliably cloneable).
 */
export type ErrorCode =
  | 'empty-file'
  | 'unsupported-input'
  | 'heic-unsupported'
  | 'decode-failed'
  | 'tiff-decode-failed'
  | 'svg-no-size'
  | 'encode-failed'
  | 'encode-unsupported'
  | 'image-too-large'
  | 'animation-too-long'
  | 'invalid-options'
  | 'cancelled'
  | 'clipboard-denied'
  | 'clipboard-unsupported'
  | 'download-failed'
  | 'fetch-failed'
  | 'unknown';

export class ConversionError extends Error {
  readonly code: ErrorCode;
  readonly params?: Record<string, string | number>;

  constructor(code: ErrorCode, params?: Record<string, string | number>, message?: string) {
    super(message ?? code);
    this.name = 'ConversionError';
    this.code = code;
    this.params = params;
  }
}

/** Normalizes any exception into a ConversionError. */
export function toConversionError(error: unknown): ConversionError {
  if (error instanceof ConversionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ConversionError('unknown', undefined, message);
}

export interface SerializedError {
  code: ErrorCode;
  params?: Record<string, string | number>;
  message: string;
}

export function serializeError(error: unknown): SerializedError {
  const normalized = toConversionError(error);
  return { code: normalized.code, params: normalized.params, message: normalized.message };
}
