/**
 * Encodeur GIF (gifenc, JavaScript pur).
 * - Palette limited to 256 colors: a UI warning is required for gradients.
 * - GIF transparency is 1-bit: pixels with alpha < 128 become transparent.
 */
import { GIFEncoder, applyPalette, quantize, type GifEncoderInstance } from 'gifenc';

function hasTransparency(image: ImageData): boolean {
  for (let index = 3; index < image.data.length; index += 4) {
    if ((image.data[index] ?? 255) < 128) return true;
  }
  return false;
}

/**
 * Adds a frame to a GIF stream. `repeat` is written only on the first frame.
 * `dispose` is 2 for transparent animated GIFs: each frame is a
 * full-canvas composite, so the background must be cleared before the next.
 */
export function writeGifFrame(
  encoder: GifEncoderInstance,
  image: ImageData,
  delay = 0,
  repeat?: number,
  transparent = false,
  dispose?: number,
): void {
  const useAlpha = transparent && hasTransparency(image);

  if (!useAlpha) {
    const palette = quantize(image.data, 256, { format: 'rgb565' });
    const indices = applyPalette(image.data, palette, 'rgb565');
    encoder.writeFrame(indices, image.width, image.height, { palette, delay, repeat });
    return;
  }

  // 255 colors + one reserved transparent entry = 256 max.
  const palette = quantize(image.data, 255, {
    format: 'rgba4444',
    oneBitAlpha: true,
    clearAlpha: true,
    clearAlphaThreshold: 0,
  });
  let transparentIndex = palette.findIndex((color) => (color[3] ?? 255) === 0);
  if (transparentIndex < 0) {
    palette.push([0, 0, 0, 0]);
    transparentIndex = palette.length - 1;
  }

  const indices = applyPalette(image.data, palette, 'rgba4444');
  for (let pixel = 0, alpha = 3; alpha < image.data.length; alpha += 4, pixel++) {
    if ((image.data[alpha] ?? 255) < 128) indices[pixel] = transparentIndex;
  }

  encoder.writeFrame(indices, image.width, image.height, {
    palette,
    delay,
    repeat,
    transparent: true,
    transparentIndex,
    dispose,
  });
}

export function encodeGif(image: ImageData, transparent = true): Uint8Array {
  const encoder = GIFEncoder();
  writeGifFrame(encoder, image, 0, undefined, transparent);
  encoder.finish();
  return encoder.bytes();
}
