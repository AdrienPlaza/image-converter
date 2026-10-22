/**
 * TIFF via UTIF.js (JavaScript + pako), chargé à la demande.
 * - Décodage : la plupart des TIFF non compressés / LZW / Deflate.
 * - Encodage : RGBA non compressé (fichiers volumineux) — expérimental.
 */
import { ConversionError } from '../errors';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export async function decodeTiff(bytes: Uint8Array): Promise<ImageData> {
  const { default: UTIF } = await import('utif');
  const buffer = toArrayBuffer(bytes);
  let ifds: ReturnType<typeof UTIF.decode>;
  try {
    ifds = UTIF.decode(buffer);
  } catch (error) {
    throw new ConversionError('tiff-decode-failed', undefined, String(error));
  }
  const first = ifds[0];
  if (!first) throw new ConversionError('tiff-decode-failed');
  UTIF.decodeImage(buffer, first);
  const rgba = UTIF.toRGBA8(first);
  if (!first.width || !first.height || rgba.length < first.width * first.height * 4) {
    throw new ConversionError('tiff-decode-failed');
  }
  return new ImageData(new Uint8ClampedArray(rgba), first.width, first.height);
}

export async function encodeTiff(image: ImageData): Promise<Uint8Array> {
  const { default: UTIF } = await import('utif');
  const rgba = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  const buffer = UTIF.encodeImage(rgba, image.width, image.height);
  return new Uint8Array(buffer);
}
