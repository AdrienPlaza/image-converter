import { ConversionError } from './errors';

export interface ResizeOptions {
  enabled: boolean;
  width: number | null;
  height: number | null;
  keepRatio: boolean;
}

export interface TargetSize {
  width: number;
  height: number;
  resized: boolean;
  upscaled: boolean;
}

/** Limites de canvas Chrome (documentées, conservatrices). */
export const MAX_CANVAS_SIDE = 32767;
export const MAX_CANVAS_AREA = 268_435_456;

/**
 * Calcule la taille cible en pixels.
 * - `keepRatio` + deux valeurs : « contain » dans la boîte demandée.
 * - `keepRatio` + une valeur : l'autre dimension est dérivée.
 * - sans ratio : dimensions exactes (valeur absente = taille source).
 */
export function computeTarget(
  sourceWidth: number,
  sourceHeight: number,
  options: ResizeOptions,
): TargetSize {
  const srcW = Math.max(1, Math.round(sourceWidth));
  const srcH = Math.max(1, Math.round(sourceHeight));

  if (!options.enabled) {
    return { width: srcW, height: srcH, resized: false, upscaled: false };
  }

  const rawW = options.width && options.width > 0 ? Math.round(options.width) : null;
  const rawH = options.height && options.height > 0 ? Math.round(options.height) : null;

  let width = rawW ?? srcW;
  let height = rawH ?? srcH;

  if (options.keepRatio) {
    if (rawW && rawH) {
      const scale = Math.min(rawW / srcW, rawH / srcH);
      width = Math.max(1, Math.round(srcW * scale));
      height = Math.max(1, Math.round(srcH * scale));
    } else if (rawW) {
      width = rawW;
      height = Math.max(1, Math.round((srcH * rawW) / srcW));
    } else if (rawH) {
      height = rawH;
      width = Math.max(1, Math.round((srcW * rawH) / srcH));
    }
  }

  const resized = width !== srcW || height !== srcH;
  return { width, height, resized, upscaled: width > srcW || height > srcH };
}

/** Vérifie qu'un canvas de cette taille est créable dans Chrome. */
export function assertCanvasSize(width: number, height: number): void {
  if (width < 1 || height < 1) {
    throw new ConversionError('invalid-options', { width, height });
  }
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_CANVAS_AREA) {
    throw new ConversionError('image-too-large', { width, height, max: MAX_CANVAS_SIDE });
  }
}
