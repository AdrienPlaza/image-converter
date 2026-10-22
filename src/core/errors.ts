/**
 * Codes d'erreur stables, traduits côté UI via i18n (`errors.<code>`).
 * Le worker sérialise uniquement `{ code, params, message }` : jamais d'objet
 * Error brut (non clonable de façon fiable).
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

/** Normalise n'importe quelle exception en ConversionError. */
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
