/**
 * Encodage AVIF via WASM (@jsquash/avif, libavif).
 * Chargé dynamiquement : le binaire (~3,5 Mo) n'est téléchargé depuis
 * l'extension que si l'utilisateur choisit AVIF en sortie. Aucun réseau.
 */
import { clamp } from '../util';

/**
 * @param quality 1–100 (contrôle qualité AVIF)
 * @param effort  1–10 (10 = plus lent, meilleure compression)
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
