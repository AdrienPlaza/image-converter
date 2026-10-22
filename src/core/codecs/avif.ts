/**
 * Encodage AVIF via WASM (@jsquash/avif, libavif).
 * Loaded dynamically: the binary (~3.5 MB) is downloaded from
 * the extension only when the user selects AVIF output. No network.
 */
import { clamp } from '../util';

/**
 * @param quality 1–100 (AVIF quality control)
 * @param effort  1–10 (10 = slower, better compression)
 */
export async function encodeAvif(
  image: ImageData,
  quality: number,
  effort: number,
): Promise<Uint8Array> {
  const { encode } = await import('@jsquash/avif');
  const buffer = await encode(image, {
    quality: Math.round(clamp(quality, 1, 100)),
    speed: Math.round(clamp(11 - effort, 0, 10)),
  });
  return new Uint8Array(buffer);
}
